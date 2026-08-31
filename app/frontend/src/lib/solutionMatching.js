/**
 * Preview-side mirror of the backend's solution matching
 * (`backend/src/services/academicBook.matching.js`).
 *
 * The merge preview has to show the same pairings the backend will write, so it
 * needs the same key. A bare `question_label` is not enough for an Academic
 * Book: a chapter's six exercises each have a question 4, so the label alone
 * matches five wrong solutions. Academic Book lesson items carry `block_type`
 * and `block_index` in their `question_solution_item_json`, which is what the
 * lookup below keys on.
 */

function blockKey(blockType, blockIndex, questionLabel) {
  return `${blockType || ''}|${blockIndex || ''}|${String(questionLabel ?? '')}`;
}

/** Fold a solution's sub-parts into one working, labelled as printed. */
function composeWorkedSolution(solution) {
  const parts = [];
  if (solution.worked_solution) parts.push(solution.worked_solution);
  for (const sub of solution.sub_solutions || []) {
    if (!sub?.worked_solution) continue;
    parts.push(sub.question_label ? `${sub.question_label} ${sub.worked_solution}` : sub.worked_solution);
  }
  return parts.join('\n\n');
}

/**
 * Build a lookup from a solution set payload of either shape.
 * Returns a function taking `{ question_label, block_type, block_index }` and
 * yielding the matching solution's fields, or null.
 */
export function buildSolutionLookup(solutionsPayload) {
  if (Array.isArray(solutionsPayload?.blocks)) {
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
        worked_solution: composeWorkedSolution(solution),
        explanation: solution.explanation,
        visual_path: solution.visual_path,
      };
    };
  }

  const byLabel = new Map();
  for (const solution of solutionsPayload?.solutions || []) {
    if (solution.question_label !== undefined && solution.question_label !== null) {
      byLabel.set(String(solution.question_label), solution);
    }
  }

  return (item) => byLabel.get(String(item.question_label ?? '')) || null;
}
