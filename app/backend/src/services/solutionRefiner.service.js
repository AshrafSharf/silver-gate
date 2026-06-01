import { randomUUID } from 'crypto';
import { connectToMongoDB, getMongoConnection } from '../config/mongoConnection.js';
import { toObjectId } from './reverse-sync/helpers.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

const LOG = 'SOLUTION_REFINE';

const DEEPSEEK_API_URL = config.deepseek.apiUrl;
const DEEPSEEK_API_KEY = config.deepseek.apiKey;
const DEEPSEEK_MODEL = config.deepseek.model;

/* ------------------------------------------------------------------ */
/* Fixed refinement prompt                                             */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT =
  'You are an expert academic tutor and content editor. You refine existing ' +
  'step-by-step solutions so they are clearer, pedagogically sound, well ' +
  'structured, and easy for a student to follow. You preserve correctness and ' +
  'all mathematical/LaTeX notation, fix obvious errors, and remove noise. You ' +
  'always respond with a single valid JSON object and nothing else.';

const REFINE_INSTRUCTIONS = [
  'Refine the following step-by-step solution. Requirements:',
  '- Return a single JSON object using the EXACT same schema and top-level keys as the input. Do not add or remove top-level keys.',
  '- Improve the clarity and correctness of each step\'s explanation; keep them concise and student-friendly.',
  '- Preserve all mathematical expressions and LaTeX; fix obviously broken LaTeX where needed.',
  '- Keep step_details as an ordered array and renumber step_index sequentially from 1.',
  '- Do not invent unnecessary new steps and do not drop essential steps.',
  '- Respond with ONLY the refined JSON object (no markdown, no commentary).',
].join('\n');

/* ------------------------------------------------------------------ */
/* In-memory job registry                                             */
/* ------------------------------------------------------------------ */
// Jobs are tracked in process memory (lost on restart) — mirrors the
// fire-and-forget pattern used for MathPix conversions. Keyed by jobId, with a
// secondary index of the latest job per chapter so the UI can resume display.

const jobs = new Map();
const latestJobByScope = new Map();
const MAX_TRACKED_ERRORS = 25;

// A job is scoped to a whole chapter or to a single exercise within it.
function scopeKey(chapterId, exerciseId) {
  return `${chapterId}:${exerciseId || 'ALL'}`;
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    chapterId: job.chapterId,
    chapterName: job.chapterName,
    exerciseId: job.exerciseId,
    exerciseName: job.exerciseName,
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
  const userPrompt = [
    REFINE_INSTRUCTIONS,
    '',
    `Subject: ${context.subject || 'GENERAL'}`,
    context.exerciseName ? `Problem / section: ${context.exerciseName}` : '',
    '',
    'Existing solution JSON to refine:',
    JSON.stringify(stepOutputJson),
  ]
    .filter(Boolean)
    .join('\n');

  const content = await callDeepSeek([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]);
  return parseJsonLoose(content);
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

async function getSolutions(db, chapterOid, exerciseOid = null) {
  let exercises;
  if (exerciseOid) {
    const ex = await db.collection('exercise').findOne(
      { _id: exerciseOid },
      { projection: { _id: 1, name: 1 } }
    );
    exercises = ex ? [ex] : [];
  } else {
    exercises = await db.collection('exercise')
      .find({ 'chapter.$id': chapterOid }, { projection: { _id: 1, name: 1 } })
      .toArray();
  }
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
   * Read-only: list a chapter's exercises (with solution counts) so the UI can
   * let the user scope a refinement to one exercise instead of the whole chapter.
   */
  async listExercises(chapterId) {
    await connectToMongoDB();
    const db = getMongoConnection().db;
    const chapterOid = toObjectId(chapterId);
    const exercises = await db.collection('exercise')
      .find({ 'chapter.$id': chapterOid }, { projection: { name: 1, order: 1, index: 1 } })
      .sort({ order: 1, name: 1 })
      .toArray();

    return Promise.all(exercises.map(async (ex) => {
      const items = await db.collection('exercise_item')
        .find({ 'exercise.$id': ex._id }, { projection: { _id: 1 } })
        .toArray();
      const itemIds = items.map((i) => i._id);
      const solutionCount = itemIds.length
        ? await db.collection('exercise_solution').countDocuments({ 'exercise_item.$id': { $in: itemIds } })
        : 0;
      return {
        id: ex._id.toString(),
        name: ex.name,
        order: ex.order ?? null,
        index: ex.index ?? null,
        solutionCount,
      };
    }));
  },

  /**
   * Kick off a background job that refines every solution in a chapter (or a
   * single exercise within it, if exerciseId is given) via DeepSeek and saves
   * the result back to MongoDB. Returns immediately with the job descriptor;
   * progress is polled via getJob/getJobForScope.
   */
  async startChapterRefinement(chapterId, exerciseId = null) {
    if (!DEEPSEEK_API_KEY) {
      throw new Error('DeepSeek API key not configured. Set DEEPSEEK_API_KEY in the environment.');
    }

    const key = scopeKey(chapterId, exerciseId);
    const runningId = latestJobByScope.get(key);
    if (runningId && jobs.get(runningId)?.status === 'running') {
      throw new Error('A refinement job is already running for this selection.');
    }

    await connectToMongoDB();
    const db = getMongoConnection().db;
    const chapterOid = toObjectId(chapterId);
    const { chapter, book, subject } = await resolveContext(db, chapterOid);

    let exerciseOid = null;
    let exerciseName = null;
    if (exerciseId) {
      exerciseOid = toObjectId(exerciseId);
      const ex = await db.collection('exercise').findOne(
        { _id: exerciseOid },
        { projection: { name: 1, chapter: 1 } }
      );
      if (!ex) throw new Error('Selected exercise not found in the portal.');
      if (refOid(ex.chapter)?.toString() !== chapterOid.toString()) {
        throw new Error('Selected exercise does not belong to the selected chapter.');
      }
      exerciseName = ex.name;
    }

    const job = {
      id: randomUUID(),
      chapterId,
      chapterName: chapter.name,
      exerciseId: exerciseId || null,
      exerciseName,
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
    this.runJob(job.id, chapterOid, exerciseOid, subject).catch((err) => {
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
      job.errors.push({ message: err.message });
      logger.error(LOG, `Job ${job.id} crashed: ${err.message}`);
    });

    return publicJob(job);
  },

  async runJob(jobId, chapterOid, exerciseOid, subject) {
    const job = jobs.get(jobId);
    const db = getMongoConnection().db;

    const solutions = await getSolutions(db, chapterOid, exerciseOid);
    job.total = solutions.length;
    logger.info(LOG, `Job ${jobId}: ${solutions.length} solution(s) to refine (chapter ${chapterOid}${exerciseOid ? `, exercise ${exerciseOid}` : ''})`);

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

  getJobForScope(chapterId, exerciseId = null) {
    const id = latestJobByScope.get(scopeKey(chapterId, exerciseId));
    return id ? publicJob(jobs.get(id)) : null;
  },
};

export default solutionRefinerService;
