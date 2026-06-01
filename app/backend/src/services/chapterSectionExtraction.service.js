import { supabase } from '../config/database.js';
import { connectToMongoDB, getMongoConnection } from '../config/mongoConnection.js';
import { toObjectId, toDBRef } from './reverse-sync/helpers.js';
import { generateMongoId } from '../utils/mongoId.js';
import logger from '../utils/logger.js';

const LOG = 'GENERATE_SECTION';

/* ------------------------------------------------------------------ */
/* LaTeX cleaning + parsing                                            */
/* ------------------------------------------------------------------ */

const FULLWIDTH_MAP = [
  [/．/g, '.'],
  [/，/g, ','],
  [/：/g, ':'],
  [/；/g, ';'],
  [/＇/g, "'"],
  [/＂/g, '"'],
  [/－/g, '-'],
  [/？/g, '?'],
  [/！/g, '!'],
];

/**
 * Strip every \cmd{ … } block whose contents may include nested braces.
 * Mathpix's footer renders as `\footnotetext{$10{ }^{\text {th }}$ Standard Science}`,
 * which is 2-deep — a simple `[^{}]*` regex can't handle that, so walk braces.
 */
function stripBalancedCommand(s, command) {
  const opener = `\\${command}`;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const at = s.indexOf(opener, i);
    if (at === -1) {
      out += s.slice(i);
      break;
    }
    let j = at + opener.length;
    while (j < s.length && /\s/.test(s[j])) j++;
    if (s[j] !== '{') {
      // Not actually a `\cmd{`. Keep the literal text and move past it.
      out += s.slice(i, at + opener.length);
      i = at + opener.length;
      continue;
    }
    // Walk braces.
    let depth = 1;
    let k = j + 1;
    while (k < s.length && depth > 0) {
      const ch = s[k];
      if (ch === '\\' && k + 1 < s.length) { k += 2; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      k++;
    }
    out += s.slice(i, at);
    i = k;
  }
  return out;
}

function cleanLatex(input) {
  let s = input || '';

  // Strip \footnotetext{...} (handles nested braces — see helper above).
  s = stripBalancedCommand(s, 'footnotetext');

  // Strip orphan "Standard Science" footer fragments that sometimes survive.
  s = s.replace(/^\s*\d+\s*Standard\s+Science\s*$/gim, '');
  s = s.replace(/^\s*10th\s+Standard\s+Science\s*$/gim, '');

  // Normalize fullwidth punctuation that Mathpix occasionally emits.
  for (const [pattern, replacement] of FULLWIDTH_MAP) {
    s = s.replace(pattern, replacement);
  }

  return s;
}

/**
 * Strip `\section*{…}` and `\subsection*{…}` heading commands from a body of
 * LaTeX. The portal's solution renderer treats them as literal text rather
 * than rendering them as headings, and the heading info is already shown in
 * the exercise breadcrumb / item title — so leaving them in the body just
 * produces visible noise like "\subsection*{1.1 FORCE AND MOTION}".
 */
function stripHeadings(s) {
  let out = stripBalancedCommand(s || '', 'section*');
  out = stripBalancedCommand(out, 'subsection*');
  // Collapse the leading whitespace / blank lines left behind by the removal.
  return out.replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Extract every \section*{…} and \subsection*{…} heading from a LaTeX string.
 * Returns positions so the parser can slice content between headings.
 */
function extractHeadings(s) {
  const headings = [];
  const re = /\\(section|subsection)\*\s*\{/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const kind = m[1];
    const start = m.index;
    const bodyStart = m.index + m[0].length;

    // Walk forward respecting nested braces and backslash-escaped chars.
    let depth = 1;
    let i = bodyStart;
    while (i < s.length && depth > 0) {
      const ch = s[i];
      if (ch === '\\' && i + 1 < s.length) { i += 2; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    if (depth !== 0) {
      // Unbalanced brace — skip this heading rather than slurp the rest of the doc.
      continue;
    }
    const rawTitle = s.slice(bodyStart, i);
    const end = i + 1;
    headings.push({ kind, rawTitle, start, end });
  }
  return headings;
}

/**
 * Classify a heading into SECTION / EXERCISE / INLINE / PRE.
 *
 * - SECTION: numbered "1.2 INERTIA" (2-level number)
 * - EXERCISE: numbered "1.2.1 Types of Inertia" (3-level number)
 * - INLINE: Activity N / Example N / Try-it callouts → stay embedded in parent
 * - PRE: any other unnumbered heading (Learning Objectives, INTRODUCTION) → part of intro
 */
function classifyHeading(h) {
  // Strip trailing inline-image / line-break junk like "1.4.4 Resultant Force \\ ![]..."
  const titleStripped = h.rawTitle.split(/\s*\\\\\s*/)[0].trim();

  const m = titleStripped.match(/^(\d+)\.(\d+)(?:\.(\d+))?\s+(.+?)\s*$/);
  if (m) {
    const [, ch, sec, sub, name] = m;
    if (sub) {
      return { ...h, type: 'EXERCISE', number: `${ch}.${sec}.${sub}`, title: name };
    }
    return { ...h, type: 'SECTION', number: `${ch}.${sec}`, title: name };
  }

  if (/^(activity|example|try\s*it|do\s*you\s*know)\b/i.test(titleStripped)) {
    return { ...h, type: 'INLINE', title: titleStripped };
  }
  return { ...h, type: 'PRE', title: titleStripped };
}

/**
 * Parse a chapter's LaTeX into Section / Exercise rows.
 *
 * Rules:
 * - Numbered `X.Y.Z` heading → Exercise under section `X.Y`.
 * - Numbered `X.Y` heading with no `X.Y.Z` children → section-is-exercise.
 * - Numbered `X.Y` heading with `X.Y.Z` children → emit one Exercise per child;
 *   any prose between the section heading and its first child is prepended to
 *   that first child so nothing is lost.
 * - All content before the first numbered heading (Learning Objectives,
 *   INTRODUCTION, intro paragraphs) is bundled into a single synthetic
 *   "INTRODUCTION" exercise.
 * - Activity / Example callouts (\section*{Activity 1}) are kept inline as
 *   part of whichever exercise they appear within.
 */
export function parseChapterLatex(rawLatex) {
  const cleaned = cleanLatex(rawLatex);
  const headings = extractHeadings(cleaned).map(classifyHeading);

  // Build section → child-exercise map for the "has children?" question.
  const childrenBySection = {};
  for (const h of headings) {
    if (h.type === 'SECTION') {
      if (!(h.number in childrenBySection)) childrenBySection[h.number] = [];
    } else if (h.type === 'EXERCISE') {
      const parent = h.number.split('.').slice(0, 2).join('.');
      if (!(parent in childrenBySection)) childrenBySection[parent] = [];
      childrenBySection[parent].push(h);
    }
  }

  const structuralHeadings = headings.filter(h => h.type === 'SECTION' || h.type === 'EXERCISE');
  const sliceTo = (idx) => (idx < structuralHeadings.length ? structuralHeadings[idx].start : cleaned.length);

  const exercises = [];

  // --- Pre-section prose → single INTRODUCTION exercise --------------------
  const firstStructAt = structuralHeadings[0]?.start ?? cleaned.length;
  const introContent = stripHeadings(cleaned.slice(0, firstStructAt));
  if (introContent.length > 0) {
    exercises.push({
      name: 'INTRODUCTION',
      index: '0',
      parent_section_name: 'INTRODUCTION',
      common_parent_section_name: 'INTRODUCTION',
      latex_content: introContent,
    });
  }

  // --- Walk structural headings -------------------------------------------
  for (let i = 0; i < structuralHeadings.length; i++) {
    const h = structuralHeadings[i];

    if (h.type === 'SECTION') {
      const sectionFullName = `${h.number} ${h.title}`;
      const children = childrenBySection[h.number] || [];
      if (children.length === 0) {
        // Section-is-exercise: include from section heading until next structural heading.
        const content = stripHeadings(cleaned.slice(h.start, sliceTo(i + 1)));
        exercises.push({
          name: sectionFullName,
          index: h.number,
          parent_section_name: sectionFullName,
          common_parent_section_name: sectionFullName,
          latex_content: content,
        });
      }
      // Section with children: don't emit. Its preamble (if any) is handled
      // by the EXERCISE branch below via lookback.
    } else {
      // EXERCISE
      const parentNum = h.number.split('.').slice(0, 2).join('.');
      const parentHeading = headings.find(x => x.type === 'SECTION' && x.number === parentNum);
      const parentSectionFullName = parentHeading
        ? `${parentHeading.number} ${parentHeading.title}`
        : '';

      let content = cleaned.slice(h.start, sliceTo(i + 1));

      // If this is the first child of its parent section, prepend the
      // section's preamble (the prose between the section heading and this
      // child) so we don't drop content.
      const siblings = childrenBySection[parentNum] || [];
      const isFirstChild = siblings.length > 0 && siblings[0].start === h.start;
      if (isFirstChild && parentHeading) {
        const preamble = cleaned.slice(parentHeading.start, h.start);
        if (preamble.trim().length > 0) {
          content = `${preamble}\n\n${content}`;
        }
      }

      exercises.push({
        name: `${h.number} ${h.title}`,
        index: h.number,
        parent_section_name: parentSectionFullName,
        common_parent_section_name: parentSectionFullName,
        latex_content: stripHeadings(content),
      });
    }
  }

  exercises.forEach((e, idx) => { e.order = idx + 1; });
  return exercises;
}

/* ------------------------------------------------------------------ */
/* Orchestrator: parse → upsert MongoDB chain → insertMany exercises    */
/* ------------------------------------------------------------------ */

const EXERCISE_CLASS = 'com.robogebra.cms.domain.exercise.repository.model.ExerciseEntity';
const EXERCISE_ITEM_CLASS = 'com.robogebra.cms.domain.exerciseitem.repository.model.ExerciseItemEntity';
const EXERCISE_SOLUTION_CLASS = 'com.robogebra.cms.domain.exercisesolution.repository.model.ExerciseSolutionEntity';

/**
 * Given an exercise (the section/subsection record we just created) plus the
 * parsed prose, build the {item, solution} pair that the portal expects.
 *
 * - The ExerciseItem mirrors the exercise's name (e.g. "1.2.1 Types of Inertia").
 *   For a textbook section that has no real Q&A yet, the "question" is just the
 *   topic name; the prose explanation lands in the solution.
 * - The ExerciseSolution holds the LaTeX prose inside `step_output_json` —
 *   specifically in `step_details[0].explanation` because it accepts mixed
 *   text + math (whereas `expressions` is for pure math blocks).
 */
function buildItemAndSolution(exerciseOid, exerciseName, latexContent, now) {
  const itemOid = toObjectId(generateMongoId());
  const solutionOid = toObjectId(generateMongoId());

  const item = {
    _id: itemOid,
    question: exerciseName,
    exercise: toDBRef('exercise', exerciseOid),
    index: '1',
    display_order: 1,
    question_label: '1',
    question_type: 'OTHER',
    created_at: now,
    updated_at: now,
    _class: EXERCISE_ITEM_CLASS,
  };

  const solution = {
    _id: solutionOid,
    exercise_item: toDBRef('exercise_item', itemOid),
    step_output_json: {
      problem_statement: exerciseName,
      overview: '',
      short_cuts: '',
      step_details: [
        { step_index: 1, explanation: latexContent || '', expressions: [] },
      ],
    },
    step_workflow_status: 'DRAFT',
    created_at: now,
    updated_at: now,
    _class: EXERCISE_SOLUTION_CLASS,
  };

  return { item, solution };
}

export const chapterSectionExtractionService = {
  /**
   * Top-level: parse a scanned item's latex_doc into Section/Exercise rows and
   * insert them into the user-selected portal book + chapter. Nothing is created
   * in MongoDB except the exercises/items/solutions — the book and chapter must
   * already exist and are used directly.
   */
  async generateSections(scannedItemId, metadata) {
    if (!metadata || !metadata.chapterId) {
      throw new Error('A portal chapter must be selected (chapterId is required)');
    }

    // 1) Load the scanned item (only its LaTeX is needed — book and chapter are
    // chosen explicitly by the user, not derived from the scanned item).
    const { data: scanned, error: scannedErr } = await supabase
      .from('scanned_items')
      .select('id, latex_doc, latex_conversion_status, item_data')
      .eq('id', scannedItemId)
      .single();
    if (scannedErr) throw scannedErr;
    if (!scanned) throw new Error('Scanned item not found');
    if (scanned.latex_conversion_status !== 'completed' || !scanned.latex_doc) {
      throw new Error('LaTeX conversion is not completed for this item');
    }

    // 2) Connect to MongoDB (singleton; do not disconnect, other endpoints reuse it).
    await connectToMongoDB();
    const db = getMongoConnection().db;

    // 3) Resolve the user-selected portal chapter. The book it belongs to is its
    // source of truth — we never create chapters or books here.
    const chapterOid = toObjectId(metadata.chapterId);
    const chapter = await db.collection('chapter').findOne({ _id: chapterOid });
    if (!chapter) {
      throw new Error('Selected chapter not found in the portal. Pick an existing chapter.');
    }
    // The MongoDB driver deserializes a stored DBRef into a `DBRef` instance
    // whose id is exposed as `.oid` (a query path like `book.$id` works, but the
    // in-JS field is not `.$id`). Fall back to `.$id` for plain-object refs.
    const bookOid = chapter.book?.oid ?? chapter.book?.$id ?? null;
    if (!bookOid) {
      throw new Error('Selected chapter is not linked to a book in the portal.');
    }
    const book = await db.collection('book').findOne({ _id: bookOid });
    const bookGroupOid = book?.book_group?.oid ?? book?.book_group?.$id ?? null;

    // 4) Idempotency check — refuse to dump exercises into a chapter that already
    // has them. Pick an empty chapter (or clear it first) to regenerate.
    const existingExerciseCount = await db.collection('exercise').countDocuments({
      'chapter.$id': chapterOid,
    });
    if (existingExerciseCount > 0) {
      throw new Error(
        `Selected chapter already has ${existingExerciseCount} exercise(s) in MongoDB. ` +
        `Pick an empty chapter or delete them first to regenerate.`
      );
    }

    logger.info(LOG,
      `Using book ${bookOid} (${book?.name ?? 'unknown'}) / chapter ${chapterOid} (${chapter.name})`
    );

    // 5) Parse LaTeX → exercises and insertMany.
    const parsed = parseChapterLatex(scanned.latex_doc);
    logger.info(LOG, `Parsed ${parsed.length} exercises from ${Math.round(scanned.latex_doc.length / 1024)}KB of LaTeX`);

    const now = new Date();
    const docs = parsed.map((e) => {
      // Each section gets a single TOC item mirroring the section name. The
      // portal's chapter-page list view reads from `toc_output_json` (not from
      // exercise_item rows), so this object must be populated up-front;
      // toc_status must be COMPLETED for it to be picked up.
      const tocItem = {
        id: '1',
        question: e.name,
        question_label: '1',
        sub_questions: [],
      };
      return {
        _id: toObjectId(generateMongoId()),
        name: e.name,
        index: e.index,
        latex_content: e.latex_content,
        book: toDBRef('book', bookOid),
        chapter: toDBRef('chapter', chapterOid),
        order: e.order,
        common_parent_section_name: e.common_parent_section_name,
        parent_section_name: e.parent_section_name,
        toc_output_json: {
          choice_question_header_text: '',
          toc_question_items: [tocItem],
          flattened_question_items: [
            { id: tocItem.id, question_label: tocItem.question_label, question: tocItem.question },
          ],
        },
        toc_status: 'COMPLETED',
        toc_prompt: null,
        // 'EXAMPLE' = textbook walkthrough / section breakdown (left "Examples"
        // column in the portal TOC UI). 'EXERCISE' is reserved for problem sets
        // and appears in the right column — not what we want for science prose.
        type: 'EXAMPLE',
        created_at: now,
        updated_at: now,
        _class: EXERCISE_CLASS,
      };
    });

    if (docs.length === 0) {
      throw new Error('No sections/exercises detected in the LaTeX. Check that the chapter has numbered headings.');
    }

    const insertResult = await db.collection('exercise').insertMany(docs, { ordered: false });
    logger.info(LOG, `Inserted ${insertResult.insertedCount} exercises into MongoDB`);

    // 10) For each exercise, create one ExerciseItem (mirrors the section name)
    // and one ExerciseSolution (holds the prose). We pair items↔solutions via
    // DBRef so the portal's existing UI (which expects exercise → item → solution)
    // can render the chapter prose as if it were a single Q&A per section.
    const items = [];
    const solutions = [];
    for (const exDoc of docs) {
      const { item, solution } = buildItemAndSolution(exDoc._id, exDoc.name, exDoc.latex_content, now);
      items.push(item);
      solutions.push(solution);
    }
    const itemsResult = await db.collection('exercise_item').insertMany(items, { ordered: false });
    const solutionsResult = await db.collection('exercise_solution').insertMany(solutions, { ordered: false });
    logger.info(LOG, `Inserted ${itemsResult.insertedCount} exercise_items and ${solutionsResult.insertedCount} exercise_solutions`);

    return {
      exerciseCount: insertResult.insertedCount,
      exerciseItemCount: itemsResult.insertedCount,
      exerciseSolutionCount: solutionsResult.insertedCount,
      bookGroupCreated: false,
      bookCreated: false,
      chapterCreated: false,
      bookGroupId: bookGroupOid ? bookGroupOid.toString() : null,
      bookId: bookOid.toString(),
      chapterId: chapterOid.toString(),
      exercises: parsed.map((e) => ({
        name: e.name,
        index: e.index,
        parent_section_name: e.parent_section_name,
        order: e.order,
      })),
    };
  },

  /**
   * Read-only: list MongoDB book documents for the modal dropdown. The user
   * picks one of these directly — generateSections uses it as-is (no creation).
   */
  async listBooks() {
    await connectToMongoDB();
    const db = getMongoConnection().db;
    const books = await db.collection('book')
      .find({}, { projection: { name: 1, display_id: 1, board: 1, grade: 1, subject: 1, language: 1 } })
      .sort({ name: 1 })
      .toArray();
    return books.map((b) => ({
      id: b._id.toString(),
      name: b.display_id || b.name,
      board: b.board,
      grade: b.grade,
      subject: b.subject,
      language: b.language,
    }));
  },

  /**
   * Read-only: list MongoDB chapter documents for a given portal book, for the
   * modal's chapter dropdown. The user picks one and exercises are inserted into
   * it directly.
   */
  async listChapters(bookId) {
    await connectToMongoDB();
    const db = getMongoConnection().db;
    const bookOid = toObjectId(bookId);
    const chapters = await db.collection('chapter')
      .find({ 'book.$id': bookOid }, { projection: { name: 1, order: 1 } })
      .sort({ order: 1, name: 1 })
      .toArray();

    // Count existing exercises per chapter so the UI can flag non-empty ones
    // (generation refuses to dump into a chapter that already has exercises).
    return Promise.all(chapters.map(async (c) => ({
      id: c._id.toString(),
      name: c.name,
      order: c.order ?? null,
      exerciseCount: await db.collection('exercise').countDocuments({ 'chapter.$id': c._id }),
    })));
  },

  /**
   * Read-only: list MongoDB book_group documents for the modal dropdown.
   */
  async listBookGroups() {
    await connectToMongoDB();
    const db = getMongoConnection().db;
    const groups = await db.collection('book_group')
      .find({}, { projection: { name: 1, board: 1, grade: 1, state: 1 } })
      .sort({ name: 1 })
      .toArray();
    return groups.map((g) => ({
      id: g._id.toString(),
      name: g.name,
      board: g.board,
      grade: g.grade,
      state: g.state,
    }));
  },
};

export default chapterSectionExtractionService;
