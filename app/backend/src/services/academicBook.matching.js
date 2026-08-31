/**
 * Flattening and solution matching for both question-set shapes.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A Question Bank set is flat: `{ questions: [...] }` matched against
 * `{ solutions: [...] }` on `question_label`. An Academic Book set is grouped:
 * `{ blocks: [...] }` matched against `{ blocks: [...] }`.
 *
 * The bare label is NOT a usable key for an academic book. One chapter has six
 * exercises that each contain a question 4, so `"4"` collides five ways. A
 * solution is therefore keyed by the block it belongs to plus its label —
 * `EXERCISE|1.1|4` — which both sides derive from the same printed heading and
 * question number, so the keys line up by construction.
 *
 * `lessons.service.js` built its own label map in three places; all three now
 * call in here so the two shapes stay in step.
 */

/** True for the grouped Academic Book payload. */
export function isBlockPayload(payload) {
  return !!payload && typeof payload === 'object' && Array.isArray(payload.blocks);
}

/** Composite lookup key. Examples carry no exercise number, hence the empty slot. */
function blockKey(blockType, blockIndex, questionLabel) {
  return `${blockType || ''}|${blockIndex || ''}|${String(questionLabel ?? '')}`;
}

/**
 * Render an Academic Book choice object as the "(a) text" string the flat
 * pipeline expects, so `buildQuestionText`, `extractChoiceLabel` and
 * `cleanChoiceText` in lessons.service keep working unchanged.
 */
function renderChoice(choice) {
  if (typeof choice === 'string') return choice;
  const label = choice?.question_label ? `${choice.question_label} ` : '';
  return `${label}${choice?.question || ''}`.trim();
}

/**
 * One flat list of lesson-ready items from either shape.
 *
 * Academic Book items keep `block_type` / `block_index` / `block_name` so a
 * solution can be matched to them, and `parent_section_name` /
 * `common_parent_section_name` so a lesson can inherit the topic the block sat
 * under. `solution` is the working the textbook itself printed (worked
 * examples ship with one); it takes precedence over any solutions PDF.
 */
export function flattenQuestions(questionsPayload) {
  if (!isBlockPayload(questionsPayload)) {
    const questions = questionsPayload?.questions || [];
    return questions.map((question) => ({
      question_label: question.question_label,
      text: question.text,
      choices: question.choices || [],
    }));
  }

  const items = [];
  for (const block of questionsPayload.blocks) {
    for (const entry of block.toc_question_items || []) {
      const item = {
        question_label: entry.question_label,
        text: entry.question || '',
        choices: (entry.choices || []).map(renderChoice),
        block_type: block.type,
        block_index: block.index,
        block_name: block.name,
        parent_section_name: block.parent_section_name,
        common_parent_section_name: block.common_parent_section_name,
      };

      if (Array.isArray(entry.sub_questions) && entry.sub_questions.length > 0) {
        item.sub_questions = entry.sub_questions.map((sub) => ({
          id: sub.id,
          question: sub.question,
          question_label: sub.question_label,
        }));
      }

      // A worked example arrives with its own solution already split out.
      if (entry.solution) item.textbook_solution = entry.solution;

      items.push(item);
    }
  }
  return items;
}

/**
 * One group per block, in the order the parser emitted them, each carrying the
 * lesson metadata the block already knows plus its flattened items.
 *
 * An academic textbook has already done the grouping a Question Bank operator
 * has to do by hand: the exercise heading names the lesson, and the topic the
 * block sat under names its sections. Block mode reads those instead of asking
 * for them again. Returns null for the flat shape, which has no blocks.
 */
export function flattenBlockGroups(questionsPayload) {
  if (!isBlockPayload(questionsPayload)) return null;

  // `block_order` restarts per type within a chapter — "Examples 1, EXERCISE 1,
  // Examples 2, EXERCISE 2" — because the downstream `exercise` collection is
  // uniquely keyed on (order, chapter, type). A single run across both types
  // would number an exercise and an example alike and collide there.
  const orderByChapterType = new Map();

  return questionsPayload.blocks.map((block) => {
    const orderKey = `${block.chapter_order ?? ''}|${block.type}`;
    const order = (orderByChapterType.get(orderKey) || 0) + 1;
    orderByChapterType.set(orderKey, order);

    return {
      block_type: block.type,
      block_index: block.index,
      block_order: order,
      // The name is number-free ("EXERCISE", "Examples") and the number lives in
      // block_index; they are stored as separate fields and only joined for
      // display. `name` is the full heading, kept for labelling the block in UI.
      lesson_name: block.key || block.name,
      name: block.name,
      parent_section_name: block.parent_section_name || null,
      common_parent_section_name: block.common_parent_section_name || null,
      question_type: block.question_type || 'OTHER',
      start_page: block.start_page ?? null,
      end_page: block.end_page ?? null,
      // Reuse the flat path per block so items keep the block identity their
      // solution lookup keys on.
      items: flattenQuestions({ blocks: [block] }),
    };
  });
}

/**
 * Fold a solution's sub-parts into one working, labelled as printed.
 *
 * Sub-parts are matched to the question's own sub-parts by label where both
 * sides have one, so a solutions guide that skips part (ii) does not shift
 * (iii)'s working onto it.
 */
function composeWorkedSolution(solution, item) {
  const parts = [];
  if (solution.worked_solution) parts.push(solution.worked_solution);

  const subs = solution.sub_solutions || [];
  if (subs.length === 0) return parts.join('\n\n');

  const byLabel = new Map();
  for (const sub of subs) {
    if (sub.question_label) byLabel.set(String(sub.question_label), sub);
  }

  const questionSubs = item?.sub_questions || [];
  const ordered = questionSubs.length > 0 && questionSubs.every((q) => byLabel.has(String(q.question_label)))
    ? questionSubs.map((q) => byLabel.get(String(q.question_label)))
    : subs;

  for (const sub of ordered) {
    if (!sub?.worked_solution) continue;
    parts.push(sub.question_label ? `${sub.question_label} ${sub.worked_solution}` : sub.worked_solution);
  }

  return parts.join('\n\n');
}

/**
 * Build a lookup from items to their solution.
 *
 * Returns a function taking a flattened item and yielding the solution fields to
 * apply, or null when nothing matched. Academic Book lookups are keyed on
 * (block type, block index, label); a bare-label fallback is kept for the flat
 * Question Bank shape only — using it for blocks would reintroduce the very
 * collision this file exists to avoid.
 */
export function buildSolutionLookup(solutionsPayload) {
  if (isBlockPayload(solutionsPayload)) {
    const index = new Map();
    for (const block of solutionsPayload.blocks) {
      for (const solution of block.solutions || []) {
        index.set(blockKey(block.type, block.index, solution.question_label), solution);
      }
    }

    return (item) => {
      const solution = index.get(blockKey(item.block_type, item.block_index, item.question_label));
      if (!solution) return null;
      return {
        answer_key: solution.answer_key,
        worked_solution: composeWorkedSolution(solution, item),
        explanation: solution.explanation,
        visual_path: solution.visual_path,
      };
    };
  }

  const byLabel = new Map();
  for (const solution of solutionsPayload?.solutions || []) {
    if (solution.question_label) byLabel.set(String(solution.question_label), solution);
  }

  return (item) => byLabel.get(String(item.question_label || '')) || null;
}

/**
 * Apply solution fields to a flattened item, in place.
 *
 * A textbook's own worked solution wins: the chapter already printed the working
 * for its examples, and the solutions PDF only fills what is empty. Only truthy
 * fields are copied, matching how the flat pipeline has always merged.
 */
export function applySolution(item, solution) {
  let matched = false;

  if (item.textbook_solution) {
    item.worked_solution = item.textbook_solution;
    matched = true;
  }

  if (solution) {
    if (solution.answer_key) item.answer_key = solution.answer_key;
    if (solution.worked_solution && !item.worked_solution) {
      item.worked_solution = solution.worked_solution;
    }
    if (solution.explanation) item.explanation = solution.explanation;
    if (solution.visual_path && !item.visual_path) item.visual_path = solution.visual_path;
    matched = true;
  }

  delete item.textbook_solution;
  return matched;
}
