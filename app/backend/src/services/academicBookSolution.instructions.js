/**
 * Academic Book *solution* annotation instructions and marker grammar.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The existing solution annotator (`SOLUTION_PRE_EXTRACTION_INSTRUCTIONS` in
 * `preExtraction.service.js`) is built for competitive-exam answer keys, where a
 * solution announces itself with a header like "8. (D)" or "22. (11.00)". A
 * textbook solutions guide has none of that: solutions are worked prose grouped
 * under the exercise they belong to, and the only reliable identity a solution
 * carries is *which exercise* it sits under plus *which question number* it
 * answers.
 *
 * That identity is the whole point. A chapter has six exercises that each
 * contain a question 4, so a flat `question_label: "4"` cannot be matched back
 * to a question — six of them would collide. The markers below therefore group
 * solutions into blocks that name their exercise, exactly mirroring
 * `academicBook.instructions.js` on the question side. A solution is then keyed
 * by (block index, question label, sub-part label), which is unique.
 *
 * A useful consequence: because every block names its own exercise, the source
 * document does not have to be split per exercise. One merged PDF containing
 * example solutions and every exercise's solutions, in any order, annotates and
 * parses correctly.
 */

import { AB_META_PREFIXES } from './academicBook.instructions.js';

// ---------------------------------------------------------------------------
// Marker grammar
// ---------------------------------------------------------------------------

// Block delimiters. Deliberately distinct from the question-side `% ST_EXE` /
// `% ST_EXAMPLE` so an annotated solutions document can never be mistaken for an
// annotated chapter, and vice versa.
export const ABS_MARKERS = {
  EXERCISE_START: '% ST_SOL_EXE',
  EXERCISE_END: '% ED_SOL_EXE',
  EXAMPLE_START: '% ST_SOL_EXAMPLE',
  EXAMPLE_END: '% ED_SOL_EXAMPLE',
};

// Per-block metadata comment prefixes, on their own lines after the opener.
// CHAPTER_ORDER is shared with the question side so both agree on one spelling.
export const ABS_META_PREFIXES = {
  BLOCK_NAME: '% SOL_BLOCK_NAME_',
  BLOCK_INDEX: '% SOL_BLOCK_INDEX_',
  CHAPTER_ORDER: AB_META_PREFIXES.CHAPTER_ORDER,
};

// Solution markers inside a block. The suffix encodes position exactly as the
// question markers do: `_3` is the solution to question 3, `_3.2` its second
// sub-part.
export const ABS_SOLUTION_MARKERS = {
  SOLUTION: { start: '% ST_SOL_', end: '% ED_SOL_' },
};

// Optional, for books that print a short answer key alongside the working.
export const ABS_ANSWER_KEY_PREFIX = '% ANSWER_KEY_';

/**
 * True when content already carries academic-book solution block markers.
 */
export function hasAcademicBookSolutionMarkers(content) {
  if (typeof content !== 'string' || !content) return false;
  return (
    (content.includes(ABS_MARKERS.EXERCISE_START) && content.includes(ABS_MARKERS.EXERCISE_END)) ||
    (content.includes(ABS_MARKERS.EXAMPLE_START) && content.includes(ABS_MARKERS.EXAMPLE_END))
  );
}

// ---------------------------------------------------------------------------
// Annotation prompt
// ---------------------------------------------------------------------------

export const ACADEMIC_BOOK_SOLUTION_ANNOTATION_INSTRUCTIONS = `You are a textbook solutions annotator. The input below is the LaTeX/Markdown of a solutions guide for a mathematics textbook, produced by an OCR pipeline (Mathpix) from a PDF. It contains worked solutions grouped under the exercise (or example) they answer. Your job is to return the SAME content with \`%\` comment markers INSERTED around each group of solutions and around each individual solution.

ABSOLUTE RULE — DO NOT CHANGE THE CONTENT:
- You INSERT comment lines. That is all.
- Never translate, summarise, rewrite, renumber, reflow, or "clean up" anything.
- Preserve every original character, LaTeX command, math delimiter, \\\\ line break, \\includegraphics, image link, blank line and indentation EXACTLY as given.
- The only additions permitted are the marker/metadata comment lines described below.

WHAT YOU ARE LOOKING FOR — exactly two kinds of block:

1. EXERCISE SOLUTION GROUPS — the solutions belonging to one exercise. They start at a heading naming the exercise ("EXERCISE 1.1", "Exercise 1.1", "Solutions to Exercise 1.2", "Unit Exercise - 1", "Miscellaneous Exercise") and run until the next such heading, the next example-solutions heading, or the end of the document.
2. EXAMPLE SOLUTIONS — a solution to a single worked example, labelled "Example 3", "Example 3 :", "Solution to Example 3". One marker pair per SINGLE example; never merge several examples into one pair.

EVERYTHING ELSE IS NOT A BLOCK and gets NO markers: title pages, contents, prefaces, chapter headings that name no exercise, page headers/footers, general notes. Leave it exactly where it is, outside every marker pair.

BLOCK IDENTITY (this is the part that matters most):
- ${ABS_META_PREFIXES.BLOCK_NAME} carries the heading text EXACTLY as printed ("EXERCISE 1.1").
- ${ABS_META_PREFIXES.BLOCK_INDEX} carries just the number from that heading ("1.1"). For an example block it is the example number ("3").
- ${ABS_META_PREFIXES.CHAPTER_ORDER} carries the chapter number — the integer before the first dot of the index ("1.1" → 1).
- Copy these from what is PRINTED. Never invent an exercise number that does not appear in the source. If a heading genuinely has no number, still emit the name line and omit the index line.

MARKER LAYOUT — for an EXERCISE solution group:
${ABS_MARKERS.EXERCISE_START}
${ABS_META_PREFIXES.BLOCK_NAME}<heading text>
${ABS_META_PREFIXES.BLOCK_INDEX}<index>
${ABS_META_PREFIXES.CHAPTER_ORDER}<chapter number>
<the original heading and all its solutions, untouched apart from solution markers>
${ABS_MARKERS.EXERCISE_END}

MARKER LAYOUT — for an EXAMPLE solution:
${ABS_MARKERS.EXAMPLE_START}
${ABS_META_PREFIXES.BLOCK_NAME}<heading text, e.g. Example 3>
${ABS_META_PREFIXES.BLOCK_INDEX}<example number>
${ABS_META_PREFIXES.CHAPTER_ORDER}<chapter number>
<the original solution text, untouched>
${ABS_MARKERS.EXAMPLE_END}

SOLUTION MARKERS INSIDE AN EXERCISE BLOCK:
Number the solutions by the QUESTION NUMBER THEY ANSWER, as printed ("1.", "2.", "Q3.", "Ans 4."). Do not renumber by position: a solutions guide often skips a question, and inventing consecutive numbers would attach every later solution to the wrong question.

 a) Solution to a plain question:
${ABS_SOLUTION_MARKERS.SOLUTION.start}2
2. Since $\\sqrt{2}$ is irrational, ...
${ABS_SOLUTION_MARKERS.SOLUTION.end}2

 b) Solution to a multi-part question — a shared opening (if any) followed by parts labelled (i)/(ii)/(iii) or (a)/(b)/(c). The shared opening takes the plain suffix, each part takes a sub-suffix in printed order:
${ABS_SOLUTION_MARKERS.SOLUTION.start}1
1. We check each statement in turn.
${ABS_SOLUTION_MARKERS.SOLUTION.end}1

${ABS_SOLUTION_MARKERS.SOLUTION.start}1.1
(i) True, because every natural number is a whole number.
${ABS_SOLUTION_MARKERS.SOLUTION.end}1.1

${ABS_SOLUTION_MARKERS.SOLUTION.start}1.2
(ii) False, because $-1$ is an integer but not a whole number.
${ABS_SOLUTION_MARKERS.SOLUTION.end}1.2

 KEEP THE PRINTED PART LABEL "(i)" / "(ii)" INSIDE its marker pair. It is what the solution is matched on downstream; a part whose label is dropped cannot be attached to its question.
 If a question's solution has no separate parts, use form (a) — do NOT invent sub-parts.

 c) An answer key printed alongside the working is optional extra metadata, on its own line directly after the opening marker:
${ABS_SOLUTION_MARKERS.SOLUTION.start}7
${ABS_ANSWER_KEY_PREFIX}B
7. ...working...
${ABS_SOLUTION_MARKERS.SOLUTION.end}7

EXAMPLE BLOCKS GET NO INNER SOLUTION MARKERS — an example solution is one unit.

IMAGES:
- Solutions often contain image references like ![](https://cdn.mathpix.com/cropped/xxx.jpg). KEEP them exactly where they are, inside the solution's marker pair. Never drop an image and never move it.

STRUCTURAL RULES:
- Every opening marker has exactly one matching closing marker, with the SAME suffix.
- Block pairs never overlap and never nest. Solution markers live inside a block by design; that is not nesting.
- A solution runs until the next solution's number, the end of its block, or a part label belonging to the next sub-part.
- If you cannot tell which question a solution answers, leave it unmarked rather than guessing. Unmarked content is dropped silently downstream; a mislabelled solution attaches working to the wrong question, which is worse.

OUTPUT:
- Return ONLY the annotated content. No JSON, no code fences, no commentary, no preamble such as "Here is the annotated content".

WORKED EXAMPLE — INPUT:
\\section*{EXERCISE 1.1}
\\begin{enumerate}
  \\item[1.] Yes. Zero is a rational number, since $0=\\frac{0}{1}$.
  \\item[2.] Six rational numbers between 3 and 4 are $\\frac{22}{7}, \\frac{23}{7}$.
  \\item[4.] State whether true or false.\\\\
(i) True, since the collection of whole numbers contains all natural numbers.\\\\
(ii) False, because $-5$ is an integer but not a whole number.
\\end{enumerate}

\\section*{EXERCISE 1.2}
\\begin{enumerate}
  \\item[1.] (i) True. (ii) False.
\\end{enumerate}

WORKED EXAMPLE — OUTPUT:
${ABS_MARKERS.EXERCISE_START}
${ABS_META_PREFIXES.BLOCK_NAME}EXERCISE 1.1
${ABS_META_PREFIXES.BLOCK_INDEX}1.1
${ABS_META_PREFIXES.CHAPTER_ORDER}1
\\section*{EXERCISE 1.1}
\\begin{enumerate}

${ABS_SOLUTION_MARKERS.SOLUTION.start}1
  \\item[1.] Yes. Zero is a rational number, since $0=\\frac{0}{1}$.
${ABS_SOLUTION_MARKERS.SOLUTION.end}1

${ABS_SOLUTION_MARKERS.SOLUTION.start}2
  \\item[2.] Six rational numbers between 3 and 4 are $\\frac{22}{7}, \\frac{23}{7}$.
${ABS_SOLUTION_MARKERS.SOLUTION.end}2

${ABS_SOLUTION_MARKERS.SOLUTION.start}4
  \\item[4.] State whether true or false.\\\\
${ABS_SOLUTION_MARKERS.SOLUTION.end}4

${ABS_SOLUTION_MARKERS.SOLUTION.start}4.1
(i) True, since the collection of whole numbers contains all natural numbers.\\\\
${ABS_SOLUTION_MARKERS.SOLUTION.end}4.1

${ABS_SOLUTION_MARKERS.SOLUTION.start}4.2
(ii) False, because $-5$ is an integer but not a whole number.
${ABS_SOLUTION_MARKERS.SOLUTION.end}4.2

\\end{enumerate}
${ABS_MARKERS.EXERCISE_END}

${ABS_MARKERS.EXERCISE_START}
${ABS_META_PREFIXES.BLOCK_NAME}EXERCISE 1.2
${ABS_META_PREFIXES.BLOCK_INDEX}1.2
${ABS_META_PREFIXES.CHAPTER_ORDER}1
\\section*{EXERCISE 1.2}
\\begin{enumerate}

${ABS_SOLUTION_MARKERS.SOLUTION.start}1
  \\item[1.] (i) True. (ii) False.
${ABS_SOLUTION_MARKERS.SOLUTION.end}1

\\end{enumerate}
${ABS_MARKERS.EXERCISE_END}

Note in the second block that "(i) True. (ii) False." is printed as ONE run of text, not as separate parts on their own lines. Do not split it into sub-suffixes — mark it as one solution and leave the text intact.

FINAL CHECK BEFORE RESPONDING:
- Every exercise heading in the input opens exactly one ${ABS_MARKERS.EXERCISE_START} pair.
- Every solution sits inside exactly one ${ABS_SOLUTION_MARKERS.SOLUTION.start}<n> pair, and the <n> is the printed question number, not a position counter.
- Every block carries its name, index and chapter order.
- Marker counts balance: as many ${ABS_MARKERS.EXERCISE_END} as ${ABS_MARKERS.EXERCISE_START}, as many ${ABS_MARKERS.EXAMPLE_END} as ${ABS_MARKERS.EXAMPLE_START}, and every ${ABS_SOLUTION_MARKERS.SOLUTION.start}<n> has an ${ABS_SOLUTION_MARKERS.SOLUTION.end}<n> with the identical suffix.
- Removing every line you added reproduces the input byte for byte.`;

export default ACADEMIC_BOOK_SOLUTION_ANNOTATION_INSTRUCTIONS;
