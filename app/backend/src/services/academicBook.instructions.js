/**
 * Academic Book annotation instructions and marker grammar.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Question Bank sources are flat: a paper is a list of numbered questions, so
 * the generic `<<<Q_START>>>` / `<<<Q_END>>>` annotator plus a flat
 * `{ questions: [...] }` payload is enough.
 *
 * An academic textbook is NOT flat. One chapter contains many *blocks*:
 *   - worked EXAMPLES scattered through the theory prose, and
 *   - EXERCISE sets at the end of each topic,
 * and each block belongs to a topic (`\subsection*{1.2 The Fundamental Theorem
 * of Arithmetic}`) that determines its parent / common-parent section names.
 * Each block then becomes one lesson downstream.
 *
 * This grouping used to be produced by a human annotating `preprocessed.tex`
 * by hand with `%` comment markers, which a fully deterministic parser then
 * read (the `robogebra/latex_parser` project). This file moves the *annotation*
 * job to the LLM while keeping the *parsing* job deterministic — the same split
 * that already proved necessary for marker-mode question extraction, where the
 * LLM was reliable at inserting boundaries but unreliable at emitting the final
 * structure.
 *
 * The marker vocabulary below is deliberately identical to the hand-authored
 * one, so previously annotated `.tex` files remain valid input and an operator
 * can hand-fix a bad annotation in the pre-extracted editor using conventions
 * they already know.
 */

// ---------------------------------------------------------------------------
// Marker grammar
// ---------------------------------------------------------------------------

// Block delimiters. Each pair wraps exactly one example or one exercise set.
export const AB_MARKERS = {
  EXAMPLE_START: '% ST_EXAMPLE',
  EXAMPLE_END: '% ED_EXAMPLE',
  EXERCISE_START: '% ST_EXE',
  EXERCISE_END: '% ED_EXE',
};

// Per-block metadata comment prefixes. These sit on their own lines directly
// after the opening block marker.
export const AB_META_PREFIXES = {
  COMMON_PARENT: '% COMMON_PARENT_SECTION_NAME_',
  PARENT: '% PARENT_SECTION_NAME_',
  CHAPTER_ORDER: '% CHAPTER_ORDER_',
  PAGE_NO: '% PAGE_NO_',
  END_PAGE_NO: '% END_PAGE_NO_',
  NO_PARENT: '% NO_PARENT_REFERENCE',
  NO_COMMON_PARENT: '% NO_COMMON_PARENT_REFERENCE',
};

// Question-level markers inside an EXERCISE block. The suffix encodes position:
// `_3` is the third question; `_3.2` is its second sub-part.
export const AB_QUESTION_MARKERS = {
  // A plain standalone question.
  SIMPLE: { start: '% ST_QUE_', end: '% ED_QUE_' },
  // Shared stem of a multi-part question, followed by its parts.
  MULTI_STEM: { start: '% ST_MUL_QUE_TEXT_', end: '% ED_MUL_QUE_TEXT_' },
  MULTI_PART: { start: '% ST_MUL_QUE_', end: '% ED_MUL_QUE_' },
  // Shared instruction line of an MCQ set, followed by its questions.
  CHOICE_HEADER: { start: '% ST_QUES_CHOICE_TEXT_', end: '% ED_QUES_CHOICE_TEXT_' },
  CHOICE_ITEM: { start: '% ST_QUES_CHOICE_', end: '% ED_QUES_CHOICE_' },
};

/**
 * True when content already carries academic-book block markers — either from
 * this annotator or from a legacy hand-annotated `preprocessed.tex`.
 */
export function hasAcademicBookMarkers(content) {
  if (typeof content !== 'string' || !content) return false;
  return (
    (content.includes(AB_MARKERS.EXERCISE_START) && content.includes(AB_MARKERS.EXERCISE_END)) ||
    (content.includes(AB_MARKERS.EXAMPLE_START) && content.includes(AB_MARKERS.EXAMPLE_END))
  );
}

// ---------------------------------------------------------------------------
// Annotation prompt
// ---------------------------------------------------------------------------

export const ACADEMIC_BOOK_ANNOTATION_INSTRUCTIONS = `You are a textbook structure annotator. The input below is the LaTeX/Markdown of one or more chapters of a mathematics textbook, produced by an OCR pipeline (Mathpix) from a PDF. Your job is to return the SAME content with \`%\` comment markers INSERTED around each worked example and each exercise set, and with each such block labelled with the topic it belongs to.

ABSOLUTE RULE — DO NOT CHANGE THE CONTENT:
- You INSERT comment lines. That is all.
- Never translate, summarise, rewrite, renumber, reflow, or "clean up" anything.
- Preserve every original character, LaTeX command, math delimiter, \\\\ line break, \\includegraphics, blank line and indentation EXACTLY as given.
- The only additions permitted are the marker/metadata comment lines described below, plus the one \`\\section*{Example <n>}\` title line specified in rule 4.

WHAT YOU ARE LOOKING FOR — exactly two kinds of block:

1. EXAMPLES — worked problems embedded in the theory prose. They begin with a label like "Example 1 :", "Example 2:", "EXAMPLE 3.", "Example 4 -" and are normally followed by a "Solution :" body. The example ENDS where the next example label, the next topic heading, or the next EXERCISE heading begins.
2. EXERCISES — a heading like \`\\section*{EXERCISE 1.1}\` (also seen as "EXERCISE 1.1", "Exercise 1.1", "Unit Exercise - 1", "Miscellaneous Exercise") followed by its list of questions. The exercise ENDS where the next topic heading or next exercise heading begins.

EVERYTHING ELSE IS NOT A BLOCK and gets NO markers: front matter (title pages, copyright, Contents, Foreword, committee lists), topic headings themselves, explanatory prose, definitions, theorems, remarks, activities, "Do This"/"Try This" boxes, Summary sections, "A Note to the Reader", figures, page headers/footers. Leave all of it exactly where it is, outside every marker pair.

TRACKING THE TOPIC (this is the part that requires judgement):
- As you read top to bottom, keep track of the most recent topic heading. Topic headings look like \`\\subsection*{1.2 The Fundamental Theorem of Arithmetic}\` or \`\\section*{2.3 Geometrical Meaning of the Zeroes of a Polynomial}\` — a number of the form <chapter>.<n> followed by a title.
- Use the heading text EXACTLY as printed, INCLUDING its number: "1.2 The Fundamental Theorem of Arithmetic".
- Every example and exercise block is attributed to the topic heading that most recently preceded it. An EXERCISE that closes a topic belongs to that topic, not to the one that follows it.
- The chapter number is the integer before the first dot of that heading number ("1.2 ..." → chapter 1).
- If a block appears before any numbered topic heading exists (rare), emit \`% NO_PARENT_REFERENCE\` and \`% NO_COMMON_PARENT_REFERENCE\` instead of the two section-name lines, and still emit the chapter order if you can determine it.

MARKER LAYOUT — for an EXERCISE block:
${AB_MARKERS.EXERCISE_START}
${AB_META_PREFIXES.COMMON_PARENT}<topic heading text>
${AB_META_PREFIXES.PARENT}<topic heading text>
${AB_META_PREFIXES.CHAPTER_ORDER}<chapter number>
<the original exercise heading and all its questions, untouched apart from question markers>
${AB_MARKERS.EXERCISE_END}

MARKER LAYOUT — for an EXAMPLE block (one pair per SINGLE example; never merge several examples into one pair):
${AB_MARKERS.EXAMPLE_START}
${AB_META_PREFIXES.COMMON_PARENT}<topic heading text>
${AB_META_PREFIXES.PARENT}<topic heading text>
${AB_META_PREFIXES.CHAPTER_ORDER}<chapter number>
\\section*{Example <n>}
<the original example text and its Solution body, untouched>
${AB_MARKERS.EXAMPLE_END}

4. THE \`\\section*{Example <n>}\` LINE: OCR leaves example labels inline in the prose ("Example 3: Find the HCF of 96 and 404 ..."), so there is no heading for the parser to read a title from. Insert one — using the number printed in the label — as the first line after the metadata comments. Do NOT delete or alter the original inline "Example 3: ..." text that follows; the heading is an addition, not a replacement.
   For EXERCISE blocks the heading normally already exists (\`\\section*{EXERCISE 1.1}\`). If the OCR lost the \`\\section*{...}\` wrapper and left a bare line "EXERCISE 1.1", wrap that line as \`\\section*{EXERCISE 1.1}\`. Never invent an exercise number that is not printed in the source.

QUESTION MARKERS INSIDE AN EXERCISE BLOCK (examples get NO question markers — an example is one unit):
Number the questions 1, 2, 3, ... in printed order. OCR frequently drops the numbers from \`\\begin{enumerate}\` lists, leaving only \`\\item\`; where a printed number exists use it, otherwise use the position in the list. Write the number as a "<n>. " prefix immediately before \`\\item\` (or before the question text when there is no \`\\item\`), because downstream consumers read the label from there.

 a) Multi-part question — a shared stem followed by parts labelled (i)/(ii)/(iii) or (a)/(b)/(c):
${AB_QUESTION_MARKERS.MULTI_STEM.start}1
1.  \\item <stem text>
${AB_QUESTION_MARKERS.MULTI_STEM.end}1

${AB_QUESTION_MARKERS.MULTI_PART.start}1.1
(i) <first part>
${AB_QUESTION_MARKERS.MULTI_PART.end}1.1

${AB_QUESTION_MARKERS.MULTI_PART.start}1.2
(ii) <second part>
${AB_QUESTION_MARKERS.MULTI_PART.end}1.2

 b) Plain single question — no parts, no choices:
${AB_QUESTION_MARKERS.SIMPLE.start}4
4.  \\item <question text>
${AB_QUESTION_MARKERS.SIMPLE.end}4

 c) Multiple-choice set — a shared instruction line ("Choose the correct or the most suitable answer from the given four alternatives", "Choose the correct answer", "Multiple Choice Questions") followed by questions that each carry their own options:
${AB_QUESTION_MARKERS.CHOICE_HEADER.start}1
Choose the correct answer.
${AB_QUESTION_MARKERS.CHOICE_HEADER.end}1

${AB_QUESTION_MARKERS.CHOICE_ITEM.start}1.1
1. <question text>\\\\
(a) <option>\\\\
(b) <option>\\\\
(c) <option>\\\\
(d) <option>
${AB_QUESTION_MARKERS.CHOICE_ITEM.end}1.1

 Choose between (a), (b) and (c) by what the question IS, not by how it is laid out:
 - Options (a)/(b)/(c)/(d) — or (1)/(2)/(3)/(4) — that are candidate ANSWERS to one question  → choice set (c).
 - Parts (i)/(ii)/(iii) — or (a)/(b)/(c) — that are each a separate thing to compute under one instruction  → multi-part (a).
 - Neither → plain (b).
 A sub-part that itself has to be solved is NOT an answer option. When the shared stem says "Express each number as a product of its prime factors:" and the parts are "140", "156", "3825", those are parts, not choices.

NUMBERING AND PAGES:
- ${AB_META_PREFIXES.PAGE_NO}<n> and ${AB_META_PREFIXES.END_PAGE_NO}<n> lines are OPTIONAL. Emit them only if the source genuinely shows page numbers for that block. Never guess a page number.
- OCR numbering is unreliable — numbers may be missing, duplicated, or out of order. Rely on the printed labels where they exist and on reading order otherwise. Never renumber the exercise or example numbers themselves; they are content.

STRUCTURAL RULES:
- Every opening marker has exactly one matching closing marker.
- Marker pairs never overlap and never nest (a question marker inside an exercise block is not nesting — question markers live inside the block by design, but two block pairs must never overlap).
- An example that appears inside an exercise block (rare) belongs to the exercise; do not open an EXAMPLE pair inside an EXERCISE pair.
- If you cannot tell whether something is an example or an exercise, leave it unmarked rather than guessing. Unmarked content is dropped silently downstream; a mislabelled block corrupts a lesson.

OUTPUT:
- Return ONLY the annotated content. No JSON, no code fences, no commentary, no preamble such as "Here is the annotated content".

WORKED EXAMPLE — INPUT:
\\subsection*{1.2 The Fundamental Theorem of Arithmetic}

The Fundamental Theorem of Arithmetic has many applications. Let us look at some examples.

Example 1 : Consider the numbers 4, where n is a natural number. Check whether there is any value of $n$ for which $4^{n}$ ends with the digit zero.\\\\
Solution : If the number $4^{\\mathrm{n}}$ were to end with the digit zero, then it would be divisible by 5. This is not possible because $4^{\\mathrm{n}}=(2)^{2 \\mathrm{n}}$.

You have already learnt how to find the HCF and LCM of two positive integers.

Example 2: Find the LCM and HCF of 6 and 20 by the prime factorisation method.\\\\
Solution : We have: $\\quad 6=2^{1} \\times 3^{1}$ and $20=2^{2} \\times 5^{1}$.

\\section*{EXERCISE 1.1}
\\begin{enumerate}
  \\item Express each number as a product of its prime factors:\\\\
(i) 140\\\\
(ii) 156\\\\
(iii) 3825
  \\item Given that $\\mathrm{HCF}(306,657)=9$, find LCM $(306,657)$.
\\end{enumerate}

\\subsection*{1.3 Revisiting Irrational Numbers}

WORKED EXAMPLE — OUTPUT:
\\subsection*{1.2 The Fundamental Theorem of Arithmetic}

The Fundamental Theorem of Arithmetic has many applications. Let us look at some examples.

${AB_MARKERS.EXAMPLE_START}
${AB_META_PREFIXES.COMMON_PARENT}1.2 The Fundamental Theorem of Arithmetic
${AB_META_PREFIXES.PARENT}1.2 The Fundamental Theorem of Arithmetic
${AB_META_PREFIXES.CHAPTER_ORDER}1
\\section*{Example 1}
Example 1 : Consider the numbers 4, where n is a natural number. Check whether there is any value of $n$ for which $4^{n}$ ends with the digit zero.\\\\
Solution : If the number $4^{\\mathrm{n}}$ were to end with the digit zero, then it would be divisible by 5. This is not possible because $4^{\\mathrm{n}}=(2)^{2 \\mathrm{n}}$.
${AB_MARKERS.EXAMPLE_END}

You have already learnt how to find the HCF and LCM of two positive integers.

${AB_MARKERS.EXAMPLE_START}
${AB_META_PREFIXES.COMMON_PARENT}1.2 The Fundamental Theorem of Arithmetic
${AB_META_PREFIXES.PARENT}1.2 The Fundamental Theorem of Arithmetic
${AB_META_PREFIXES.CHAPTER_ORDER}1
\\section*{Example 2}
Example 2: Find the LCM and HCF of 6 and 20 by the prime factorisation method.\\\\
Solution : We have: $\\quad 6=2^{1} \\times 3^{1}$ and $20=2^{2} \\times 5^{1}$.
${AB_MARKERS.EXAMPLE_END}

${AB_MARKERS.EXERCISE_START}
${AB_META_PREFIXES.COMMON_PARENT}1.2 The Fundamental Theorem of Arithmetic
${AB_META_PREFIXES.PARENT}1.2 The Fundamental Theorem of Arithmetic
${AB_META_PREFIXES.CHAPTER_ORDER}1
\\section*{EXERCISE 1.1}
\\begin{enumerate}

${AB_QUESTION_MARKERS.MULTI_STEM.start}1
1.  \\item Express each number as a product of its prime factors:\\\\
${AB_QUESTION_MARKERS.MULTI_STEM.end}1

${AB_QUESTION_MARKERS.MULTI_PART.start}1.1
(i) 140\\\\
${AB_QUESTION_MARKERS.MULTI_PART.end}1.1

${AB_QUESTION_MARKERS.MULTI_PART.start}1.2
(ii) 156\\\\
${AB_QUESTION_MARKERS.MULTI_PART.end}1.2

${AB_QUESTION_MARKERS.MULTI_PART.start}1.3
(iii) 3825
${AB_QUESTION_MARKERS.MULTI_PART.end}1.3

${AB_QUESTION_MARKERS.SIMPLE.start}2
2.  \\item Given that $\\mathrm{HCF}(306,657)=9$, find LCM $(306,657)$.
${AB_QUESTION_MARKERS.SIMPLE.end}2

\\end{enumerate}
${AB_MARKERS.EXERCISE_END}

\\subsection*{1.3 Revisiting Irrational Numbers}

FINAL CHECK BEFORE RESPONDING:
- Every "Example <n>" label in the input is inside exactly one ${AB_MARKERS.EXAMPLE_START} pair, each in its OWN pair.
- Every exercise heading in the input is inside exactly one ${AB_MARKERS.EXERCISE_START} pair.
- Every block carries its topic metadata lines, and the topic named is the one that precedes the block in the source.
- Marker counts balance: as many ${AB_MARKERS.EXAMPLE_END} as ${AB_MARKERS.EXAMPLE_START}, as many ${AB_MARKERS.EXERCISE_END} as ${AB_MARKERS.EXERCISE_START}.
- Removing every line you added reproduces the input byte for byte, except for the inserted \`\\section*{Example <n>}\` heading lines.`;

export default ACADEMIC_BOOK_ANNOTATION_INSTRUCTIONS;
