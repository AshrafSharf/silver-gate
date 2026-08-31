/**
 * Deterministic parser for academic-book *solution* marker annotations.
 *
 * Input:  LaTeX annotated with the `%` marker grammar documented in
 *         `academicBookSolution.instructions.js`.
 * Output: `{ blocks: [...] }`, one block per exercise (and one per example
 *         solution), each carrying the block identity that makes a solution
 *         matchable back to its question.
 *
 * No LLM involvement — same split as the question side: the model inserts
 * boundaries, this file reads them. See `academicBook.parser.js`.
 */

import {
  ABS_MARKERS,
  ABS_META_PREFIXES,
  ABS_SOLUTION_MARKERS,
  ABS_ANSWER_KEY_PREFIX,
} from './academicBookSolution.instructions.js';
import {
  extractBlockBodies,
  readMetaValue,
  parseTitle,
  parseOrder,
  cleanQuestionText,
  readPartLabel,
  stripPartLabel,
  collectSuffixedMarkers,
  countOpeners,
  compareSuffix,
} from './academicBook.parser.js';

// ---------------------------------------------------------------------------
// Solution bodies
// ---------------------------------------------------------------------------

/** First image reference in a solution, kept alongside the working. */
function readVisualPath(raw) {
  const match = /!\[[^\]]*\]\(([^)]+)\)/.exec(raw);
  return match ? match[1] : '';
}

/** Drop the annotation's own metadata comment lines from a solution body. */
function stripMetaLines(raw) {
  return raw
    .split('\n')
    .filter((line) => !line.trim().startsWith(ABS_ANSWER_KEY_PREFIX))
    .join('\n');
}

/**
 * Build the solution list for one block from its `% ST_SOL_<n>` markers.
 *
 * A suffix with no dot is a whole solution; `4.1` is the first sub-part of
 * solution 4. Sub-parts keep their PRINTED label ("(i)"), because that is what
 * the question side stores and therefore what matching compares.
 */
function parseBlockSolutions(body, warnings, blockLabel) {
  const pairs = collectSuffixedMarkers(
    body,
    ABS_SOLUTION_MARKERS.SOLUTION.start,
    ABS_SOLUTION_MARKERS.SOLUTION.end
  );

  // An opener that never paired up means a solution was annotated but cannot be
  // read — usually a duplicated suffix or a missing closing marker. Say so
  // rather than returning a block that is quietly short a solution.
  const opened = countOpeners(body, ABS_SOLUTION_MARKERS.SOLUTION.start);
  if (opened !== pairs.length) {
    warnings.push(
      `${blockLabel}: ${opened - pairs.length} of ${opened} ${ABS_SOLUTION_MARKERS.SOLUTION.start}n markers ` +
      `could not be paired with ${ABS_SOLUTION_MARKERS.SOLUTION.end}n (duplicate suffix or missing closing ` +
      `marker) — those solutions were skipped`
    );
  }

  const tops = pairs.filter((pair) => !pair.suffix.includes('.'));
  const subsByParent = new Map();
  for (const pair of pairs) {
    if (!pair.suffix.includes('.')) continue;
    const parent = pair.suffix.split('.')[0];
    if (!subsByParent.has(parent)) subsByParent.set(parent, []);
    subsByParent.get(parent).push(pair);
  }

  // A sub-part whose parent marker is missing still answers a real question, so
  // synthesise the parent rather than dropping its parts.
  const suffixes = new Set(tops.map((top) => top.suffix));
  for (const parent of subsByParent.keys()) {
    if (suffixes.has(parent)) continue;
    warnings.push(`${blockLabel}: solution ${parent} has sub-parts but no ${ABS_SOLUTION_MARKERS.SOLUTION.start}${parent} marker`);
    tops.push({ suffix: parent, content: '' });
  }

  tops.sort((a, b) => compareSuffix(a.suffix, b.suffix));

  return tops.map((top) => {
    const answerKey = readMetaValue(top.content, ABS_ANSWER_KEY_PREFIX) || '';
    const cleanedBody = stripMetaLines(top.content);

    return {
      question_label: top.suffix,
      answer_key: answerKey,
      visual_path: readVisualPath(cleanedBody),
      worked_solution: cleanQuestionText(cleanedBody),
      explanation: '',
      sub_solutions: (subsByParent.get(top.suffix) || [])
        .slice()
        .sort((a, b) => compareSuffix(a.suffix, b.suffix))
        .map((sub, index) => {
          const subBody = stripMetaLines(sub.content);
          return {
            question_label: readPartLabel(sub.content) || `(${index + 1})`,
            answer_key: readMetaValue(sub.content, ABS_ANSWER_KEY_PREFIX) || '',
            visual_path: readVisualPath(subBody),
            worked_solution: stripPartLabel(cleanQuestionText(subBody)),
            explanation: '',
          };
        }),
    };
  });
}

// ---------------------------------------------------------------------------
// Block identity
// ---------------------------------------------------------------------------

/**
 * Name and index of a block, preferring the annotator's explicit metadata and
 * falling back to the `\section*{...}` heading it copied them from.
 */
function readBlockIdentity(body, position, fallbackName) {
  const titleInfo = parseTitle(body);
  const name = readMetaValue(body, ABS_META_PREFIXES.BLOCK_NAME) || titleInfo?.title || `${fallbackName} ${position + 1}`;
  const index = readMetaValue(body, ABS_META_PREFIXES.BLOCK_INDEX) || titleInfo?.index || String(position + 1);

  const explicitChapter = readMetaValue(body, ABS_META_PREFIXES.CHAPTER_ORDER);
  const chapterDigits = explicitChapter ? /^(\d+)/.exec(explicitChapter) : null;
  const chapter_order = chapterDigits
    ? chapterDigits[1]
    : index.includes('.')
      ? index.split('.')[0]
      : null;

  return { name, index, chapter_order, order: parseOrder({ index }, position + 1) };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse marker-annotated academic-book solutions into blocks.
 *
 * @param {string} content annotated LaTeX
 * @returns {{ blocks: object[], warnings: string[] }}
 */
export function parseAcademicBookSolutionBlocks(content) {
  const warnings = [];

  if (typeof content !== 'string' || content.trim() === '') {
    return { blocks: [], warnings: ['Empty content — nothing to parse'] };
  }

  // --- exercise solution groups -------------------------------------------
  const exerciseBlocks = extractBlockBodies(
    content,
    ABS_MARKERS.EXERCISE_START,
    ABS_MARKERS.EXERCISE_END,
    warnings
  ).map((body, position) => {
    const identity = readBlockIdentity(body, position, 'EXERCISE');
    const solutions = parseBlockSolutions(body, warnings, identity.name);

    if (solutions.length === 0) {
      warnings.push(`${identity.name}: no solution markers found — block has no solutions`);
    }

    return {
      type: 'EXERCISE',
      ...identity,
      latex_content: body.trim(),
      solutions,
    };
  });

  // --- example solutions ---------------------------------------------------
  const exampleBlocks = extractBlockBodies(
    content,
    ABS_MARKERS.EXAMPLE_START,
    ABS_MARKERS.EXAMPLE_END,
    warnings
  ).map((body, position) => {
    const identity = readBlockIdentity(body, position, 'Example');

    // An example solution is one unit, so the block body itself is the working
    // once the metadata comments and the copied heading are removed.
    const solutionBody = body
      .split('\n')
      .filter((line) => !/^\s*%/.test(line) && !/^\s*\\section\*\{/.test(line))
      .join('\n');

    return {
      type: 'EXAMPLE',
      ...identity,
      latex_content: body.trim(),
      solutions: [
        {
          question_label: identity.index,
          answer_key: '',
          visual_path: readVisualPath(solutionBody),
          worked_solution: cleanQuestionText(solutionBody),
          explanation: '',
          sub_solutions: [],
        },
      ],
    };
  });

  const blocks = [...exerciseBlocks, ...exampleBlocks];

  // Chapter first, then examples before exercises within a chapter — the same
  // ordering the question side produces, so the two line up when displayed.
  blocks.sort((a, b) => {
    const chapterDiff = (parseInt(a.chapter_order, 10) || 0) - (parseInt(b.chapter_order, 10) || 0);
    if (chapterDiff !== 0) return chapterDiff;
    if (a.type !== b.type) return a.type === 'EXAMPLE' ? -1 : 1;
    return (a.order || 0) - (b.order || 0);
  });

  return { blocks, warnings };
}

/**
 * Total solutions across all blocks, counting sub-parts as part of their parent
 * — the same unit the question side counts in `toc_question_items`.
 */
export function countSolutions(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  if (Array.isArray(payload.blocks)) {
    return payload.blocks.reduce(
      (n, block) => n + (Array.isArray(block?.solutions) ? block.solutions.length : 0),
      0
    );
  }
  return Array.isArray(payload.solutions) ? payload.solutions.length : 0;
}

export default parseAcademicBookSolutionBlocks;
