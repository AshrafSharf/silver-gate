import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { connectToMongoDB, getMongoConnection } from '../config/mongoConnection.js';
import { toObjectId } from './reverse-sync/helpers.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

const LOG = 'SOLUTION_REFINE';

const DEEPSEEK_API_URL = config.deepseek.apiUrl;
const DEEPSEEK_API_KEY = config.deepseek.apiKey;
const DEEPSEEK_MODEL = config.deepseek.model;

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* Fixed refinement prompt                                             */
/* ------------------------------------------------------------------ */

// Prose refiner template ported from robogebra-langchain
// (solution_refiner/prose-refiner-template.txt). It restructures a single wall
// of textbook prose into a multi-step, visually-styled StepByStepSolution.
const PROSE_TEMPLATE = readFileSync(join(__dirname, 'prose-refiner-template.txt'), 'utf8');

// Equivalent of the langchain PydanticOutputParser format_instructions for the
// StepByStepSolutionWithOverview model — describes the exact output JSON schema.
const FORMAT_INSTRUCTIONS = [
  'The output must be a single JSON object that matches this exact schema (no extra top-level keys):',
  '{',
  '  "problem_statement": "string",',
  '  "overview": "string",',
  '  "step_details": [',
  '    { "step_index": 1, "explanation": "string", "expressions": ["string", "..."] }',
  '  ],',
  '  "short_cuts": "string"',
  '}',
  'Rules: step_index is an integer starting at 1 and incrementing by 1; expressions is an array of',
  'strings (use [] if a step has none); every expression string must start and end with "$".',
].join('\n');

// Fill the prose template's named placeholders. Uses split/join so the many
// literal LaTeX braces ({\textbf{...}} etc.) in the template are left untouched.
function buildPrompt(stepOutputJson, context) {
  const originalSolution = JSON.stringify(stepOutputJson, null, 2);
  const customInstructions = [
    context.subject ? `Subject: ${context.subject}.` : '',
    context.exerciseName ? `This passage is from the section "${context.exerciseName}".` : '',
  ].filter(Boolean).join(' ');

  return PROSE_TEMPLATE
    .split('{original_solution}').join(originalSolution)
    .split('{custom_instructions}').join(customInstructions)
    .split('{format_instructions}').join(FORMAT_INSTRUCTIONS);
}

// Coerce the model output into the StepByStepSolutionWithOverview shape so the
// saved step_output_json always has the right structure even if a field is missing.
function normalizeRefined(parsed, original) {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.step_details)) {
    throw new Error('Refined output is not a valid step-by-step solution JSON');
  }
  return {
    problem_statement: parsed.problem_statement ?? original?.problem_statement ?? '',
    overview: parsed.overview ?? '',
    short_cuts: parsed.short_cuts ?? '',
    step_details: parsed.step_details.map((s, i) => ({
      step_index: Number.isInteger(s?.step_index) ? s.step_index : i + 1,
      explanation: s?.explanation ?? '',
      expressions: Array.isArray(s?.expressions) ? s.expressions : [],
    })),
  };
}

/* ------------------------------------------------------------------ */
/* In-memory job registry                                             */
/* ------------------------------------------------------------------ */
// Jobs are tracked in process memory (lost on restart) — mirrors the
// fire-and-forget pattern used for MathPix conversions. Keyed by jobId, with a
// secondary index of the latest job per chapter so the UI can resume display.

const jobs = new Map();
const latestJobByScope = new Map();
const MAX_TRACKED_ERRORS = 25;

// A job is scoped to a whole chapter or to a single common parent section.
function scopeKey(chapterId, commonParent) {
  return `${chapterId}:${commonParent || 'ALL'}`;
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    chapterId: job.chapterId,
    chapterName: job.chapterName,
    commonParent: job.commonParent,
    bookId: job.bookId,
    bookName: job.bookName,
    subject: job.subject,
    status: job.status,
    total: job.total,
    processed: job.processed,
    refined: job.refined,
    skipped: job.skipped,
    failed: job.failed,
    errors: job.errors.slice(0, MAX_TRACKED_ERRORS),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

/* ------------------------------------------------------------------ */
/* DeepSeek call                                                      */
/* ------------------------------------------------------------------ */

async function callDeepSeek(messages) {
  const response = await fetch(`${DEEPSEEK_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek API ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned no content');
  return content;
}

function parseJsonLoose(content) {
  try {
    return JSON.parse(content);
  } catch {
    // Strip ```json … ``` fences some models still emit despite json mode.
    const cleaned = content
      .replace(/^\s*```(?:json)?/i, '')
      .replace(/```\s*$/, '')
      .trim();
    return JSON.parse(cleaned);
  }
}

async function refineStepOutput(stepOutputJson, context) {
  const prompt = buildPrompt(stepOutputJson, context);

  // Print the exact prompt we send to the LLM before calling it.
  logger.info(
    LOG,
    `DeepSeek prompt for "${context.exerciseName || 'solution'}":\n` +
    `----- PROMPT -----\n${prompt}\n------------------`
  );

  const content = await callDeepSeek([{ role: 'user', content: prompt }]);
  return normalizeRefined(parseJsonLoose(content), stepOutputJson);
}

/* ------------------------------------------------------------------ */
/* MongoDB traversal: chapter → exercises → items → solutions          */
/* ------------------------------------------------------------------ */

// Stored DBRefs deserialize into `DBRef` instances whose id is on `.oid`
// (query paths still use `.$id`). Fall back to `.$id` for plain-object refs.
function refOid(ref) {
  return ref?.oid ?? ref?.$id ?? null;
}

async function resolveContext(db, chapterOid) {
  const chapter = await db.collection('chapter').findOne({ _id: chapterOid });
  if (!chapter) throw new Error('Chapter not found in the portal.');
  const bookOid = refOid(chapter.book);
  const book = bookOid ? await db.collection('book').findOne({ _id: bookOid }) : null;
  return { chapter, book, subject: book?.subject ?? null };
}

async function getSolutions(db, chapterOid, commonParent = null) {
  const query = { 'chapter.$id': chapterOid };
  if (commonParent) query.common_parent_section_name = commonParent;
  const exercises = await db.collection('exercise')
    .find(query, { projection: { _id: 1, name: 1 } })
    .toArray();
  if (exercises.length === 0) return [];
  const exerciseIds = exercises.map((e) => e._id);
  const nameByExercise = new Map(exercises.map((e) => [e._id.toString(), e.name]));

  const items = await db.collection('exercise_item')
    .find({ 'exercise.$id': { $in: exerciseIds } }, { projection: { _id: 1, exercise: 1 } })
    .toArray();
  if (items.length === 0) return [];
  const itemIds = items.map((i) => i._id);
  const exByItem = new Map(items.map((i) => [i._id.toString(), refOid(i.exercise)]));

  const solutions = await db.collection('exercise_solution')
    .find({ 'exercise_item.$id': { $in: itemIds } })
    .toArray();

  return solutions.map((sol) => {
    const itemOid = refOid(sol.exercise_item);
    const exOid = itemOid ? exByItem.get(itemOid.toString()) : null;
    const exerciseName = exOid ? nameByExercise.get(exOid.toString()) : '';
    return { sol, exerciseName };
  });
}

function normalizeStepOutput(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function hasContent(stepOutput) {
  if (!stepOutput || typeof stepOutput !== 'object') return false;
  if (Array.isArray(stepOutput.step_details) && stepOutput.step_details.length > 0) return true;
  return Boolean(stepOutput.problem_statement || stepOutput.overview);
}

/* ------------------------------------------------------------------ */
/* Service                                                            */
/* ------------------------------------------------------------------ */

export const solutionRefinerService = {
  /**
   * Read-only: list a chapter's distinct common parent sections (e.g.
   * "1.4 NEWTON'S LAWS OF MOTION") with the number of exercises and solutions
   * under each, so the UI can scope a refinement to one whole section.
   */
  async listCommonParents(chapterId) {
    await connectToMongoDB();
    const db = getMongoConnection().db;
    const chapterOid = toObjectId(chapterId);

    const exercises = await db.collection('exercise')
      .find({ 'chapter.$id': chapterOid }, { projection: { _id: 1, common_parent_section_name: 1, order: 1 } })
      .sort({ order: 1 })
      .toArray();
    if (exercises.length === 0) return [];

    const LABEL = (cp) => cp || '(no section)';
    // Group exercise ids by common parent, preserving first-seen (order) sequence.
    const groups = new Map(); // commonParent -> exerciseIds[]
    const cpByExercise = new Map();
    for (const ex of exercises) {
      const cp = LABEL(ex.common_parent_section_name);
      cpByExercise.set(ex._id.toString(), cp);
      if (!groups.has(cp)) groups.set(cp, []);
      groups.get(cp).push(ex._id);
    }

    // Solution counts per common parent (bulk: item → exercise → common parent).
    const items = await db.collection('exercise_item')
      .find({ 'exercise.$id': { $in: exercises.map((e) => e._id) } }, { projection: { _id: 1, exercise: 1 } })
      .toArray();
    const cpByItem = new Map();
    for (const it of items) {
      const exOid = refOid(it.exercise);
      const cp = exOid ? cpByExercise.get(exOid.toString()) : null;
      if (cp) cpByItem.set(it._id.toString(), cp);
    }
    const solCountByCp = new Map();
    if (items.length) {
      const sols = await db.collection('exercise_solution')
        .find({ 'exercise_item.$id': { $in: items.map((i) => i._id) } }, { projection: { _id: 1, exercise_item: 1 } })
        .toArray();
      for (const s of sols) {
        const itemOid = refOid(s.exercise_item);
        const cp = itemOid ? cpByItem.get(itemOid.toString()) : null;
        if (cp) solCountByCp.set(cp, (solCountByCp.get(cp) || 0) + 1);
      }
    }

    return [...groups.entries()].map(([commonParent, exerciseIds]) => ({
      commonParent,
      exerciseCount: exerciseIds.length,
      solutionCount: solCountByCp.get(commonParent) || 0,
    }));
  },

  /**
   * Kick off a background job that refines every solution in a chapter (or in a
   * single common parent section within it, if commonParent is given) via
   * DeepSeek and saves the result back to MongoDB. Returns immediately with the
   * job descriptor; progress is polled via getJob/getJobForScope.
   */
  async startChapterRefinement(chapterId, commonParent = null) {
    if (!DEEPSEEK_API_KEY) {
      throw new Error('DeepSeek API key not configured. Set DEEPSEEK_API_KEY in the environment.');
    }

    const key = scopeKey(chapterId, commonParent);
    const runningId = latestJobByScope.get(key);
    if (runningId && jobs.get(runningId)?.status === 'running') {
      throw new Error('A refinement job is already running for this selection.');
    }

    await connectToMongoDB();
    const db = getMongoConnection().db;
    const chapterOid = toObjectId(chapterId);
    const { chapter, book, subject } = await resolveContext(db, chapterOid);

    if (commonParent) {
      const cnt = await db.collection('exercise').countDocuments({
        'chapter.$id': chapterOid,
        common_parent_section_name: commonParent,
      });
      if (cnt === 0) {
        throw new Error('No exercises found for the selected section in this chapter.');
      }
    }

    const job = {
      id: randomUUID(),
      chapterId,
      chapterName: chapter.name,
      commonParent: commonParent || null,
      bookId: book?._id?.toString() ?? null,
      bookName: book?.name ?? null,
      subject,
      status: 'running',
      total: 0,
      processed: 0,
      refined: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    jobs.set(job.id, job);
    latestJobByScope.set(key, job.id);

    // Fire-and-forget — runs in the background, progress lives on the job object.
    this.runJob(job.id, chapterOid, commonParent, subject).catch((err) => {
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
      job.errors.push({ message: err.message });
      logger.error(LOG, `Job ${job.id} crashed: ${err.message}`);
    });

    return publicJob(job);
  },

  async runJob(jobId, chapterOid, commonParent, subject) {
    const job = jobs.get(jobId);
    const db = getMongoConnection().db;

    const solutions = await getSolutions(db, chapterOid, commonParent);
    job.total = solutions.length;
    logger.info(LOG, `Job ${jobId}: ${solutions.length} solution(s) to refine (chapter ${chapterOid}${commonParent ? `, section "${commonParent}"` : ''})`);

    for (const { sol, exerciseName } of solutions) {
      try {
        const original = normalizeStepOutput(sol.step_output_json);
        if (!hasContent(original)) {
          job.skipped += 1;
          continue;
        }

        const refined = await refineStepOutput(original, { subject, exerciseName });

        const update = { $set: { step_output_json: refined, updated_at: new Date() } };
        // Back up the original once, the first time we touch this solution.
        if (sol.step_output_json_original === undefined) {
          update.$set.step_output_json_original = sol.step_output_json ?? null;
        }
        await db.collection('exercise_solution').updateOne({ _id: sol._id }, update);
        job.refined += 1;
      } catch (err) {
        job.failed += 1;
        if (job.errors.length < MAX_TRACKED_ERRORS) {
          job.errors.push({ solutionId: sol._id?.toString(), message: err.message });
        }
        logger.error(LOG, `Job ${jobId}: solution ${sol._id} failed: ${err.message}`);
      } finally {
        job.processed += 1;
      }
    }

    job.status = 'completed';
    job.finishedAt = new Date().toISOString();
    logger.info(LOG, `Job ${jobId} completed: refined ${job.refined}, skipped ${job.skipped}, failed ${job.failed} of ${job.total}`);
  },

  getJob(jobId) {
    return publicJob(jobs.get(jobId));
  },

  getJobForScope(chapterId, commonParent = null) {
    const id = latestJobByScope.get(scopeKey(chapterId, commonParent));
    return id ? publicJob(jobs.get(id)) : null;
  },
};

export default solutionRefinerService;
