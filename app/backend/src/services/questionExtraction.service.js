import { supabase } from '../config/database.js';
import { config } from '../config/index.js';
import { Q_START_MARKER, Q_END_MARKER } from './preExtraction.service.js';
import { hasAcademicBookMarkers } from './academicBook.instructions.js';
import { parseAcademicBookBlocks } from './academicBook.parser.js';

const LLAMAPARSE_API_URL = config.llamaParse.apiUrl;
const LLAMAPARSE_API_KEY = config.llamaParse.apiKey;

// Gemini API configuration
const GEMINI_API_URL = config.gemini.apiUrl;
const GEMINI_API_KEY = config.gemini.apiKey;
const GEMINI_MODEL = config.gemini.model;

/**
 * Headline question count for either payload shape.
 * Question Bank stores a flat `{ questions: [...] }`; Academic Book stores
 * `{ blocks: [...] }` whose items live under each block's `toc_question_items`.
 */
export function countQuestions(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  if (Array.isArray(payload.blocks)) {
    return payload.blocks.reduce(
      (n, block) => n + (Array.isArray(block?.toc_question_items) ? block.toc_question_items.length : 0),
      0
    );
  }
  return Array.isArray(payload.questions) ? payload.questions.length : 0;
}

// Extraction provider options
export const EXTRACTION_PROVIDERS = {
  LLAMAPARSE: 'llamaparse',
  GEMINI: 'gemini',
};

// Parsing instructions by source type
const PARSING_INSTRUCTIONS = {
  'Question Bank': `
CRITICAL: Extract EVERY SINGLE question from this document with ALL their choices. Do NOT skip any questions or choices.

This document contains competitive exam questions (JEE, NEET, etc.). Extract ALL question types:
- Single correct MCQs (one correct answer)
- Multiple correct MCQs (one or more correct answers)
- Numerical/Integer type questions (answer is a number, NO choices provided)
- Paragraph/Comprehension based questions
- Matrix match questions
- Assertion-Reason questions

CHOICE FORMATS - Look for these patterns on SEPARATE LINES after the question:
- (a), (b), (c), (d) - lowercase with parentheses (MOST COMMON in JEE)
- (A), (B), (C), (D) - uppercase with parentheses
- A., B., C., D. or A), B), C), D)

IMPORTANT - CHOICES CAN CONTAIN:
- Simple numbers: (a) 2, (b) 12, (c) 4, (d) 6
- Mathematical expressions: (a) $\\beta^{2}-2 \\sqrt{\\alpha}=\\frac{19}{4}$
- Text with math: (a) Perimeter of $\\triangle ABC$ is $18\\sqrt{3}$
- Fractions, square roots, matrices, determinants

HOW TO IDENTIFY CHOICES:
- Choices appear AFTER phrases like "is equal to", "then", "is", "are", "equals"
- Each choice starts on a new line with (a), (b), (c), (d)
- Choices end when the next question number appears OR document ends

For EACH question, extract:
1. question_label: The number EXACTLY as shown (e.g., "1", "10", "17")
2. text: Complete question INCLUDING all math notation up to but NOT including the choices
3. choices: Array of ALL 4 choices with their labels ["(a) ...", "(b) ...", "(c) ...", "(d) ..."]

Return in JSON format:
{
  "questions": [
    {
      "question_label": "10",
      "text": "Let S denote the set... is equal to",
      "choices": ["(a) 2", "(b) 12", "(c) 4", "(d) 6"]
    },
    {
      "question_label": "17",
      "text": "Let $f(x)=...$. If $\\alpha$ and $\\beta$ respectively are the maximum and minimum values of $f$, then",
      "choices": ["(a) $\\beta^{2}-2 \\sqrt{\\alpha}=\\frac{19}{4}$", "(b) $\\beta^{2}+2 \\sqrt{\\alpha}=\\frac{19}{4}$", "(c) $\\alpha^{2}-\\beta^{2}=4 \\sqrt{3}$", "(d) $\\alpha^{2}+\\beta^{2}=\\frac{9}{2}$"]
    },
    {
      "question_label": "21",
      "text": "Numerical question (no choices)",
      "choices": []
    }
  ]
}

MANDATORY RULES:
- Extract EVERY question from 1 to the last question number
- For EACH MCQ (questions 1-20 typically), you MUST extract exactly 4 choices
- Choices with mathematical expressions - preserve ALL LaTeX notation exactly
- For questions ending with "is equal to", "then", etc. - the choices follow on next lines
- Numerical/Integer type questions (usually 21-30) have NO choices - set choices to []
- Preserve ALL LaTeX: $...$ and $$...$$ and special characters
- Do NOT skip choices even if they contain complex math expressions
- VERIFY: Every MCQ must have exactly 4 choices in the output
`,
  'Academic Book': `
CRITICAL: Extract EVERY SINGLE question from this document with ALL their choices. Do NOT skip any questions or choices.

This is an academic textbook. Extract ALL types of questions including:
- Multiple choice questions (MCQs)
- Fill in the blanks
- True/False questions
- Short answer questions
- Long answer questions
- Numerical problems
- Exercise questions

CHOICE FORMATS - Look for these patterns on SEPARATE LINES after the question:
- (a), (b), (c), (d) - lowercase with parentheses
- (A), (B), (C), (D) - uppercase with parentheses
- A., B., C., D. or A), B), C), D)
- (i), (ii), (iii), (iv)

IMPORTANT - CHOICES CAN CONTAIN:
- Simple numbers or text
- Mathematical expressions with LaTeX
- Fractions, square roots, matrices, determinants
- Mixed text and math

HOW TO IDENTIFY CHOICES:
- Choices appear AFTER phrases like "is equal to", "then", "is", "are", "equals", "find"
- Each choice starts on a new line with (a), (b), (c), (d) or similar
- Choices end when the next question number appears OR document ends

For EACH question, extract:
1. question_label: The number EXACTLY as shown
2. text: Complete question INCLUDING all math notation up to but NOT including the choices
3. choices: Array of ALL choices with their labels, or empty [] if no choices

Return in JSON format:
{
  "questions": [
    {
      "question_label": "1",
      "text": "Complete question text with $math$ preserved",
      "choices": ["(a) choice1", "(b) choice2", "(c) choice3", "(d) choice4"]
    },
    {
      "question_label": "2",
      "text": "Question without choices",
      "choices": []
    }
  ]
}

MANDATORY RULES:
- Extract EVERY question - do not stop early or skip any
- For EACH MCQ, you MUST extract ALL choices (typically 4)
- Choices with mathematical expressions - preserve ALL LaTeX notation exactly
- Questions may have blank lines between number and text - still extract them
- Preserve ALL LaTeX: $...$ and $$...$$ exactly
- Do NOT skip choices even if they contain complex math expressions
- VERIFY: Every MCQ must have its choices in the output
`,
};

// Marker-mode parsing instruction. When the input has been pre-extracted with
// boundary markers, this REPLACES the Question Bank / Academic Book base prompt
// entirely — those base prompts assume natural-language question discovery and
// their rules ("extract every question from 1 to N", "MUST extract exactly 4
// choices", JSON examples without markers) actively conflict with the marker
// flow and cause the per-page LLM calls to relabel/drop questions.
const MARKER_PARSING_INSTRUCTIONS = `You are a structured-data extractor. The input is plaintext / LaTeX content where every question has been pre-wrapped with explicit boundary tokens. Your only job is to convert each marker pair into one JSON entry.

THE MARKERS:
- Question start: the literal 13-character token   ${Q_START_MARKER}
- Question end:   the literal 11-character token   ${Q_END_MARKER}
- Markers always come in matched pairs. They never nest.

WHAT YOU MUST DO:
1. Scan the input from start to end. Every time you encounter ${Q_START_MARKER}, capture everything up to the matching ${Q_END_MARKER} as ONE question block.
2. For each question block, produce one entry in the "questions" array with three fields: question_label (string), text (string), choices (array of strings).
3. Emit one entry PER block. If the input has 17 blocks visible to you, your "questions" array MUST have 17 entries. If it has 8 blocks visible to you, the array MUST have 8 entries. The number of entries equals the number of marker pairs, ALWAYS.

LABELING (question_label):
- Inside each block, the content typically begins with a number followed by a period and a space, like "1. " or "14. " or "20. ". Use that number, stripped of the period, as the question_label.
  Example: block content "11. In the given figure, ... (D) 5:2"  →  question_label = "11"
- These numbers are GLOBAL — they refer to the whole document, NOT to the position of the block in your current view. Always copy the number you literally see inside the block. NEVER renumber, NEVER reset to "1" because you think it's the first block.
- If a block has NO leading number (rare; e.g. the block contains only a stray period or is otherwise malformed), use the string form of the block's 1-based ordinal in YOUR view (still emit it; do not skip).

TEXT FIELD:
- Take the full content between ${Q_START_MARKER} and ${Q_END_MARKER}.
- Remove the leading "<number>. " prefix (so "11. In the given figure, ..." becomes "In the given figure, ...").
- The text field is the question stem ONLY — everything UP TO the first MCQ choice line, if any. Preserve all LaTeX ($...$, $$...$$), special characters, and sub-parts like (i)/(ii)/(iii) or (a)/(b)/(c) that are part of the question wording (not separate MCQ choices).
- Do NOT include the marker tokens in the text.

CHOICES FIELD:
- Detect MCQ choice lines inside the block. A choice line starts with one of: "(a)", "(b)", "(c)", "(d)" (lowercase) or "(A)", "(B)", "(C)", "(D)" (uppercase).
- For each choice, push a string of the form "(a) <body>" / "(A) <body>" into the choices array, in the ORDER THEY APPEAR in the block (do not reorder them, even if they are out of alphabetical order in the source).
- Preserve all LaTeX in choice bodies.
- If a block has no MCQ choices, set choices to an empty array [].

WHAT YOU MUST NOT DO:
- DO NOT skip any block. Every ${Q_START_MARKER} you see must produce an entry.
- DO NOT merge two blocks into one entry, or split one block into two entries.
- DO NOT extract anything from text OUTSIDE the markers. Section headings (e.g. "\\section*{...}"), page noise, image links (![](...)), separator lines, and stray text between blocks are all NOISE and must be ignored.
- DO NOT include the literal tokens ${Q_START_MARKER} or ${Q_END_MARKER} anywhere in your output.
- DO NOT invent, fabricate, or pad with placeholder entries. The number of entries must equal the number of marker pairs you can see — no more, no less.
- DO NOT renumber labels. Always use the number printed INSIDE the block.
- DO NOT relabel using your own running counter unless a block truly has no leading number.

OUTPUT FORMAT:
- Return ONE and ONLY ONE JSON object of the form:
  {
    "questions": [
      { "question_label": "1", "text": "...", "choices": ["(a) ...", "(b) ...", "(c) ...", "(d) ..."] },
      { "question_label": "2", "text": "...", "choices": [] },
      ...
    ]
  }
- No markdown code fences. No commentary. No preamble. The response must start with { and end with }.

EXAMPLE INPUT (a 3-block excerpt):
\\section*{CH 6 MCQ}

${Q_START_MARKER}
1. In the given figure, $AB \\mid CD$. The length of OC is
(a) $\\frac{15}{2}$ cm
(b) $\\frac{10}{3}$ cm
(c) $\\frac{6}{5}$ cm
(d) $\\frac{3}{5}$ cm
${Q_END_MARKER}

${Q_START_MARKER}
7. Which of the following is not the criterion for similarity of triangles?
(A) AAA
(B) SSS
(C) SAS
(D) RHS
${Q_END_MARKER}

${Q_START_MARKER}
14. In the figure, $DE \\| BC$. Which is true?
${Q_END_MARKER}

EXAMPLE OUTPUT:
{ "questions": [
  { "question_label": "1", "text": "In the given figure, $AB \\mid CD$. The length of OC is", "choices": ["(a) $\\frac{15}{2}$ cm", "(b) $\\frac{10}{3}$ cm", "(c) $\\frac{6}{5}$ cm", "(d) $\\frac{3}{5}$ cm"] },
  { "question_label": "7", "text": "Which of the following is not the criterion for similarity of triangles?", "choices": ["(A) AAA", "(B) SSS", "(C) SAS", "(D) RHS"] },
  { "question_label": "14", "text": "In the figure, $DE \\| BC$. Which is true?", "choices": [] }
] }

FINAL CHECK BEFORE RESPONDING:
- Count the ${Q_START_MARKER} occurrences in the input visible to you, call it K.
- Count the entries in your "questions" array, call it N.
- N MUST equal K. If they differ, you have made a mistake — fix it before responding.
- Verify question_label values were copied from inside each block, not generated by your own counter.`;

// Helper to get parsing instructions for a type, optionally augmented with
// a target question count rule and/or a "markers present" rule.
const getParsingInstructions = (type, numberOfQuestions = null, hasMarkers = false) => {
  const base = PARSING_INSTRUCTIONS[type] || PARSING_INSTRUCTIONS['Question Bank'];

  // When markers are present, use the dedicated marker-mode prompt and ignore
  // both the type-specific base prompt and the target-count rule. The base
  // prompt's natural-language assumptions ("extract every question from 1 to N",
  // "MUST extract exactly 4 choices", non-marker JSON examples) compete with
  // the marker rule and have caused per-page LLM calls to relabel/drop entries.
  if (hasMarkers) {
    console.log(`[EXTRACT] ===== FINAL PARSING PROMPT (marker mode, type ignored, target ignored) =====`);
    console.log(MARKER_PARSING_INSTRUCTIONS);
    console.log(`[EXTRACT] ===== END PROMPT (length: ${MARKER_PARSING_INSTRUCTIONS.length}) =====`);
    return MARKER_PARSING_INSTRUCTIONS;
  }

  if (numberOfQuestions === null || numberOfQuestions === undefined) {
    return base;
  }
  const targetRule = `- KNOWN QUESTION COUNT (GROUND TRUTH): This document contains EXACTLY ${numberOfQuestions} questions. This number is a confirmed fact provided by the user — it is NOT an estimate, assumption, or guess. Treat it as absolute ground truth and do NOT second-guess it.\n- SOURCE NUMBERING IS UNRELIABLE — IGNORE IT: This input was produced by an OCR/Mathpix pipeline. The numeric labels in the source are MESSY and CANNOT BE TRUSTED:\n    * A question's number may appear BEFORE the question text (e.g. "5. Find ...").\n    * A question's number may appear AFTER the question text on a separate line (e.g. the question text, then a line containing only "7.").\n    * Numbers may be ORPHANED — a line containing only a digit followed by a period (e.g. "4.", "5.", "20.") with no associated question. These are noise from page layout. IGNORE them entirely; they are NOT questions.\n    * The numbering may JUMP, REPEAT, or be OUT OF ORDER (e.g. ..., 12, 13, 2, 14, ...). Do not treat such jumps as multiple questions.\n    * Some questions may have NO visible number at all.\n  Do NOT use any digit found in the source as the question_label. Do NOT try to "preserve" the original numbering.\n- HOW TO IDENTIFY A REAL QUESTION: A real question is a complete instruction or interrogative — sentences ending in "?", or starting with verbs like "Find", "Show", "Prove", "How many", "Which", "Determine", "Calculate", or describing a problem scenario followed by sub-parts (i)/(ii)/(iii) or (a)/(b)/(c). A bare number like "20." on its own line is NOT a question.\n- ASSIGN LABELS SEQUENTIALLY: Override the "question_label EXACTLY as shown" rule from above. Instead, assign question_label as a sequential string starting from "1": the first real question you find is "1", the second is "2", ..., up to "${numberOfQuestions}". This avoids being confused by the messy source numbering.\n- SINGLE JSON OBJECT ONLY: Your entire response MUST be ONE and ONLY ONE JSON object of the form { "questions": [...] }. Do NOT emit the JSON twice. Do NOT repeat the JSON object. Do NOT output multiple { "questions": [...] } blocks. Do NOT include the same questions in more than one block. Anything other than exactly one JSON object will be considered invalid output.\n- NO DUPLICATES: Each real question from the document must appear only ONCE. If you encounter content that looks similar to a question you already extracted (because of OCR repetition, page headers, or per-page processing), do NOT add it again.\n- HARD UPPER LIMIT: The "questions" array MUST contain AT MOST ${numberOfQuestions} entries. Never return more than ${numberOfQuestions} questions under any circumstances. If during extraction you reach ${numberOfQuestions} entries, STOP — anything that looks like further questions is noise (page headers, repeated content, footnotes, answer keys, orphan numbers) and must be ignored.\n- EXTRACTION ORDER: Extract questions strictly in the order they FIRST appear in the document, starting from the first real question and stopping when you have ${numberOfQuestions} entries or reach the end.\n- PADDING WHEN FEWER FOUND: If the document genuinely contains fewer than ${numberOfQuestions} real questions, do NOT fabricate or invent questions. Pad the "questions" array with placeholder entries until its length equals exactly ${numberOfQuestions}. Each placeholder MUST use this exact shape:\n  {\n    "question_label": "<next sequential number>",\n    "text": "TODO...",\n    "choices": []\n  }\n- MANDATORY FINAL CHECK: Before returning, verify all of the following:\n  1. There is exactly ONE { "questions": [...] } JSON object in your response (not two, not three).\n  2. The "questions" array length is EXACTLY ${numberOfQuestions} — never more, never less.\n  3. question_label values are sequential strings "1", "2", ..., "${numberOfQuestions}" with no gaps and no duplicates.\n  4. No orphan numeric lines (like "4.", "20.") were treated as questions.\n  If any check fails, fix the output before returning. Do not return invalid output.`;
  const finalPrompt = `${base.trimEnd()}\n${targetRule}\n`;
  console.log(`[EXTRACT] ===== FINAL PARSING PROMPT (type: ${type}, target: ${numberOfQuestions}, hasMarkers: false) =====`);
  console.log(finalPrompt);
  console.log(`[EXTRACT] ===== END PROMPT (length: ${finalPrompt.length}) =====`);
  return finalPrompt;
};

export const questionExtractionService = {
  /**
   * Create a question set from selected scanned items
   * @param {string[]} itemIds - Array of scanned item IDs (in selection order)
   * @param {object} options - Optional name, type, and metadata
   * @returns {Promise<object>} - Created question set record
   */
  async createQuestionSet(itemIds, options = {}) {
    // Fetch scanned items to get book_id and chapter_id from first item
    const { data: items, error: fetchError } = await supabase
      .from('scanned_items')
      .select('id, book_id, chapter_id, latex_doc, latex_conversion_status')
      .in('id', itemIds);

    if (fetchError) throw fetchError;

    if (!items || items.length === 0) {
      throw new Error('No scanned items found for the provided IDs');
    }

    // Validate all items have completed latex conversion
    const incompleteItems = items.filter(
      (item) => item.latex_conversion_status !== 'completed' || !item.latex_doc
    );

    if (incompleteItems.length > 0) {
      throw new Error(
        `${incompleteItems.length} item(s) do not have completed LaTeX conversion`
      );
    }

    // Use book_id and chapter_id from first item
    const firstItem = items[0];

    // Default type to 'Question Bank' if not provided
    const sourceType = options.type || 'Question Bank';

    const { data, error } = await supabase
      .from('question_sets')
      .insert({
        name: options.name || `Question Set ${new Date().toISOString()}`,
        book_id: firstItem.book_id,
        chapter_id: firstItem.chapter_id,
        source_item_ids: itemIds,
        status: 'pending',
        source_type: sourceType,
        metadata: options.metadata || {},
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Extract questions from a question set
   * @param {string} questionSetId - ID of the question set
   * @param {string} provider - Extraction provider ('llamaparse' or 'gemini')
   * @returns {Promise<object>} - Updated question set with extracted questions
   */
  async extractQuestions(questionSetId, provider = EXTRACTION_PROVIDERS.LLAMAPARSE, numberOfQuestions = null) {
    try {
      // Update status to processing
      await this.updateStatus(questionSetId, 'processing');

      // Get question set
      const questionSet = await this.findById(questionSetId);
      if (!questionSet) {
        throw new Error('Question set not found');
      }

      // Combine latex content from source items
      const combinedContent = await this.combineLatexContent(questionSet.source_item_ids);
      console.log(`[EXTRACT] Combined LaTeX content size: ${Math.round(combinedContent.length / 1024)}KB`);

      // Detect whether any source item contributed pre-extracted content with question boundary markers.
      const hasMarkers = combinedContent.includes(Q_START_MARKER) && combinedContent.includes(Q_END_MARKER);
      if (hasMarkers) {
        console.log(`[EXTRACT] Detected pre-extraction markers (${Q_START_MARKER} / ${Q_END_MARKER}) in combined content`);
      }

      console.log(`[EXTRACT] ===== INPUT CONTENT SENT TO PROVIDER =====`);
      console.log(combinedContent);
      console.log(`[EXTRACT] ===== END INPUT CONTENT (length: ${combinedContent.length}) =====`);

      // Get source type for instructions
      const sourceType = questionSet.source_type || 'Question Bank';
      let questions;

      // Academic books carry block structure (exercise / example groups plus the
      // topic each belongs to), so they get their own deterministic parser and
      // produce { blocks: [...] } rather than a flat { questions: [...] }.
      const academicMarkers = hasAcademicBookMarkers(combinedContent);

      if (sourceType === 'Academic Book' && academicMarkers) {
        console.log(`[EXTRACT] Academic Book markers detected — using block parser (LLM bypassed)`);
        const { blocks, warnings } = parseAcademicBookBlocks(combinedContent);

        for (const warning of warnings) {
          console.warn(`[EXTRACT] ⚠️ ${warning}`);
        }

        const totalItems = blocks.reduce((n, b) => n + b.toc_question_items.length, 0);
        console.log(
          `[EXTRACT] Parsed ${blocks.length} blocks ` +
          `(${blocks.filter((b) => b.type === 'EXERCISE').length} exercise, ` +
          `${blocks.filter((b) => b.type === 'EXAMPLE').length} example groups), ` +
          `${totalItems} items total`
        );

        questions = { blocks, parse_warnings: warnings };
      } else if (sourceType === 'Academic Book' && !academicMarkers) {
        // Falling through to the flat path would silently discard the grouping
        // the operator expects from an Academic Book extraction.
        // Name the actual cause: no annotation at all, an annotation done in
        // Question Bank mode, or an annotation that came back without markers.
        let cause;
        if (hasMarkers) {
          cause =
            'The selected items were pre-extracted in "Question Bank" mode (they carry ' +
            `${Q_START_MARKER} markers, not example/exercise block markers). Re-run pre-extraction ` +
            'with source type "Academic Book".';
        } else {
          cause =
            'The selected items have no block markers. Run pre-extraction with source type ' +
            '"Academic Book" — and if it reports no markers were produced, retry it with the ' +
            'Gemini provider.';
        }
        throw new Error(`Academic Book extraction requires block markers. ${cause}`);
      } else if (hasMarkers) {
        // Marker mode: block boundaries are explicit and parsing is mechanical.
        // The LLM was unreliable on multi-block input (mirroring the solution
        // extraction bug where it returned 5 entries for 10 markers), so bypass
        // it entirely and parse blocks deterministically in code.
        console.log(`[EXTRACT] Marker mode detected — using deterministic in-code parser (LLM bypassed)`);
        questions = this.parseMarkerBlocks(combinedContent);
        console.log(`[EXTRACT] Deterministic marker parse: ${questions.questions.length} questions`);
      } else {
        let rawResult;

        if (provider === EXTRACTION_PROVIDERS.GEMINI) {
          // Use Gemini for extraction
          console.log(`[EXTRACT] Using Gemini AI for extraction`);
          rawResult = await this.extractWithGemini(combinedContent, sourceType, numberOfQuestions, hasMarkers);
          console.log(`[EXTRACT] Gemini raw result size: ${Math.round(rawResult.length / 1024)}KB`);
        } else {
          // Use LlamaParse for extraction (default)
          console.log(`[EXTRACT] Using LlamaParse for extraction`);
          const jobId = await this.submitToLlamaParse(combinedContent, sourceType, numberOfQuestions, hasMarkers);

          // Store the job ID
          await supabase
            .from('question_sets')
            .update({ llamaparse_job_id: jobId })
            .eq('id', questionSetId);

          // Poll for completion
          rawResult = await this.pollForCompletion(jobId);
          console.log(`[EXTRACT] LlamaParse raw result size: ${Math.round(rawResult.length / 1024)}KB`);
        }

        console.log(`[EXTRACT] Raw result preview (first 500 chars): ${rawResult.substring(0, 500)}`);

        // Parse the result into MCQ format
        questions = this.parseQuestionsFromContent(rawResult);
      }

      const questionsJson = JSON.stringify(questions);
      const totalQuestions = countQuestions(questions);
      console.log(`[EXTRACT] Parsed questions count: ${totalQuestions}`);
      console.log(`[EXTRACT] Questions JSON size: ${Math.round(questionsJson.length / 1024)}KB`);

      if (hasMarkers) {
        const expectedCount = (combinedContent.match(new RegExp(Q_START_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        const gotCount = questions.questions?.length || 0;
        if (gotCount !== expectedCount) {
          console.warn(`[EXTRACT] ⚠️ Marker count mismatch: input has ${expectedCount} ${Q_START_MARKER} markers but parser returned ${gotCount} questions`);
        } else {
          console.log(`[EXTRACT] ✓ Marker count matches: ${gotCount} questions for ${expectedCount} markers`);
        }
      }

      // Update question set with results
      const { data, error } = await supabase
        .from('question_sets')
        .update({
          questions: questions,
          total_questions: totalQuestions,
          status: 'completed',
          error_message: null,
        })
        .eq('id', questionSetId)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        console.log(`[EXTRACT] Question Set ID: ${data.id}`);
        console.log(`[EXTRACT] Saved to DB. Returned questions count: ${countQuestions(data.questions)}`);
        console.log(`[EXTRACT] total_questions field: ${data.total_questions}`);
      }

      // Verify by re-fetching
      const { data: verifyData } = await supabase
        .from('question_sets')
        .select('id, questions, total_questions')
        .eq('id', questionSetId)
        .single();

      if (verifyData) {
        console.log(`[EXTRACT] VERIFY - Re-fetched questions count: ${countQuestions(verifyData.questions)}`);
      }

      return data;
    } catch (error) {
      console.error('Question extraction error:', error);
      await this.updateStatus(questionSetId, 'failed', error.message);
      throw error;
    }
  },

  /**
   * Combine latex documents from scanned items (preserving order).
   * Prefers pre_extracted (with question boundary markers) over latex_doc when present.
   * @param {string[]} itemIds - Array of scanned item IDs (in order)
   * @returns {Promise<string>} - Combined content
   */
  async combineLatexContent(itemIds) {
    const { data: items, error } = await supabase
      .from('scanned_items')
      .select('id, latex_doc, pre_extracted, latex_conversion_status')
      .in('id', itemIds);

    if (error) throw error;

    console.log(`[EXTRACT] Source items: ${items.length} items for ${itemIds.length} IDs`);

    const itemMap = new Map(items.map((item) => [item.id, item]));

    const combinedParts = itemIds.map((id, index) => {
      const row = itemMap.get(id);
      const usingPre = !!(row && row.pre_extracted);
      const content = (usingPre ? row.pre_extracted : row?.latex_doc) || '';
      console.log(`[EXTRACT] Item ${index + 1} (${id}): ${content ? Math.round(content.length / 1024) + 'KB' : 'EMPTY/NULL'} (source: ${usingPre ? 'pre_extracted' : 'latex_doc'})`);
      return `% ========== Document ${index + 1} ==========\n\n${content}`;
    });

    return combinedParts.join('\n\n');
  },

  /**
   * Submit content to LlamaParse for question extraction
   * @param {string} content - Combined LaTeX/text content
   * @param {string} sourceType - Source type ('Question Bank' or 'Academic Book')
   * @returns {Promise<string>} - Job ID from LlamaParse
   */
  async submitToLlamaParse(content, sourceType = 'Question Bank', numberOfQuestions = null, hasMarkers = false) {
    // Create a text file blob from the combined content
    const blob = new Blob([content], { type: 'text/plain' });

    // Get parsing instructions based on source type
    const parsingInstructions = getParsingInstructions(sourceType, numberOfQuestions, hasMarkers);
    console.log(`[EXTRACT] Using parsing instructions for type: ${sourceType}${numberOfQuestions ? ` (target count: ${numberOfQuestions})` : ''}${hasMarkers ? ' [marker-aware]' : ''}`);

    const formData = new FormData();
    formData.append('file', blob, 'questions.txt');
    formData.append('parsing_instruction', parsingInstructions);
    formData.append('result_type', 'markdown');
    formData.append('premium_mode', 'true');

    const response = await fetch(`${LLAMAPARSE_API_URL}/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LLAMAPARSE_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LlamaParse upload failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result.id;
  },

  /**
   * Poll LlamaParse for job completion
   * @param {string} jobId - LlamaParse job ID
   * @returns {Promise<string>} - Extracted content
   */
  async pollForCompletion(jobId, maxAttempts = 120, intervalMs = 2000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const statusResponse = await fetch(`${LLAMAPARSE_API_URL}/job/${jobId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${LLAMAPARSE_API_KEY}`,
        },
      });

      if (!statusResponse.ok) {
        throw new Error(`Failed to check job status: ${statusResponse.status}`);
      }

      const statusData = await statusResponse.json();

      if (statusData.status === 'SUCCESS') {
        // Get the result
        return await this.getResult(jobId);
      }

      if (statusData.status === 'ERROR') {
        throw new Error(statusData.error || 'LlamaParse processing failed');
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error('LlamaParse extraction timed out');
  },

  /**
   * Get result from LlamaParse
   * @param {string} jobId - LlamaParse job ID
   * @returns {Promise<string>} - Extracted content
   */
  async getResult(jobId) {
    const response = await fetch(`${LLAMAPARSE_API_URL}/job/${jobId}/result/markdown`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${LLAMAPARSE_API_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get result: ${response.status}`);
    }

    const result = await response.json();
    return result.markdown || result.text || JSON.stringify(result);
  },

  /**
   * Extract questions using Gemini AI
   * @param {string} content - Combined LaTeX/text content
   * @param {string} sourceType - Source type ('Question Bank' or 'Academic Book')
   * @returns {Promise<string>} - Extracted content with questions in JSON format
   */
  async extractWithGemini(content, sourceType = 'Question Bank', numberOfQuestions = null, hasMarkers = false) {
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured. Please set GOOGLE_API_KEY in environment variables.');
    }

    const parsingInstructions = getParsingInstructions(sourceType, numberOfQuestions, hasMarkers);

    // Split content into chunks if too large (Gemini has context limits)
    const MAX_CONTENT_LENGTH = 900000; // ~900KB to stay within limits
    let chunks = [];

    if (content.length > MAX_CONTENT_LENGTH) {
      console.log(`[EXTRACT] Content too large (${Math.round(content.length / 1024)}KB), splitting into chunks`);

      // Split by document markers or by size
      const documentParts = content.split(/% ========== Document \d+ ==========/);
      let currentChunk = '';

      for (const part of documentParts) {
        if ((currentChunk + part).length > MAX_CONTENT_LENGTH && currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = part;
        } else {
          currentChunk += part;
        }
      }
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }

      console.log(`[EXTRACT] Split into ${chunks.length} chunks`);
    } else {
      chunks = [content];
    }

    // Process each chunk and merge results
    const allQuestions = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[EXTRACT] Processing chunk ${i + 1}/${chunks.length} (${Math.round(chunk.length / 1024)}KB)`);

      const chunkPrompt = `${parsingInstructions}

DOCUMENT CONTENT (Part ${i + 1} of ${chunks.length}):
${chunk}

IMPORTANT: Return ONLY the JSON object with the "questions" array. Do not include any markdown code blocks or additional text. The response should start with { and end with }.`;

      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: chunkPrompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 65536,
          responseMimeType: 'application/json',
        },
      };

      const response = await fetch(
        `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[EXTRACT] Gemini API error: ${response.status} - ${errorText}`);
        throw new Error(`Gemini API request failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      // Extract text from Gemini response
      const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!generatedText) {
        console.error(`[EXTRACT] Gemini response structure:`, JSON.stringify(result, null, 2));
        throw new Error('No text generated from Gemini');
      }

      console.log(`[EXTRACT] Gemini chunk ${i + 1} response length: ${generatedText.length}`);

      // Try to parse questions from this chunk
      try {
        // Clean up the response - remove markdown code blocks if present
        let cleanedText = generatedText.trim();
        if (cleanedText.startsWith('```json')) {
          cleanedText = cleanedText.slice(7);
        } else if (cleanedText.startsWith('```')) {
          cleanedText = cleanedText.slice(3);
        }
        if (cleanedText.endsWith('```')) {
          cleanedText = cleanedText.slice(0, -3);
        }
        cleanedText = cleanedText.trim();

        const parsed = JSON.parse(cleanedText);
        if (parsed.questions && Array.isArray(parsed.questions)) {
          allQuestions.push(...parsed.questions);
          console.log(`[EXTRACT] Extracted ${parsed.questions.length} questions from chunk ${i + 1}`);
        }
      } catch (parseErr) {
        console.error(`[EXTRACT] Failed to parse Gemini chunk ${i + 1} response: ${parseErr.message}`);
        // Continue with raw text - the main parser will try to extract questions
      }
    }

    // If we successfully extracted questions from chunks, return them as JSON
    if (allQuestions.length > 0) {
      console.log(`[EXTRACT] Total questions extracted via Gemini: ${allQuestions.length}`);
      return JSON.stringify({ questions: allQuestions });
    }

    // If chunk parsing failed, return the last result for main parser to handle
    // This handles single chunk case or fallback
    const lastChunkPrompt = `${parsingInstructions}

DOCUMENT CONTENT:
${chunks[chunks.length - 1]}

IMPORTANT: Return ONLY the JSON object with the "questions" array. Do not include any markdown code blocks or additional text.`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: lastChunkPrompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 65536,
      },
    };

    const response = await fetch(
      `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API request failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result.candidates?.[0]?.content?.parts?.[0]?.text || '';
  },

  /**
   * Fix invalid escape sequences in JSON string (LlamaParse bug workaround)
   * LlamaParse returns LaTeX with single backslashes in JSON strings (\wedge, \sim, etc.)
   * These need to be escaped as \\ for valid JSON
   * @param {string} jsonStr - JSON string potentially containing invalid escape sequences
   * @returns {string} - Fixed JSON string
   */
  fixInvalidEscapeSequences(jsonStr) {
    let fixCount = 0;
    let result = '';
    let i = 0;

    while (i < jsonStr.length) {
      // Look for the start of a string value
      if (jsonStr[i] === '"') {
        result += '"';
        i++;

        // Process the content of the string until we find the closing quote
        while (i < jsonStr.length) {
          const char = jsonStr[i];

          if (char === '\\' && i + 1 < jsonStr.length) {
            const nextChar = jsonStr[i + 1];

            // Check if this is a valid JSON escape sequence
            // Valid: \" \\ \/ \b \f \n \r \t \uXXXX
            if ('"\\/bfnrtu'.includes(nextChar)) {
              // Valid escape - keep as is
              result += char + nextChar;
              i += 2;
            } else {
              // Invalid escape - double the backslash
              result += '\\\\' + nextChar;
              fixCount++;
              i += 2;
            }
          } else if (char === '"') {
            // Found unescaped closing quote - end of string
            result += '"';
            i++;
            break;
          } else {
            result += char;
            i++;
          }
        }
      } else {
        result += jsonStr[i];
        i++;
      }
    }

    if (fixCount > 0) {
      console.log(`[EXTRACT] Fixed ${fixCount} invalid escape sequences in JSON`);
    }

    return result;
  },

  /**
   * Deterministically split pre-extracted content by <<<Q_START>>> / <<<Q_END>>>
   * markers and parse each block's header + MCQ choices.
   *
   * Used in marker mode to bypass the LLM entirely — when boundaries are
   * explicit, parsing is mechanical and the LLM has been observed to merge or
   * skip blocks on multi-block input.
   *
   * Recognized header forms (first non-empty line of each block):
   *   ":<n>)."  / ":<n>). <text>"    → label=<n>            (primary new format)
   *   "<n>)."   / "<n>). <text>"     → label=<n>            (legacy parens form)
   *   "<n>."    / "<n>. <text>"      → label=<n>            (legacy MCQ-style)
   *   "Q<n>."   / "Q<n>. <text>"     → label=<n>
   *   "\section*{<n>. ...}"          → label=<n>
   *
   * Choice lines (anywhere after the header) match: "(a)" / "(A)" / "(b)" /
   * etc. through "(e)" / "(E)" — preserved in source order.
   */
  parseMarkerBlocks(combinedContent) {
    const startToken = Q_START_MARKER;
    const endToken = Q_END_MARKER;

    // Split a single line into a leading stem fragment + zero or more MCQ
    // choices.
    //
    // At LINE START we accept both shapes (with optional bullet "-"/"*"/"•"):
    //     "a) text"   →   bare letter + closing paren
    //     "(a) text"  →   parens-wrapped
    // INLINE (anywhere else on the line) we only accept the parens-wrapped
    // form "(a)" (whitespace-bounded), to avoid false positives in prose like
    // "the value at point a) on the graph". The single-letter constraint
    // (a–e / A–E) plus the whitespace bounding also keeps us safe inside
    // LaTeX expressions like \left(2x\right) and \frac{a}{b}.
    //
    // Layouts handled:
    //   "a) 5 cm"                              one choice (bare, line-start)
    //   "(a) 5 cm"                             one choice (parens, line-start)
    //   "(a) 5 (b) 10 (c) 15 (d) 20"           several inline (parens)
    //   "Find x. (a) 1 (b) 2 ..."              stem + inline choices
    //   "Stem text"                             pure stem
    const lineStartChoiceRe = /^\s*[-*•]?\s*\(?([a-eA-E])\)\s+(.*)$/;
    const inlineParenChoiceRe = /(?:^|(?<=\s))\(([a-eA-E])\)(?=\s|$)/g;

    const splitChoicesFromLine = (line) => {
      // Step 1: line-start choice marker (bare or parens). The rest of the
      // line is treated as ONE choice body. We don't try to further split
      // the body for additional inline markers — extremely rare, and the
      // user's format keeps each choice on its own line.
      const startMatch = line.match(lineStartChoiceRe);
      if (startMatch) {
        return {
          leadingStem: '',
          choices: [{ letter: startMatch[1], body: startMatch[2].trim() }],
        };
      }
      // Step 2: scan for inline parens-wrapped markers.
      const markers = [];
      let m;
      while ((m = inlineParenChoiceRe.exec(line)) !== null) {
        markers.push({ letter: m[1], start: m.index, end: m.index + 3 });
      }
      // Reset lastIndex so subsequent calls aren't affected by global state.
      inlineParenChoiceRe.lastIndex = 0;
      if (markers.length === 0) return { leadingStem: line, choices: [] };
      const leadingStem = line.substring(0, markers[0].start).trim();
      const choices = markers.map((mk, i) => ({
        letter: mk.letter,
        body: line
          .substring(mk.end, i + 1 < markers.length ? markers[i + 1].start : line.length)
          .trim(),
      }));
      return { leadingStem, choices };
    };

    const questions = [];
    let cursor = 0;

    while (true) {
      const startIdx = combinedContent.indexOf(startToken, cursor);
      if (startIdx === -1) break;
      const endIdx = combinedContent.indexOf(endToken, startIdx + startToken.length);
      if (endIdx === -1) {
        console.warn(`[EXTRACT] Unmatched ${startToken} at position ${startIdx} — stopping`);
        break;
      }

      const blockContent = combinedContent.substring(startIdx + startToken.length, endIdx);
      cursor = endIdx + endToken.length;

      const lines = blockContent.split('\n');
      let headerIdx = 0;
      while (headerIdx < lines.length && lines[headerIdx].trim() === '') headerIdx++;

      if (headerIdx >= lines.length) {
        console.warn(`[EXTRACT] Empty block #${questions.length + 1} between markers — emitting placeholder`);
        questions.push({
          question_label: String(questions.length + 1),
          text: '',
          choices: [],
        });
        continue;
      }

      const headerLine = lines[headerIdx];
      let questionLabel = '';
      let headerRemainder = '';
      let m;

      if ((m = headerLine.match(/^\s*:\s*(\d+)\s*\)\s*\.\s*(.*)$/))) {
        // Primary: ":<n>)." or ":<n>). <text>"
        questionLabel = m[1];
        headerRemainder = m[2].trim();
      } else if ((m = headerLine.match(/^\s*\\section\*\{\s*(?:Q\.?\s*)?(\d+)\s*\.[^}]*\}\s*(.*)$/i))) {
        // "\section*{<n>. ...}"
        questionLabel = m[1];
        headerRemainder = m[2].trim();
      } else if ((m = headerLine.match(/^\s*(\d+)\s*\)\s*\.\s*(.*)$/))) {
        // Legacy: "<n>)."
        questionLabel = m[1];
        headerRemainder = m[2].trim();
      } else if ((m = headerLine.match(/^\s*(?:Q\.?\s*)?(\d+)\s*\.\s*(.*)$/i))) {
        // Legacy MCQ-style: "<n>." or "Q<n>."
        questionLabel = m[1];
        headerRemainder = m[2].trim();
      } else {
        // Malformed — fall back to ordinal, keep header line in body
        console.warn(`[EXTRACT] Block #${questions.length + 1} has malformed header: ${JSON.stringify(headerLine.slice(0, 80))} — using ordinal label`);
        questionLabel = String(questions.length + 1);
        headerRemainder = headerLine.trim();
      }

      // Walk remaining lines, separating stem text from MCQ choices.
      const stemLines = [];
      const choices = [];
      let inChoices = false;

      // Process the header remainder first (text on the same line as ":1)." —
      // may itself be stem and/or contain inline choices).
      if (headerRemainder) {
        const { leadingStem, choices: lineChoices } = splitChoicesFromLine(headerRemainder);
        if (lineChoices.length > 0) {
          if (leadingStem) stemLines.push(leadingStem);
          inChoices = true;
          for (const c of lineChoices) choices.push(`(${c.letter}) ${c.body}`);
        } else {
          stemLines.push(headerRemainder);
        }
      }

      for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed === '') continue;
        const { leadingStem, choices: lineChoices } = splitChoicesFromLine(line);

        if (lineChoices.length > 0) {
          // Any leading text either continues the previous choice (math wrap)
          // or, if we're still in stem territory, becomes part of the stem.
          if (leadingStem) {
            if (inChoices && choices.length > 0) {
              choices[choices.length - 1] = `${choices[choices.length - 1]} ${leadingStem}`.trim();
            } else {
              stemLines.push(leadingStem);
            }
          }
          inChoices = true;
          for (const c of lineChoices) choices.push(`(${c.letter}) ${c.body}`);
        } else if (inChoices) {
          // No marker on this line — treat as a continuation of the last
          // choice (multi-line math, wrapped answer, etc.).
          if (choices.length > 0) {
            choices[choices.length - 1] = `${choices[choices.length - 1]} ${trimmed}`.trim();
          }
        } else {
          stemLines.push(line);
        }
      }

      while (stemLines.length > 0 && stemLines[0].trim() === '') stemLines.shift();
      while (stemLines.length > 0 && stemLines[stemLines.length - 1].trim() === '') stemLines.pop();

      questions.push({
        question_label: questionLabel,
        text: stemLines.join('\n'),
        choices,
      });
    }

    console.log(`[EXTRACT] parseMarkerBlocks: extracted ${questions.length} blocks`);
    return { questions };
  },

  /**
   * Parse extracted content into MCQ JSON format
   * @param {string} rawContent - Raw extracted content from LlamaParse
   * @returns {object} - Structured questions object
   */
  parseQuestionsFromContent(rawContent) {
    try {
      console.log(`[EXTRACT] Starting to parse raw content of length: ${rawContent.length}`);

      // Find ALL JSON objects with "questions" arrays and merge them
      const allQuestions = [];
      let searchStart = 0;
      let jsonBlockCount = 0;

      while (true) {
        // Find next JSON object with questions - try multiple patterns
        let jsonStart = -1;

        // Pattern 1: {"questions"
        const pattern1 = rawContent.indexOf('{"questions"', searchStart);

        // Pattern 2: { "questions" (with space)
        const pattern2 = rawContent.indexOf('{ "questions"', searchStart);

        // Pattern 3: Regex for various whitespace
        const remainingContent = rawContent.substring(searchStart);
        const regexMatch = remainingContent.match(/\{\s*"questions"\s*:\s*\[/);
        const pattern3 = regexMatch ? searchStart + remainingContent.indexOf(regexMatch[0]) : -1;

        // Take the earliest valid match
        const validPatterns = [pattern1, pattern2, pattern3].filter(p => p !== -1);
        if (validPatterns.length > 0) {
          jsonStart = Math.min(...validPatterns);
        }

        if (jsonStart === -1) {
          console.log(`[EXTRACT] No more JSON blocks found after position ${searchStart}`);
          break;
        }

        console.log(`[EXTRACT] Found potential JSON block at position ${jsonStart}`);

        // Find matching closing brace
        let braceCount = 0;
        let jsonEnd = -1;
        let inString = false;
        let escapeNext = false;

        for (let i = jsonStart; i < rawContent.length; i++) {
          const char = rawContent[i];

          if (escapeNext) {
            escapeNext = false;
            continue;
          }

          if (char === '\\') {
            escapeNext = true;
            continue;
          }

          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }

          if (!inString) {
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;
            if (braceCount === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
        }

        if (jsonEnd !== -1) {
          const jsonStr = rawContent.substring(jsonStart, jsonEnd);
          console.log(`[EXTRACT] Attempting to parse JSON block ${++jsonBlockCount}, length: ${jsonStr.length}`);

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.questions && Array.isArray(parsed.questions)) {
              console.log(`[EXTRACT] Successfully parsed JSON block ${jsonBlockCount} with ${parsed.questions.length} questions`);
              allQuestions.push(...parsed.questions);
            } else {
              console.log(`[EXTRACT] JSON block ${jsonBlockCount} does not have valid questions array`);
            }
          } catch (parseErr) {
            console.error(`[EXTRACT] Failed to parse JSON block ${jsonBlockCount}: ${parseErr.message}`);
            console.log(`[EXTRACT] Attempting to fix invalid escape sequences and retry...`);

            try {
              // Fix invalid escape sequences (LlamaParse bug workaround)
              const fixedJsonStr = this.fixInvalidEscapeSequences(jsonStr);
              const parsed = JSON.parse(fixedJsonStr);

              if (parsed.questions && Array.isArray(parsed.questions)) {
                console.log(`[EXTRACT] ✅ Successfully parsed JSON block ${jsonBlockCount} after fixing escape sequences (${parsed.questions.length} questions)`);
                allQuestions.push(...parsed.questions);
              } else {
                console.log(`[EXTRACT] JSON block ${jsonBlockCount} does not have valid questions array after fix`);
              }
            } catch (retryErr) {
              console.error(`[EXTRACT] Failed to parse JSON block ${jsonBlockCount} even after fixing escape sequences: ${retryErr.message}`);
              console.log(`[EXTRACT] JSON block preview: ${jsonStr.substring(0, 200)}...`);
            }
          }
          searchStart = jsonEnd;
        } else {
          console.log(`[EXTRACT] Could not find closing brace for JSON block starting at ${jsonStart}`);
          searchStart = jsonStart + 1;
        }
      }

      if (allQuestions.length > 0) {
        // Deduplicate questions by question_label
        const uniqueQuestions = [];
        const seenLabels = new Set();

        for (const q of allQuestions) {
          const label = q.question_label || '';
          if (!seenLabels.has(label)) {
            seenLabels.add(label);
            uniqueQuestions.push(q);
          } else {
            console.log(`[EXTRACT] Skipping duplicate question with label: ${label}`);
          }
        }

        console.log(`[EXTRACT] Total merged questions: ${allQuestions.length}, unique: ${uniqueQuestions.length}`);
        return { questions: uniqueQuestions };
      }

      console.log(`[EXTRACT] No JSON blocks found, attempting markdown/text parsing`);

      // If no JSON found, try to parse markdown format
      const questions = [];

      // More comprehensive regex for question detection
      const questionPatterns = [
        /(?:^|\n)\s*(\d+)[\.\)]\s+(.+?)(?=\n\s*\d+[\.\)]|\n\s*$|$)/gis,
        /(?:^|\n)\s*Q(?:uestion)?\.?\s*(\d+)[\.\:\)]\s*(.+?)(?=\n\s*Q(?:uestion)?\.?\s*\d+|\n\s*$|$)/gis,
        /(?:^|\n)\s*\((\d+)\)\s+(.+?)(?=\n\s*\(\d+\)|\n\s*$|$)/gis,
      ];

      for (const regex of questionPatterns) {
        let match;
        while ((match = regex.exec(rawContent)) !== null) {
          const questionLabel = match[1];
          const questionBlock = match[2] || match[0];

          // Find choices in the question block - handle both (a), (b) and A., B. formats
          const choices = [];

          // Try lowercase format first: (a), (b), (c), (d)
          const lowercaseChoiceRegex = /\(([a-d])\)\s*(.+?)(?=\n\s*\([a-d]\)|\n\s*\d+[\.\)]|\n\s*$|$)/gi;
          let choiceMatch;
          while ((choiceMatch = lowercaseChoiceRegex.exec(questionBlock)) !== null) {
            choices.push(`(${choiceMatch[1]}) ${choiceMatch[2].trim()}`);
          }

          // If no lowercase choices found, try uppercase format: A., B., C., D. or (A), (B)
          if (choices.length === 0) {
            const uppercaseChoiceRegex = /(?:^|\n)\s*\(?([A-E])\)?[\.\)]\s*(.+?)(?=\n\s*\(?[A-E]\)?[\.\)]|\n\s*$|$)/gi;
            while ((choiceMatch = uppercaseChoiceRegex.exec(questionBlock)) !== null) {
              choices.push(`(${choiceMatch[1].toLowerCase()}) ${choiceMatch[2].trim()}`);
            }
          }

          // Extract question text (before choices)
          let questionText = questionBlock;
          if (choices.length > 0) {
            // Split at first choice pattern
            questionText = questionBlock.split(/\n\s*\(?[a-dA-E]\)?[\.\)]/i)[0].trim();
          }

          if (questionText) {
            questions.push({
              question_label: questionLabel,
              text: questionText.trim(),
              choices: choices,
            });
          }
        }

        if (questions.length > 0) {
          console.log(`[EXTRACT] Parsed ${questions.length} questions using markdown fallback`);
          break;
        }
      }

      return { questions };
    } catch (error) {
      console.error('Error parsing questions:', error);
      // Return raw content wrapped in a structure
      return {
        questions: [],
        raw_content: rawContent,
        parse_error: error.message,
      };
    }
  },

  /**
   * Update question set status
   */
  async updateStatus(questionSetId, status, errorMessage = null) {
    const updateData = { status };
    if (errorMessage) {
      updateData.error_message = errorMessage;
    }

    const { error } = await supabase
      .from('question_sets')
      .update(updateData)
      .eq('id', questionSetId);

    if (error) console.error('Failed to update status:', error);
  },

  /**
   * Get question set by ID
   */
  async findById(questionSetId) {
    const { data, error } = await supabase
      .from('question_sets')
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number)
      `)
      .eq('id', questionSetId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  /**
   * Get all question sets with optional filters
   */
  async getAll(filters = {}) {
    let query = supabase
      .from('question_sets')
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number)
      `)
      .order('created_at', { ascending: false });

    if (filters.bookId) {
      query = query.eq('book_id', filters.bookId);
    }
    if (filters.chapterId) {
      query = query.eq('chapter_id', filters.chapterId);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data;
  },

  /**
   * Replace the questions JSON for an existing question set.
   * Accepts either a wrapped object `{ questions: [...] }` or a bare array,
   * normalizing to the wrapped shape that the rest of the pipeline expects.
   * Also updates total_questions to keep the count column in sync.
   */
  async updateQuestions(questionSetId, questionsInput) {
    let normalized;
    if (Array.isArray(questionsInput)) {
      normalized = { questions: questionsInput };
    } else if (
      questionsInput &&
      typeof questionsInput === 'object' &&
      (Array.isArray(questionsInput.questions) || Array.isArray(questionsInput.blocks))
    ) {
      // Academic Book sends grouped blocks; Question Bank sends a flat list.
      normalized = { ...questionsInput };
    } else {
      throw new Error(
        'Invalid questions format. Expected { questions: [...] }, { blocks: [...] } or [...]'
      );
    }

    const count = countQuestions(normalized);

    const { data, error } = await supabase
      .from('question_sets')
      .update({
        questions: normalized,
        total_questions: count,
      })
      .eq('id', questionSetId)
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
   * Delete a question set
   */
  async delete(questionSetId) {
    const { error } = await supabase
      .from('question_sets')
      .delete()
      .eq('id', questionSetId);

    if (error) throw error;
    return true;
  },

  /**
   * Create a question set from manually provided JSON
   * @param {object} options - Options for creating the question set
   * @param {string} options.name - Name of the question set
   * @param {string} options.bookId - Book ID (optional)
   * @param {string} options.chapterId - Chapter ID (optional)
   * @param {object} options.questions - Questions JSON object with questions array
   * @returns {Promise<object>} - Created question set record
   */
  async createManualQuestionSet(options) {
    const { name, bookId, chapterId, questions } = options;

    console.log('[IMPORT SERVICE] Creating manual question set:', {
      name,
      bookId,
      chapterId,
      questionCount: questions?.questions?.length,
    });

    if (!questions || !questions.questions || !Array.isArray(questions.questions)) {
      throw new Error('Invalid questions format. Expected { questions: [...] }');
    }

    const insertData = {
      name: name || `Manual Import ${new Date().toISOString()}`,
      book_id: bookId || null,
      chapter_id: chapterId || null,
      source_item_ids: [],
      source_type: 'Question Bank', // Must use valid type per DB constraint
      status: 'completed',
      questions: questions,
      total_questions: questions.questions.length,
      metadata: { source: 'manual_import' },
    };

    console.log('[IMPORT SERVICE] Insert data prepared, book_id:', insertData.book_id, 'chapter_id:', insertData.chapter_id);

    const { data, error } = await supabase
      .from('question_sets')
      .insert(insertData)
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number)
      `)
      .single();

    if (error) {
      console.error('[IMPORT SERVICE] Supabase error:', error);
      console.error('[IMPORT SERVICE] Error code:', error.code);
      console.error('[IMPORT SERVICE] Error message:', error.message);
      console.error('[IMPORT SERVICE] Error details:', error.details);
      throw error;
    }

    console.log('[IMPORT SERVICE] Successfully created question set with ID:', data.id);
    return data;
  },
};

export default questionExtractionService;
