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
//
// SOLUTION_START / SOLUTION_END split a worked example's statement from its
// working. Textbooks that print a "Solution :" label let the parser find that
// boundary on its own; State board books print the working straight after the
// statement with no label at all, and nothing deterministic separates
// "Find the rank of the matrix ..." from the "Let A = ..." that follows. The
// annotator marks it instead.
//
// The spelling deliberately avoids a `% ST_EXAMPLE_...` prefix: block bodies are
// located with a plain `indexOf(EXAMPLE_START)`, so a marker starting with
// `% ST_EXAMPLE` would be mistaken for a block opener and swallow the chapter.
export const AB_MARKERS = {
  EXAMPLE_START: '% ST_EXAMPLE',
  EXAMPLE_END: '% ED_EXAMPLE',
  EXERCISE_START: '% ST_EXE',
  EXERCISE_END: '% ED_EXE',
  SOLUTION_START: '% ST_SOLUTION',
  SOLUTION_END: '% ED_SOLUTION',
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
- The only additions permitted are the marker/metadata comment lines described below, plus the one \`\\section*{Example <n>}\` title line specified in rule 4. In particular, the ${AB_MARKERS.SOLUTION_START} / ${AB_MARKERS.SOLUTION_END} pair is INSERTED around working that is already there — never write, complete, correct or shorten a solution yourself.

WHAT YOU ARE LOOKING FOR — exactly two kinds of block:

1. EXAMPLES — worked problems embedded in the theory prose. They begin with a label like "Example 1 :", "Example 2:", "EXAMPLE 3.", "Example 4 -" and are normally followed by a "Solution :" body. The example ENDS where the next example label, the next topic heading, or the next EXERCISE heading begins.
2. EXERCISES — a heading like \`\\section*{EXERCISE 1.1}\` (also seen as "EXERCISE 1.1", "Exercise 1.1", "Unit Exercise - 1", "Miscellaneous Exercise") followed by its list of questions. The exercise ENDS where the next topic heading or next exercise heading begins.

EVERYTHING ELSE IS NOT A BLOCK and gets NO markers: front matter (title pages, copyright, Contents, Foreword, committee lists), topic headings themselves, explanatory prose, definitions, theorems, remarks, activities, "Do This"/"Try This" boxes, Summary sections, "A Note to the Reader", figures, page headers/footers. Leave all of it exactly where it is, outside every marker pair.

TRACKING THE TOPIC (this is the part that requires judgement):
- As you read top to bottom, keep track of the numbered headings in force. They look like \`\\subsection*{1.2 Inverse of a Non-Singular Square Matrix}\` or \`\\section*{2.3 Geometrical Meaning of the Zeroes of a Polynomial}\` — a number of the form <chapter>.<n>[.<n>] followed by a title.
- Use the heading text EXACTLY as printed, INCLUDING its number: "1.2 Inverse of a Non-Singular Square Matrix".
- Headings come at two depths:
    * A two-part number ("1.1 Rank of a Matrix") is a TOPIC.
    * A three-part number ("1.1.3 Echelon form and finding the rank of the matrix") is a SUB-TOPIC of the topic whose number prefixes it.
- EXAMPLES and EXERCISES are labelled DIFFERENTLY, and this is the single most common place to get it wrong:
    * An EXAMPLE illustrates the sub-topic it sits in. ${AB_META_PREFIXES.COMMON_PARENT} takes the two-part TOPIC; ${AB_META_PREFIXES.PARENT} takes the three-part SUB-TOPIC in force. Both lines are always emitted; when there is no sub-topic heading, the topic is repeated on both.
    * An EXERCISE gets ONE line — ${AB_META_PREFIXES.COMMON_PARENT} carrying the exercise's OWN heading text ("Exercise 1.1"). It gets NO ${AB_META_PREFIXES.PARENT} line at all. An exercise belongs to the chapter, not to whichever sub-topic happens to sit immediately above it, so do not copy the preceding \`\\subsection*{1.1.4 ...}\` heading into it.
  Worked through, for a chapter laid out like this:
    \\subsection*{1.1 Rank of a Matrix}
    \\subsection*{1.1.1 Concept}                                  ← Examples 1.1 – 1.5 sit here
    \\subsection*{1.1.3 Echelon form and finding the rank ...}     ← Examples 1.6 – 1.8
    \\subsection*{1.1.4 Testing the consistency of ... equations}  ← Examples 1.9 – 1.18
    \\section*{Exercise 1.1}                                      ← the exercise for topic 1.1
  Example 1.7 carries:
    ${AB_META_PREFIXES.COMMON_PARENT}1.1 Rank of a Matrix
    ${AB_META_PREFIXES.PARENT}1.1.3 Echelon form and finding the rank of the matrix (upto the order of 3x4)
  and Exercise 1.1 — despite following 1.1.4 — carries only:
    ${AB_META_PREFIXES.COMMON_PARENT}Exercise 1.1
- Exercises that close the CHAPTER rather than a topic — "Exercise 1.4" arriving after every topic is done, "Exercise (Miscellaneous problems)", "Unit Exercise" — are labelled exactly the same way: their own heading text on ${AB_META_PREFIXES.COMMON_PARENT}, no ${AB_META_PREFIXES.PARENT} line.
- Use the sub-topic heading text in FULL on an example's ${AB_META_PREFIXES.PARENT} line, however long — "1.1.4 Testing the consistency of non homogeneous linear equations (two and three variables) by rank method." is copied complete, not shortened to "1.1.4 Testing the consistency".
- An example is attributed to the headings that precede it in the source, never to the one that follows it.
- The chapter number is the integer before the first dot of that heading number ("1.2.1 ..." → chapter 1).
- If a block appears before any numbered topic heading exists (rare), emit \`% NO_PARENT_REFERENCE\` and \`% NO_COMMON_PARENT_REFERENCE\` instead of the two section-name lines, and still emit the chapter order if you can determine it.

MARKER LAYOUT — every marker and metadata comment sits ALONE on its own line, starting at column 1 with "% ". Never put two markers on one line, never append a marker to the end of a content line, and never let a metadata line run onto the next line.

MARKER LAYOUT — for an EXERCISE block (note: NO ${AB_META_PREFIXES.PARENT} line):
${AB_MARKERS.EXERCISE_START}
${AB_META_PREFIXES.COMMON_PARENT}<this exercise's own heading text, e.g. Exercise 1.1>
${AB_META_PREFIXES.CHAPTER_ORDER}<chapter number>
${AB_META_PREFIXES.PAGE_NO}<page the block starts on — omit this line if the source shows no page number>
<the original exercise heading and all its questions, untouched apart from question markers>
${AB_META_PREFIXES.END_PAGE_NO}<page the block ends on — omit if PAGE_NO was omitted>
${AB_MARKERS.EXERCISE_END}

MARKER LAYOUT — for an EXAMPLE block (one pair per SINGLE example; never merge several examples into one pair):
${AB_MARKERS.EXAMPLE_START}
${AB_META_PREFIXES.COMMON_PARENT}<topic heading text>
${AB_META_PREFIXES.PARENT}<sub-topic heading text, or the topic again when there is no sub-topic>
${AB_META_PREFIXES.CHAPTER_ORDER}<chapter number>
${AB_META_PREFIXES.PAGE_NO}<page the block starts on — omit this line if the source shows no page number>
\\section*{Example <n>}
<the example STATEMENT — the part that poses the problem, untouched>
${AB_MARKERS.SOLUTION_START}
<the WORKING that answers it — untouched>
${AB_MARKERS.SOLUTION_END}
${AB_META_PREFIXES.END_PAGE_NO}<page the block ends on — omit if PAGE_NO was omitted>
${AB_MARKERS.EXAMPLE_END}

The metadata lines are ordered exactly as shown: COMMON_PARENT, PARENT, CHAPTER_ORDER, then PAGE_NO — and END_PAGE_NO is the LAST line of the block, immediately before the closing marker, AFTER the content. A fully marked-up example therefore looks like:
${AB_MARKERS.EXAMPLE_START}
${AB_META_PREFIXES.COMMON_PARENT}1.2 Inverse of a Non-Singular Square Matrix
${AB_META_PREFIXES.PARENT}1.2.1 Adjoint of a Square Matrix
${AB_META_PREFIXES.CHAPTER_ORDER}1
${AB_META_PREFIXES.PAGE_NO}3
\\section*{Example 1.1}
$$
\\text { If } A=\\left[\\begin{array}{ccc}
8 & -6 & 2
\\end{array}\\right] \\text {, verify that } A(\\operatorname{adj} A)=|A| I_{3} \\text {. }
$$
${AB_META_PREFIXES.END_PAGE_NO}3
${AB_MARKERS.EXAMPLE_END}

4. THE \`\\section*{Example <n>}\` LINE: OCR leaves example labels inline in the prose ("Example 3: Find the HCF of 96 and 404 ..."), so there is no heading for the parser to read a title from. Insert one — using the number printed in the label — as the first line after the metadata comments. Do NOT delete or alter the original inline "Example 3: ..." text that follows; the heading is an addition, not a replacement.
   Copy the example number EXACTLY as printed: "Example 1.1" stays \`\\section*{Example 1.1}\`, "Example 12" stays \`\\section*{Example 12}\`. Never renumber, never flatten a dotted number to a plain one, and never invent a number the source does not print.
   For EXERCISE blocks the heading normally already exists (\`\\section*{EXERCISE 1.1}\`). If the OCR lost the \`\\section*{...}\` wrapper and left a bare line "EXERCISE 1.1", wrap that line as \`\\section*{EXERCISE 1.1}\`. Never invent an exercise number that is not printed in the source.

SPLITTING AN EXAMPLE INTO STATEMENT AND SOLUTION — EVERY EXAMPLE BLOCK MUST DO THIS:
A worked example is a question plus its answer, and downstream they are stored in two separate fields. Wrap the answer part — and only the answer part — in ${AB_MARKERS.SOLUTION_START} … ${AB_MARKERS.SOLUTION_END}, each marker on its own line, inside the ${AB_MARKERS.EXAMPLE_START} pair.

 a) The book PRINTS a solution label ("Solution :", "Solution 1 :", "Sol.", "தீர்வு :"). Put ${AB_MARKERS.SOLUTION_START} on the line immediately BEFORE that label. Leave the label itself in place — do not delete it.

 b) The book prints NO label and the working simply follows the statement. This is the common case in State board books and it is the one that goes wrong most often. Find the boundary from the content:
    * The STATEMENT is the sentence that poses the problem — normally one sentence, ending with the thing to be done: "Find the rank of the matrix ...", "Show that ...", "verify that $A(\\operatorname{adj} A)=|A| I_{3}$.", "If $A=...$ is non-singular, find $A^{-1}$."
    * The SOLUTION is everything after it: the restatement of the data ("Let $A=\\left(...\\right)$"), every derivation line, every displayed equation, and the final answer ("$\\therefore \\rho(A)=3$").
    * A line that begins "Let ...", "We have ...", "Consider ...", "Order of $A$ is ...", or that opens a $$ ... $$ display restating the given data, is the FIRST line of the solution, not part of the statement.

 c) A worked example essentially ALWAYS has working — that is what makes it a worked example. If you are about to close an ${AB_MARKERS.EXAMPLE_START} block without a ${AB_MARKERS.SOLUTION_START} pair, re-read it: the working is nearly always there and unlabelled, and you have put the whole thing on the statement side. Only when the block truly holds a bare statement and nothing else do you omit the pair — and never invent working to fill one.

WORKED EXAMPLE OF THE UNLABELLED CASE — INPUT:
Example 1.3 : Find the rank of the matrix $\\left(\\begin{array}{ccc}0 & -1 & 5 \\\\ 2 & 4 & -6 \\\\ 1 & 1 & 5\\end{array}\\right)$
Let
$$A=\\left(\\begin{array}{ccc}
0 & -1 & 5
\\end{array}\\right)$$
Order of $A$ is 3 × 3.
$$\\therefore \\rho(A) \\leq 3$$
There is a minor of order 3 , which is not zero
$$\\therefore \\rho(A)=3 \\text {. }$$

WORKED EXAMPLE OF THE UNLABELLED CASE — OUTPUT:
${AB_MARKERS.EXAMPLE_START}
${AB_META_PREFIXES.COMMON_PARENT}1.3 Elementary Transformations of a Matrix
${AB_META_PREFIXES.PARENT}1.3 Elementary Transformations of a Matrix
${AB_META_PREFIXES.CHAPTER_ORDER}1
\\section*{Example 1.3}
Example 1.3 : Find the rank of the matrix $\\left(\\begin{array}{ccc}0 & -1 & 5 \\\\ 2 & 4 & -6 \\\\ 1 & 1 & 5\\end{array}\\right)$
${AB_MARKERS.SOLUTION_START}
Let
$$A=\\left(\\begin{array}{ccc}
0 & -1 & 5
\\end{array}\\right)$$
Order of $A$ is 3 × 3.
$$\\therefore \\rho(A) \\leq 3$$
There is a minor of order 3 , which is not zero
$$\\therefore \\rho(A)=3 \\text {. }$$
${AB_MARKERS.SOLUTION_END}
${AB_MARKERS.EXAMPLE_END}

Note what did NOT happen there: the statement was not repeated inside the solution, the working was not left attached to the statement, and not one character of either was rewritten.

QUESTION MARKERS INSIDE AN EXERCISE BLOCK (examples get NO question markers — an example is one unit):
Number the questions 1, 2, 3, ... in printed order. OCR frequently drops the numbers from \`\\begin{enumerate}\` lists, leaving only \`\\item\`; where a printed number exists ALWAYS use it, and only fall back to the position in the list when no number is printed anywhere in the exercise. A printed number outranks position: when the source shows "9" and "10." as loose lines and then resumes with \`\\setcounter{enumi}{10}\`, the resumed item is question 11, not question 9. Renumbering from position there collides two questions onto one suffix and one of them is silently dropped. Write the number as a "<n>. " prefix immediately before \`\\item\` (or before the question text when there is no \`\\item\`), because downstream consumers read the label from there.

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

OCR BREAKS LISTS — MARK EVERY QUESTION, NOT EVERY \`\\item\`:
An exercise's questions are NOT all inside \`\\begin{enumerate}\`. Mathpix routinely ends the list early, leaves one or two questions as loose lines in the middle of the page, then reopens a list with \`\\setcounter{enumi}{n}\` to resume. The loose questions are ordinary questions of that exercise and MUST be marked exactly like the rest. Skipping them is the single largest source of missing questions — an exercise printed with 25 questions comes back with 22.

The same applies to sub-parts: when a multi-part question's parts (i) and (ii) are inside the list and (iii) and (iv) trail after \`\\end{enumerate}\`, all four belong to that question — mark them ${AB_QUESTION_MARKERS.MULTI_PART.start}9.1 through ${AB_QUESTION_MARKERS.MULTI_PART.start}9.4.

EXAMPLE OF THE BROKEN-LIST CASE — INPUT:
\\begin{enumerate}
  \\item The domain of the function $f(x)=\\sin ^{-1} \\sqrt{x-1}$ is\\\\
(1) $[1,2]$\\\\
(2) $[-1,1]$
\\end{enumerate}

9 If $x=\\frac{1}{5}$, the value of $\\cos \\left(\\cos ^{-1} x\\right)$ is\\\\
(1) $\\frac{1}{5}$\\\\
(2) $-\\frac{1}{5}$\\\\
10. $\\tan ^{-1}\\left(\\frac{1}{4}\\right)$ is equal to\\\\
(1) $\\tan ^{-1}\\left(\\frac{1}{2}\\right)$\\\\
(2) $\\sin ^{-1}\\left(\\frac{3}{5}\\right)$

\\begin{enumerate}
  \\setcounter{enumi}{10}
  \\item If $\\cot ^{-1} 2$ and $\\cot ^{-1} 3$ are two angles of a triangle, then the third angle is\\\\
(1) $\\frac{\\pi}{4}$\\\\
(2) $\\frac{\\pi}{3}$
\\end{enumerate}

EXAMPLE OF THE BROKEN-LIST CASE — OUTPUT (three questions, numbered 8, 9, 10 and 11 by what is PRINTED):
\\begin{enumerate}

${AB_QUESTION_MARKERS.CHOICE_ITEM.start}1.8
8.  \\item The domain of the function $f(x)=\\sin ^{-1} \\sqrt{x-1}$ is\\\\
(1) $[1,2]$\\\\
(2) $[-1,1]$
${AB_QUESTION_MARKERS.CHOICE_ITEM.end}1.8

\\end{enumerate}

${AB_QUESTION_MARKERS.CHOICE_ITEM.start}1.9
9 If $x=\\frac{1}{5}$, the value of $\\cos \\left(\\cos ^{-1} x\\right)$ is\\\\
(1) $\\frac{1}{5}$\\\\
(2) $-\\frac{1}{5}$\\\\
${AB_QUESTION_MARKERS.CHOICE_ITEM.end}1.9

${AB_QUESTION_MARKERS.CHOICE_ITEM.start}1.10
10. $\\tan ^{-1}\\left(\\frac{1}{4}\\right)$ is equal to\\\\
(1) $\\tan ^{-1}\\left(\\frac{1}{2}\\right)$\\\\
(2) $\\sin ^{-1}\\left(\\frac{3}{5}\\right)$
${AB_QUESTION_MARKERS.CHOICE_ITEM.end}1.10

\\begin{enumerate}
  \\setcounter{enumi}{10}

${AB_QUESTION_MARKERS.CHOICE_ITEM.start}1.11
11.  \\item If $\\cot ^{-1} 2$ and $\\cot ^{-1} 3$ are two angles of a triangle, then the third angle is\\\\
(1) $\\frac{\\pi}{4}$\\\\
(2) $\\frac{\\pi}{3}$
${AB_QUESTION_MARKERS.CHOICE_ITEM.end}1.11

\\end{enumerate}

Note that \`\\end{enumerate}\` and \`\\begin{enumerate}\` stay exactly where the OCR put them — they are content, and the markers are placed around the questions regardless of where the list environments open and close.

COUNT BEFORE YOU FINISH AN EXERCISE:
Read the highest printed question number in the exercise. Then check you have emitted a marker pair for EVERY number from 1 up to it, with no gaps and no number used twice. If the exercise's last printed number is 25, there are 25 question marker pairs. A gap means a question was left outside the markers — go back and find it; it is almost always a loose question stranded between two \`enumerate\` blocks.

NUMBERING AND PAGES:
- ${AB_META_PREFIXES.PAGE_NO}<n> is the page the block STARTS on and ${AB_META_PREFIXES.END_PAGE_NO}<n> the page it ENDS on; a block that fits on one page repeats the same number on both. Emit them only if the source genuinely shows page numbers for that block. Never guess a page number, and never emit an empty or zero one — when the source shows no page numbers, omit BOTH lines.
- OCR numbering is unreliable — numbers may be missing, duplicated, or out of order. Rely on the printed labels where they exist and on reading order otherwise. Never renumber the exercise or example numbers themselves; they are content.

STRUCTURAL RULES:
- Every marker and every metadata comment is a whole line of its own that begins with "% ". Two markers must never share a line (\`% ED_EXAMPLE   % ST_EXAMPLE\` is wrong — that is two lines), and a marker must never be appended to a line of content.
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

\\subsection*{1.2.1 HCF and LCM by Prime Factorisation}

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
${AB_MARKERS.SOLUTION_START}
Solution : If the number $4^{\\mathrm{n}}$ were to end with the digit zero, then it would be divisible by 5. This is not possible because $4^{\\mathrm{n}}=(2)^{2 \\mathrm{n}}$.
${AB_MARKERS.SOLUTION_END}
${AB_MARKERS.EXAMPLE_END}

\\subsection*{1.2.1 HCF and LCM by Prime Factorisation}

You have already learnt how to find the HCF and LCM of two positive integers.

${AB_MARKERS.EXAMPLE_START}
${AB_META_PREFIXES.COMMON_PARENT}1.2 The Fundamental Theorem of Arithmetic
${AB_META_PREFIXES.PARENT}1.2.1 HCF and LCM by Prime Factorisation
${AB_META_PREFIXES.CHAPTER_ORDER}1
\\section*{Example 2}
Example 2: Find the LCM and HCF of 6 and 20 by the prime factorisation method.\\\\
${AB_MARKERS.SOLUTION_START}
Solution : We have: $\\quad 6=2^{1} \\times 3^{1}$ and $20=2^{2} \\times 5^{1}$.
${AB_MARKERS.SOLUTION_END}
${AB_MARKERS.EXAMPLE_END}

${AB_MARKERS.EXERCISE_START}
${AB_META_PREFIXES.COMMON_PARENT}EXERCISE 1.1
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
- Every block carries its topic metadata lines, in the order COMMON_PARENT, PARENT, CHAPTER_ORDER, PAGE_NO — no block is left without them.
- On an EXAMPLE, COMMON_PARENT is the two-part topic and PARENT is the three-part sub-topic it sits in (or the topic repeated when there is no sub-topic). On an EXERCISE, COMMON_PARENT is the exercise's own heading and there is NO PARENT line — check every exercise for this; copying the last \`\\subsection*{1.1.4 ...}\` heading into an exercise is the usual mistake.
- ${AB_META_PREFIXES.END_PAGE_NO} — when emitted — is the last line before the closing block marker, and every block that has a PAGE_NO also has an END_PAGE_NO.
- No line contains two markers, and no marker is appended to a content line.
- Every example that shows any working at all has exactly one ${AB_MARKERS.SOLUTION_START} … ${AB_MARKERS.SOLUTION_END} pair inside it, and NOTHING of the working is left on the statement side of ${AB_MARKERS.SOLUTION_START}. Re-read each example's statement side on its own: if it reads as anything other than the question the student is asked, the marker is in the wrong place.
- Marker counts balance: as many ${AB_MARKERS.EXAMPLE_END} as ${AB_MARKERS.EXAMPLE_START}, as many ${AB_MARKERS.EXERCISE_END} as ${AB_MARKERS.EXERCISE_START}, as many ${AB_MARKERS.SOLUTION_END} as ${AB_MARKERS.SOLUTION_START}.
- Removing every line you added reproduces the input byte for byte, except for the inserted \`\\section*{Example <n>}\` heading lines.`;

export default ACADEMIC_BOOK_ANNOTATION_INSTRUCTIONS;
