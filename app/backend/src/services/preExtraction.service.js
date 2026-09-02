import { supabase } from '../config/database.js';
import { config } from '../config/index.js';
import {
  ACADEMIC_BOOK_ANNOTATION_INSTRUCTIONS,
  AB_MARKERS,
} from './academicBook.instructions.js';
import {
  ACADEMIC_BOOK_SOLUTION_ANNOTATION_INSTRUCTIONS,
  ABS_MARKERS,
} from './academicBookSolution.instructions.js';

const LLAMAPARSE_API_URL = config.llamaParse.apiUrl;
const LLAMAPARSE_API_KEY = config.llamaParse.apiKey;

export const Q_START_MARKER = '<<<Q_START>>>';
export const Q_END_MARKER = '<<<Q_END>>>';
export const S_START_MARKER = '<<<S_START>>>';
export const S_END_MARKER = '<<<S_END>>>';

// LlamaParse occasionally emits boundary markers with 2 angle brackets instead
// of 3 (e.g. `<<S_END>>>` instead of `<<<S_END>>>`), which makes downstream
// strict `includes()` / `indexOf()` checks fail and silently skip the marker-aware
// extraction path. Normalize any 2–3 angle variant to the canonical 3-angle form.
const MARKER_NORMALIZATIONS = [
  { pattern: /<{2,3}Q_START>{2,3}/g, replacement: Q_START_MARKER },
  { pattern: /<{2,3}Q_END>{2,3}/g, replacement: Q_END_MARKER },
  { pattern: /<{2,3}S_START>{2,3}/g, replacement: S_START_MARKER },
  { pattern: /<{2,3}S_END>{2,3}/g, replacement: S_END_MARKER },
];

export function normalizeMarkers(content) {
  if (typeof content !== 'string' || !content) return content;
  let out = content;
  for (const { pattern, replacement } of MARKER_NORMALIZATIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

const PRE_EXTRACTION_INSTRUCTIONS = `You are a question-boundary annotator. Your job is to take the LaTeX/Markdown content below (produced by an OCR pipeline from a question paper or academic book) and return the SAME content with explicit boundary markers wrapped around each question.

OUTPUT FORMAT — STRICT:
- Wrap every question with the exact tokens ${Q_START_MARKER} and ${Q_END_MARKER}.
- ${Q_START_MARKER} goes at the very beginning of each question (before its number/label, if any).
- ${Q_END_MARKER} goes at the very end of each question (after the last choice or last sub-part).
- Do NOT translate, summarize, rewrite, renumber, or "clean up" the content.
- Preserve ALL original characters, LaTeX commands, math delimiters, line breaks, and whitespace EXACTLY as in the input. The only change you make is INSERTING the two markers around each question.
- Content that is NOT a question (chapter headings, section titles like "LONG ANSWERS (LAT)", page numbers, image references, separator lines, blank lines, orphan numbers like "5." or "20." sitting alone on a line) MUST stay where it is, OUTSIDE any marker pair.

WHAT COUNTS AS A QUESTION:
- A complete instruction or interrogative sentence — ends in "?", or starts with verbs like "Find", "Show", "Prove", "How many", "Which", "Determine", "Calculate", "Solve", "If ...".
- A problem scenario followed by sub-parts (i)/(ii)/(iii) or (a)/(b)/(c) is ONE question; the marker pair must enclose the entire scenario plus all sub-parts.
- An MCQ — the question text PLUS all of its (a)/(b)/(c)/(d) choices — is ONE question; the marker pair must enclose the question text and all choices.

WHAT IS NOT A QUESTION:
- A bare number on its own line (e.g. "4.", "5.", "20.") with no question text immediately attached — this is OCR noise. Leave it untouched, outside any marker.
- Section/chapter titles, page headers/footers.
- Image links like ![](https://...).
- "(Example)" labels or other annotations.

NUMBERING IS UNRELIABLE:
- The OCR may place the question number BEFORE the question text, AFTER the question text, on a separate line, or omit it entirely. Do not rely on numbering to identify boundaries — rely on the question content itself.
- Include any visible question label (the digit/number, if present nearby) INSIDE the marker pair, so downstream consumers can still see it.

EXAMPLE INPUT:
\\section*{LONG ANSWERS (LAT)}

If sum of the 3rd and the 8th terms of an AP is 7 and the sum of the 7th and the 14th terms is $-3$, find the 10th term.

Find the sum of the two middle most terms of the AP.
4.
5.

How many three digit numbers are divisible by 7?
7.

EXAMPLE OUTPUT:
\\section*{LONG ANSWERS (LAT)}

${Q_START_MARKER}
If sum of the 3rd and the 8th terms of an AP is 7 and the sum of the 7th and the 14th terms is $-3$, find the 10th term.
${Q_END_MARKER}

${Q_START_MARKER}
Find the sum of the two middle most terms of the AP.
${Q_END_MARKER}
4.
5.

${Q_START_MARKER}
How many three digit numbers are divisible by 7?
7.
${Q_END_MARKER}

FINAL RULES:
- Output ONLY the annotated content. No JSON, no code fences, no commentary, no preamble like "Here is the annotated content".
- Every question MUST have exactly one ${Q_START_MARKER} and exactly one ${Q_END_MARKER}.
- Marker pairs MUST NOT overlap or nest.
- Do NOT add markers around non-question content.
- If you are unsure whether something is a question, leave it OUTSIDE the markers.`;

const SOLUTION_PRE_EXTRACTION_INSTRUCTIONS = `You are a solution-boundary annotator. Your job is to take the LaTeX/Markdown content below (produced by an OCR pipeline from an answer key / solutions document) and return the SAME content with explicit boundary markers wrapped around each individual solution.

OUTPUT FORMAT — STRICT:
- Wrap every solution with the exact tokens ${S_START_MARKER} and ${S_END_MARKER}.
- ${S_START_MARKER} goes at the very beginning of each solution (before its question number / answer-key header).
- ${S_END_MARKER} goes at the very end of that solution (immediately before the next solution starts, or at end of document).
- Do NOT translate, summarize, rewrite, renumber, or "clean up" the content.
- Preserve ALL original characters, LaTeX commands, math delimiters, image references, line breaks, and whitespace EXACTLY as in the input. The only change you make is INSERTING the two markers around each solution.
- Content that is NOT part of a solution (chapter/section titles, page headers/footers, separator lines, blank lines between solutions, orphan numbers like "5." or "20." sitting alone with no answer key or working) MUST stay where it is, OUTSIDE any marker pair.

WHAT COUNTS AS A SOLUTION:
- A solution begins with a header line that pairs a question number with an answer key, in formats such as:
    * "8. (D)"            — letter answer in parentheses
    * "12. (B)"
    * "22. (11.00)"       — numerical / integer-type answer
    * "5) C"              — with closing paren
    * "Q3. (a)"           — Q-prefix, lowercase letter
    * "\\section*{8. (D)}" — when the OCR has wrapped the header in a section command
- After the header line, a solution typically contains:
    * An optional image reference (e.g. "![](https://cdn.mathpix.com/cropped/...)") — KEEP it inside the marker pair.
    * Worked steps, equations, $\\begin{aligned}...\\end{aligned}$ / $\\begin{gathered}...\\end{gathered}$ blocks, inline math, transitional text ("Therefore", "Hence", "Equation will become"), and a final answer.
- The solution ENDS exactly at the start of the next solution's header (the next "<number>. (<answer>)" pattern). At that point, close ${S_END_MARKER} BEFORE the next header, then open a new ${S_START_MARKER} for the next solution.
- The marker pair must enclose: the header line, any image, AND the entire worked solution body, sub-parts (i)/(ii)/(iii), and final answer line.

WHAT IS NOT A SOLUTION:
- A bare number on its own line (e.g. "4.", "5.", "20.") with NO answer-key parenthetical and no working below it — this is OCR noise. Leave it untouched, outside any marker.
- Section/chapter titles, page headers/footers, watermarks.
- Standalone image links that are not attached to a solution header.
- "(Example)" labels or other annotations that sit between solutions.

NUMBERING IS UNRELIABLE:
- The OCR may misplace, repeat, skip, or omit question numbers and answer keys. Do not rely on numbering to identify boundaries — rely on the "<number>. (<answer>)" header pattern plus the worked content that follows.
- Include any visible question label and answer key INSIDE the marker pair, so downstream consumers can still see them.

EXAMPLE INPUT:
\\section*{ANSWER KEY}

7. (D)
$\\sin^{-1}(2x) + \\cos^{-1}(2x) = \\pi/2$
$x = \\frac{1}{4}$
8. (B)
![](https://cdn.mathpix.com/cropped/xxx.jpg)
Equation will become
$x^2 - y^2 = 10xy$
9.
22. (11.00)
$A(2,6,2) B(-4,0,\\lambda)$
$5 - 6\\lambda = 11$

EXAMPLE OUTPUT:
\\section*{ANSWER KEY}

${S_START_MARKER}
7. (D)
$\\sin^{-1}(2x) + \\cos^{-1}(2x) = \\pi/2$
$x = \\frac{1}{4}$
${S_END_MARKER}
${S_START_MARKER}
8. (B)
![](https://cdn.mathpix.com/cropped/xxx.jpg)
Equation will become
$x^2 - y^2 = 10xy$
${S_END_MARKER}
9.
${S_START_MARKER}
22. (11.00)
$A(2,6,2) B(-4,0,\\lambda)$
$5 - 6\\lambda = 11$
${S_END_MARKER}

FINAL RULES:
- Output ONLY the annotated content. No JSON, no code fences, no commentary, no preamble like "Here is the annotated content".
- Every solution MUST have exactly one ${S_START_MARKER} and exactly one ${S_END_MARKER}.
- Marker pairs MUST NOT overlap or nest.
- Do NOT add markers around non-solution content (orphan numbers, section titles, blank lines).
- If you are unsure whether something is a solution, leave it OUTSIDE the markers.`;

const ANNOTATION_CONFIGS = {
  question: {
    instructions: PRE_EXTRACTION_INSTRUCTIONS,
    startMarker: Q_START_MARKER,
    endMarker: Q_END_MARKER,
    label: 'question',
  },
  solution: {
    instructions: SOLUTION_PRE_EXTRACTION_INSTRUCTIONS,
    startMarker: S_START_MARKER,
    endMarker: S_END_MARKER,
    label: 'solution',
  },
  // Academic textbooks need block structure (example vs exercise, plus the
  // topic each block sits under), not a flat list of questions — see
  // academicBook.instructions.js.
  academic_book: {
    instructions: ACADEMIC_BOOK_ANNOTATION_INSTRUCTIONS,
    startMarker: AB_MARKERS.EXERCISE_START,
    endMarker: AB_MARKERS.EXERCISE_END,
    label: 'academic book',
    extraMarkerCounts: [
      ['examples', AB_MARKERS.EXAMPLE_START, AB_MARKERS.EXAMPLE_END],
      // Zero of these on a chapter full of worked examples means every example's
      // working stayed glued to its statement — the failure this count exists
      // to make visible in the log rather than in the extracted questions.
      ['example statement/solution splits', AB_MARKERS.SOLUTION_START, AB_MARKERS.SOLUTION_END],
    ],
    splitPatterns: 'chapter',
  },
  // A textbook solutions guide groups worked solutions under the exercise they
  // answer. The flat `solution` config above assumes competitive-exam answer-key
  // headers ("8. (D)") and finds nothing here — see
  // academicBookSolution.instructions.js.
  academic_book_solution: {
    instructions: ACADEMIC_BOOK_SOLUTION_ANNOTATION_INSTRUCTIONS,
    startMarker: ABS_MARKERS.EXERCISE_START,
    endMarker: ABS_MARKERS.EXERCISE_END,
    label: 'academic book solution',
    extraMarkerCounts: [
      ['example solutions', ABS_MARKERS.EXAMPLE_START, ABS_MARKERS.EXAMPLE_END],
    ],
    splitPatterns: 'solutions',
  },
};

/**
 * Pick the annotation config for an item.
 * `sourceType` comes from the caller ('Academic Book' | 'Question Bank') and
 * selects the grammar; `itemType` selects whether it is the question or the
 * solution side of that grammar.
 */
export function resolveAnnotationConfig(itemType, sourceType) {
  if (itemType === 'solution') {
    return sourceType === 'Academic Book'
      ? ANNOTATION_CONFIGS.academic_book_solution
      : ANNOTATION_CONFIGS.solution;
  }
  if (sourceType === 'Academic Book') return ANNOTATION_CONFIGS.academic_book;
  return ANNOTATION_CONFIGS.question;
}

/** True for the two configs whose grammar and scale need Gemini, not LlamaParse. */
function isAcademicBookConfig(cfg) {
  return cfg === ANNOTATION_CONFIGS.academic_book || cfg === ANNOTATION_CONFIGS.academic_book_solution;
}

export const ANNOTATION_PROVIDERS = {
  LLAMAPARSE: 'llamaparse',
  GEMINI: 'gemini',
};

const GEMINI_API_URL = config.gemini.apiUrl;
const GEMINI_API_KEY = config.gemini.apiKey;
const GEMINI_MODEL = config.gemini.model;

// Annotation echoes the whole document back, so a chunk's OUTPUT has to fit in
// the model's response budget — the binding constraint, not the input window.
// gemini-2.5-flash allows 65536 output tokens, which would fit a whole chapter,
// but chunks are kept small anyway: this is a mechanical line-by-line task and
// instruction adherence degrades over long echoes. Six cheap calls beat one
// long one that drifts halfway through.
const ANNOTATION_CHUNK_CHARS = 12000;
const ANNOTATION_MAX_OUTPUT_TOKENS = 65536;

// Headings that are safe to cut a document at, per annotation kind.
//
// A chapter may only be cut at topic headings (`\subsection*{1.3 …}`): an example
// or exercise never spans one, and each chunk then carries the topic its blocks
// must be attributed to. Exercise headings are a *fallback* — cutting there is
// only acceptable because the topic travels with the chunk as a hint.
//
// A solutions guide has no topic headings at all; its blocks are delimited by the
// exercise (or example) headings themselves, and each block is self-identifying,
// so those are the primary cut points and there is nothing safe below them.
export const ANNOTATION_SPLIT_PATTERNS = {
  chapter: {
    primary: /^\\subsection\*\{[^}]*\}\s*$/gm,
    // Only headings that are clearly exercises qualify — splitting at an
    // OCR-produced `\section*{Solution :}` would cut a worked example away from
    // its statement.
    secondary: /^\\section\*\{\s*(?:(?:UNIT\s+|MISCELLANEOUS\s+)?EXERCISE|Exercise)[^}]*\}\s*$/gim,
    hintLabel: 'CURRENT TOPIC',
  },
  solutions: {
    primary: /^\\section\*\{[^}]*(?:EXERCISE|Exercise|EXAMPLE|Example)[^}]*\}\s*$/gm,
    secondary: null,
    hintLabel: 'CURRENT EXERCISE / EXAMPLE',
  },
};

/**
 * Heading number of a topic heading: `\\subsection*{1.2.1 Adjoint of a Square
 * Matrix}` → '1.2.1'. Null when the heading does not open with a number.
 */
function headingNumber(heading) {
  const match = /\{\s*(\d+(?:\.\d+)*)(?![\d.])/.exec(heading || '');
  return match ? match[1] : null;
}

/**
 * True for a top-level topic heading ("1.2 ..."), false for a sub-topic
 * ("1.2.1 ..."). The annotator attributes a block's COMMON_PARENT to the former
 * and its PARENT to the latter, so the two have to travel separately.
 */
function isTopicRoot(heading) {
  const number = headingNumber(heading);
  return !!number && number.split('.').length <= 2;
}

/**
 * Split a document into chunks that never cut through a block.
 *
 * Each chunk gets a `headingHint` naming the heading in force at its start, so
 * blocks appearing before the first heading of a chunk are still attributable,
 * plus a `commonHeadingHint` naming the enclosing top-level topic. Without the
 * second hint a chunk that opens inside `1.2.1 Adjoint of a Square Matrix` has
 * no way to name topic `1.2`, whose title appeared in an earlier chunk.
 */
export function splitForAnnotation(content, options = {}) {
  const {
    maxChars = ANNOTATION_CHUNK_CHARS,
    patterns = ANNOTATION_SPLIT_PATTERNS.chapter,
  } = options;

  const primaryRe = new RegExp(patterns.primary.source, patterns.primary.flags);

  // Cut points at each heading.
  const cuts = [];
  let match;
  while ((match = primaryRe.exec(content)) !== null) {
    cuts.push({ index: match.index, heading: match[0].trim() });
  }

  const sections = [];
  if (cuts.length === 0 || cuts[0].index > 0) {
    sections.push({ text: content.slice(0, cuts.length ? cuts[0].index : content.length), heading: null });
  }
  cuts.forEach((cut, i) => {
    const end = i + 1 < cuts.length ? cuts[i + 1].index : content.length;
    sections.push({ text: content.slice(cut.index, end), heading: cut.heading });
  });

  // Pack sections into chunks, carrying the last seen heading forward as the hint.
  const chunks = [];
  let current = '';
  let currentHint = null;
  let pendingHint = null;
  let currentCommonHint = null;
  let pendingCommonHint = null;

  const flush = () => {
    if (current.trim() === '') return;
    chunks.push({ text: current, headingHint: currentHint, commonHeadingHint: currentCommonHint });
    current = '';
    currentHint = pendingHint;
    currentCommonHint = pendingCommonHint;
  };

  for (const section of sections) {
    if (current !== '' && current.length + section.text.length > maxChars) {
      flush();
    }
    if (current === '') {
      currentHint = pendingHint;
      currentCommonHint = pendingCommonHint;
    }
    current += section.text;
    if (section.heading) {
      pendingHint = section.heading;
      if (isTopicRoot(section.heading)) pendingCommonHint = section.heading;
    }

    // A single section bigger than the budget is emitted on its own; the model
    // handles it as one oversized chunk rather than being cut mid-block.
    if (current.length >= maxChars) flush();
  }
  flush();

  // A single section can exceed the budget on its own (NCERT topics 1.3 and 1.5
  // are ~11KB each). Split those further at the secondary headings, which is safe
  // because the primary heading travels with the chunk as headingHint.
  if (!patterns.secondary) return chunks;

  const secondaryRe = new RegExp(patterns.secondary.source, patterns.secondary.flags);
  const primaryScanRe = new RegExp(patterns.primary.source, patterns.primary.flags);

  const result = [];
  for (const chunk of chunks) {
    if (chunk.text.length <= maxChars) {
      result.push(chunk);
      continue;
    }

    const points = [];
    let m;
    secondaryRe.lastIndex = 0;
    while ((m = secondaryRe.exec(chunk.text)) !== null) {
      if (m.index > 0) points.push(m.index);
    }

    if (points.length === 0) {
      // Nothing safe to split on — emit oversized and let the MAX_TOKENS guard
      // report it rather than cutting mid-block.
      result.push(chunk);
      continue;
    }

    const bounds = [0, ...points, chunk.text.length];
    for (let i = 0; i < bounds.length - 1; i++) {
      const piece = chunk.text.slice(bounds[i], bounds[i + 1]);
      if (piece.trim() === '') continue;

      // The heading in force at this piece is the last primary heading appearing
      // BEFORE it within the chunk — not the hint carried in from the previous
      // chunk, which would attribute EXERCISE 1.3 to topic 1.2.
      const preceding = (chunk.text.slice(0, bounds[i]).match(primaryScanRe) || []).map((h) => h.trim());
      const precedingRoot = preceding.filter(isTopicRoot).pop();
      result.push({
        text: piece,
        headingHint: preceding.length ? preceding[preceding.length - 1] : chunk.headingHint,
        commonHeadingHint: precedingRoot || chunk.commonHeadingHint,
      });
    }
  }

  return result;
}

export const preExtractionService = {
  /**
   * Annotate a scanned item's latex_doc with boundary markers.
   * Picks the question or solution prompt based on the item's item_type.
   * Stores the result in scanned_items.pre_extracted.
   */
  async annotate(scannedItemId, { sourceType = 'Question Bank', provider = null } = {}) {
    const { data: item, error: fetchError } = await supabase
      .from('scanned_items')
      .select('id, latex_doc, latex_conversion_status, item_type')
      .eq('id', scannedItemId)
      .single();

    if (fetchError) throw fetchError;
    if (!item) throw new Error('Scanned item not found');
    if (item.latex_conversion_status !== 'completed' || !item.latex_doc) {
      throw new Error('LaTeX conversion is not completed for this item');
    }

    const cfg = resolveAnnotationConfig(item.item_type, sourceType);

    console.log(`[PRE-EXTRACT] Item ${scannedItemId} (type: ${item.item_type || 'question'}, source: ${sourceType}): latex_doc size ${Math.round(item.latex_doc.length / 1024)}KB`);
    console.log(`[PRE-EXTRACT] ===== ANNOTATION PROMPT (${cfg.label}) =====`);
    console.log(cfg.instructions);
    console.log(`[PRE-EXTRACT] ===== END PROMPT (length: ${cfg.instructions.length}) =====`);

    // Academic-book annotation is structural and runs over a whole chapter, so
    // it defaults to Gemini; LlamaParse has been observed returning documents of
    // that size unchanged.
    const chosenProvider =
      provider || (isAcademicBookConfig(cfg) ? ANNOTATION_PROVIDERS.GEMINI : ANNOTATION_PROVIDERS.LLAMAPARSE);
    console.log(`[PRE-EXTRACT] Provider: ${chosenProvider}`);

    // LlamaParse cannot perform this annotation: on a 47KB chapter it returned
    // the document byte-for-byte unchanged. Refuse up front instead of spending
    // a request to rediscover it.
    if (isAcademicBookConfig(cfg) && chosenProvider === ANNOTATION_PROVIDERS.LLAMAPARSE) {
      throw new Error(
        'LlamaParse cannot annotate academic books — it returns large documents unchanged. ' +
        'Use the Gemini provider (or leave the provider on Auto).'
      );
    }

    let rawAnnotated;
    if (chosenProvider === ANNOTATION_PROVIDERS.GEMINI) {
      rawAnnotated = await this.annotateWithGemini(item.latex_doc, cfg.instructions, cfg.label, cfg.splitPatterns);
    } else {
      const jobId = await this.submitToLlamaParse(item.latex_doc, cfg.instructions);
      console.log(`[PRE-EXTRACT] LlamaParse job: ${jobId}`);
      rawAnnotated = await this.pollForCompletion(jobId);
    }
    const annotated = normalizeMarkers(rawAnnotated);
    console.log(`[PRE-EXTRACT] Annotated size: ${Math.round(annotated.length / 1024)}KB`);
    if (annotated !== rawAnnotated) {
      console.log(`[PRE-EXTRACT] Normalized stray boundary marker variants to canonical form`);
    }

    const countMarker = (marker) =>
      (annotated.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

    const startCount = countMarker(cfg.startMarker);
    const endCount = countMarker(cfg.endMarker);
    console.log(`[PRE-EXTRACT] Marker counts (${cfg.label}) — start: ${startCount}, end: ${endCount}`);
    if (startCount !== endCount) {
      console.warn(`[PRE-EXTRACT] ⚠️ Unbalanced ${cfg.label} markers: ${startCount} start vs ${endCount} end`);
    }

    let extraTotal = 0;
    for (const [name, startMarker, endMarker] of cfg.extraMarkerCounts || []) {
      const starts = countMarker(startMarker);
      const ends = countMarker(endMarker);
      extraTotal += starts;
      console.log(`[PRE-EXTRACT] Marker counts (${name}) — start: ${starts}, end: ${ends}`);
      if (starts !== ends) {
        console.warn(`[PRE-EXTRACT] ⚠️ Unbalanced ${name} markers: ${starts} start vs ${ends} end`);
      }
    }

    // An annotator that returns the document unchanged has failed, even though
    // the HTTP call succeeded. Storing that output would leave the item looking
    // pre-extracted while the extraction step reports "run pre-extraction
    // first" — so fail here, where the real cause is visible.
    if (startCount === 0 && extraTotal === 0) {
      const unchanged = annotated.trim() === item.latex_doc.trim();
      throw new Error(
        `Annotation produced no ${cfg.label} markers` +
        (unchanged ? ' and returned the document unchanged' : '') +
        `. The provider ignored the annotation instruction — this happens with LlamaParse on large documents ` +
        `(this one is ${Math.round(item.latex_doc.length / 1024)}KB). Retry with the Gemini provider.`
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from('scanned_items')
      .update({ pre_extracted: annotated, updated_at: new Date().toISOString() })
      .eq('id', scannedItemId)
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number)
      `)
      .single();

    if (updateError) throw updateError;
    return updated;
  },

  /**
   * Manually overwrite the pre_extracted content for a scanned item.
   * Used when a user edits the markers in the UI.
   */
  async savePreExtracted(scannedItemId, preExtracted) {
    if (typeof preExtracted !== 'string') {
      throw new Error('pre_extracted must be a string');
    }
    const value = preExtracted.length > 0 ? normalizeMarkers(preExtracted) : null;

    const { data, error } = await supabase
      .from('scanned_items')
      .update({ pre_extracted: value, updated_at: new Date().toISOString() })
      .eq('id', scannedItemId)
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number)
      `)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Annotate with Gemini, chunk by chunk.
   *
   * Used instead of LlamaParse when the document is large or the annotation is
   * structural: LlamaParse's parsing_instruction degrades to pass-through on
   * long input (observed returning a 48KB chapter byte-for-byte unchanged).
   */
  async annotateWithGemini(content, instructions, label = 'annotation', splitPatterns = 'chapter') {
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured. Set GOOGLE_API_KEY in environment variables.');
    }

    const patterns = ANNOTATION_SPLIT_PATTERNS[splitPatterns] || ANNOTATION_SPLIT_PATTERNS.chapter;
    const chunks = splitForAnnotation(content, { patterns });
    console.log(`[PRE-EXTRACT] Gemini ${label}: ${chunks.length} chunk(s) from ${Math.round(content.length / 1024)}KB`);

    const annotatedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      const { text, headingHint, commonHeadingHint } = chunks[i];
      const hintLines = [];
      // The enclosing topic is only worth stating when it differs from the
      // heading in force; when they are the same the single line below says it.
      if (commonHeadingHint && commonHeadingHint !== headingHint) {
        hintLines.push(`ENCLOSING TOPIC AT THE START OF THIS EXCERPT (its title appeared in an earlier excerpt — use it as the COMMON PARENT): ${commonHeadingHint}`);
      }
      if (headingHint) {
        hintLines.push(`${patterns.hintLabel} AT THE START OF THIS EXCERPT (use it for any block that appears before the first heading below): ${headingHint}`);
      }
      const hint = hintLines.length ? `\n${hintLines.join('\n')}\n` : '';

      const prompt = `${instructions}\n${hint}
This is excerpt ${i + 1} of ${chunks.length} from the document. Annotate ONLY this excerpt and return it in full.

CONTENT TO ANNOTATE:
${text}`;

      const response = await fetch(
        `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: ANNOTATION_MAX_OUTPUT_TOKENS,
              // Inserting markers needs no deliberation, and on 2.5 models
              // thinking draws from the same output budget that has to carry the
              // echoed document.
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini annotation failed on chunk ${i + 1}/${chunks.length}: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const candidate = result.candidates?.[0];
      const generated = candidate?.content?.parts?.[0]?.text;

      if (!generated) {
        throw new Error(
          `Gemini returned no text for chunk ${i + 1}/${chunks.length}` +
          (candidate?.finishReason ? ` (finishReason: ${candidate.finishReason})` : '')
        );
      }

      // A truncated response silently drops the tail of the chapter, so surface
      // it rather than storing a partial annotation.
      if (candidate.finishReason === 'MAX_TOKENS') {
        throw new Error(
          `Gemini hit the output limit on chunk ${i + 1}/${chunks.length} (${Math.round(text.length / 1024)}KB input). ` +
          `The annotation would be truncated.`
        );
      }

      // Strip a code fence if the model wrapped its output despite instructions.
      let cleaned = generated.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
      }

      const ratio = cleaned.length / text.length;
      console.log(
        `[PRE-EXTRACT] Chunk ${i + 1}/${chunks.length}: ${text.length} chars in, ${cleaned.length} out (${ratio.toFixed(2)}x)`
      );
      if (ratio < 0.9) {
        console.warn(
          `[PRE-EXTRACT] ⚠️ Chunk ${i + 1} shrank to ${(ratio * 100).toFixed(0)}% of its input — content may have been dropped`
        );
      }

      annotatedChunks.push(cleaned);
    }

    return annotatedChunks.join('\n\n');
  },

  async submitToLlamaParse(content, instructions = PRE_EXTRACTION_INSTRUCTIONS) {
    const blob = new Blob([content], { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', blob, 'pre_extract.txt');
    formData.append('parsing_instruction', instructions);
    formData.append('result_type', 'markdown');
    formData.append('premium_mode', 'true');

    const response = await fetch(`${LLAMAPARSE_API_URL}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${LLAMAPARSE_API_KEY}` },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LlamaParse upload failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result.id;
  },

  async pollForCompletion(jobId, maxAttempts = 120, intervalMs = 2000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const statusResponse = await fetch(`${LLAMAPARSE_API_URL}/job/${jobId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${LLAMAPARSE_API_KEY}` },
      });

      if (!statusResponse.ok) {
        throw new Error(`Failed to check job status: ${statusResponse.status}`);
      }

      const statusData = await statusResponse.json();
      if (statusData.status === 'SUCCESS') {
        return await this.getResult(jobId);
      }
      if (statusData.status === 'ERROR') {
        throw new Error(statusData.error || 'LlamaParse processing failed');
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('LlamaParse pre-extraction timed out');
  },

  async getResult(jobId) {
    const response = await fetch(`${LLAMAPARSE_API_URL}/job/${jobId}/result/markdown`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${LLAMAPARSE_API_KEY}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to get result: ${response.status}`);
    }

    const result = await response.json();
    return result.markdown || result.text || JSON.stringify(result);
  },
};

export default preExtractionService;
