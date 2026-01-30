import { supabase } from '../config/database.js';
import { config } from '../config/index.js';

const LLAMAPARSE_API_URL = config.llamaParse.apiUrl;
const LLAMAPARSE_API_KEY = config.llamaParse.apiKey;

// Gemini API configuration
const GEMINI_API_URL = config.gemini.apiUrl;
const GEMINI_API_KEY = config.gemini.apiKey;
const GEMINI_MODEL = config.gemini.model;

// Extraction provider options
export const SOLUTION_EXTRACTION_PROVIDERS = {
  LLAMAPARSE: 'llamaparse',
  GEMINI: 'gemini',
};

// Parsing instructions by source type
const SOLUTION_PARSING_INSTRUCTIONS = {
  'Question Bank': `
CRITICAL: Extract EVERY SINGLE solution as a SEPARATE JSON object. Each solution must be its own entry in the solutions array.

This document contains solutions for competitive exam questions (JEE, NEET, etc.).

CRITICAL - SOLUTION SEPARATION:
- Each question number (1, 2, 3, ..., 30) is a SEPARATE solution
- NEVER combine multiple solutions into one JSON object
- When you see "8. (D)" or "\\section*{8. (D)}", that is the START of solution 8 and the END of solution 7
- Each worked_solution field contains ONLY the content for THAT specific question
- If you see content like "7. (D) ... content ... 8. (D) ... more content", these are TWO separate solutions, not one

IMPORTANT - HANDLING IMAGES:
- Solutions may contain image references like: ![](https://cdn.mathpix.com/cropped/...)
- EXTRACT the image URL into the "visual_path" field (just the URL, not the markdown)
- CONTINUE extracting all text and math AFTER the image into worked_solution
- Do NOT stop at images - the worked solution continues after them

CRITICAL - PRESERVING LATEX BLOCK ENVIRONMENTS:
Solutions often contain multi-line LaTeX blocks. You MUST preserve them correctly:

CORRECT format for aligned equations:
"$\\begin{aligned} & \\frac{x-x_1}{a_1} = \\frac{y-y_1}{a_2} \\\\ & \\frac{x-x_2}{b_1} = \\frac{y-y_2}{b_2} \\end{aligned}$"

CORRECT format for gathered equations:
"$\\begin{gathered} \\frac{|\\begin{array}{ccc} 8 & 7 & 3 \\\\ 1 & 2 & -3 \\end{array}|}{\\sqrt{12}} \\end{gathered}$"

Rules for LaTeX blocks:
- Keep $\\begin{aligned}...\\end{aligned}$ as ONE complete string - no breaks
- Keep $\\begin{gathered}...\\end{gathered}$ as ONE complete string - no breaks
- Keep $\\begin{array}...\\end{array}$ intact for matrices/determinants
- Do NOT add spaces between $ and \\begin (write "$\\begin" not "$ \\begin")
- Replace internal newlines within math blocks with spaces or \\\\
- Text BETWEEN math blocks (like "is given as") goes on separate line

SOLUTION FORMAT IN DOCUMENT:
- Question number followed by answer: "22. (11.00)" or "12. (B)" or "6. (C)"
- May have an image reference on next line: ![](url)
- Then the FULL worked solution with all math and steps
- Solution continues until the next question number appears

EXAMPLE WITH IMAGE:
"""
22. (11.00)
![](https://cdn.mathpix.com/cropped/xxx.jpg)
$A(2,6,2) B(-4,0,\\lambda), C(2,3,-1) D(4,5,0)$
Area $= \\frac{1}{2}|\\overrightarrow{BD} \\times \\overrightarrow{AC}| = 18$
$\\overrightarrow{AC} \\times \\overrightarrow{BD} = (3\\lambda + 15)\\hat{i} + 24j - 24k$
$\\lambda = -1, -9$
$|\\lambda| \\leq 5 \\Rightarrow \\lambda = -1$
$5 - 6\\lambda = 5 - 6(-1) = 11$
"""

You must extract:
{
  "question_label": "22",
  "answer_key": "11.00",
  "visual_path": "https://cdn.mathpix.com/cropped/xxx.jpg",
  "worked_solution": "$A(2,6,2) B(-4,0,\\lambda), C(2,3,-1) D(4,5,0)$\\nArea $= \\frac{1}{2}|\\overrightarrow{BD} \\times \\overrightarrow{AC}| = 18$\\n$\\overrightarrow{AC} \\times \\overrightarrow{BD} = (3\\lambda + 15)\\hat{i} + 24j - 24k$\\n$\\lambda = -1, -9$\\n$|\\lambda| \\leq 5 \\Rightarrow \\lambda = -1$\\n$5 - 6\\lambda = 5 - 6(-1) = 11$",
  "explanation": ""
}

EXAMPLE WITHOUT IMAGE:
"""
12. (B)
$\\cos^{-1}(2x) = \\pi + 2\\cos^{-1}(\\sqrt{1-x^2})$
LHS $= [0, \\pi]$
$x = \\frac{-1}{2}$ and $x = 0$ which is not possible
$\\therefore x \\in \\emptyset$, Sum = 0
"""

You must extract:
{
  "question_label": "12",
  "answer_key": "B",
  "worked_solution": "$\\cos^{-1}(2x) = \\pi + 2\\cos^{-1}(\\sqrt{1-x^2})$\\nLHS $= [0, \\pi]$\\n$x = \\frac{-1}{2}$ and $x = 0$ which is not possible\\n$\\therefore x \\in \\emptyset$, Sum = 0",
  "explanation": ""
}

For EACH solution, extract:
1. question_label: The question number (e.g., "22", "12", "6")
2. answer_key: The answer - letter (B, C, D) OR number (11.00, 42) - just the value without parentheses
3. visual_path: If there's an image ![](url), extract JUST the URL (e.g., "https://cdn.mathpix.com/cropped/xxx.jpg"). Empty string if no image.
4. worked_solution: ALL content after answer key, including ALL math and text (skip the image markdown itself)
5. explanation: Any additional explanation (can be empty)

Return in JSON format:
{
  "solutions": [...]
}

EXAMPLE WITH LATEX BLOCK ENVIRONMENTS (Question 9):
"""
9. (C)
Shortest distance between two lines
$\\begin{aligned} & \\frac{x-x_1}{a_1} = \\frac{y-y_1}{a_2} = \\frac{z-z_1}{a_3} \\\\ & \\frac{x-x_2}{b_1} = \\frac{y-y_2}{b_2} = \\frac{z-z_2}{b_3} \\end{aligned}$
is given as
$\\begin{gathered} \\frac{|\\begin{array}{ccc} x_1-x_2 & y_1-y_2 & z_1-z_2 \\\\ a_1 & a_2 & a_3 \\\\ b_1 & b_2 & b_3 \\end{array}|}{\\sqrt{(a_2b_3-a_3b_2)^2+(a_1b_3-a_3b_1)^2+(a_1b_2-a_2b_1)^2}} \\\\ = \\frac{16+14+6}{\\sqrt{12}} = \\frac{36}{2\\sqrt{3}} = 6\\sqrt{3} \\end{gathered}$
"""

You must extract with LaTeX blocks preserved as single strings AND include ALL calculations to the final answer:
{
  "question_label": "9",
  "answer_key": "C",
  "worked_solution": "Shortest distance between two lines\\n$\\begin{aligned} & \\frac{x-x_1}{a_1} = \\frac{y-y_1}{a_2} = \\frac{z-z_1}{a_3} \\\\ & \\frac{x-x_2}{b_1} = \\frac{y-y_2}{b_2} = \\frac{z-z_2}{b_3} \\end{aligned}$\\nis given as\\n$\\begin{gathered} \\frac{|\\begin{array}{ccc} x_1-x_2 & y_1-y_2 & z_1-z_2 \\\\ a_1 & a_2 & a_3 \\\\ b_1 & b_2 & b_3 \\end{array}|}{\\sqrt{(a_2b_3-a_3b_2)^2+(a_1b_3-a_3b_1)^2+(a_1b_2-a_2b_1)^2}} \\\\ = \\frac{16+14+6}{\\sqrt{12}} = \\frac{36}{2\\sqrt{3}} = 6\\sqrt{3} \\end{gathered}$",
  "explanation": ""
}

EXAMPLE WITH MULTIPLE CONSECUTIVE EQUATIONS (Question 8):
"""
8. (D)
Equation of the pair of angle bisector for $ax^2 + 2hxy + by^2 = 0$ is $\\frac{x^2-y^2}{a-b} = \\frac{xy}{h}$
Here $a = 2, h = \\frac{1}{2}$ & $b = -3$
Equation will become
$\\frac{x^2-y^2}{2-(-3)} = \\frac{xy}{1/2}$
$x^2 - y^2 = 10xy$
$x^2 - y^2 - 10xy = 0$
"""

Extract the COMPLETE solution including ALL equations after "Equation will become":
{
  "question_label": "8",
  "answer_key": "D",
  "worked_solution": "Equation of the pair of angle bisector for $ax^2 + 2hxy + by^2 = 0$ is $\\frac{x^2-y^2}{a-b} = \\frac{xy}{h}$\\nHere $a = 2, h = \\frac{1}{2}$ & $b = -3$\\nEquation will become\\n$\\frac{x^2-y^2}{2-(-3)} = \\frac{xy}{1/2}$\\n$x^2 - y^2 = 10xy$\\n$x^2 - y^2 - 10xy = 0$",
  "explanation": ""
}

EXAMPLE WITH IMAGE AND MULTIPLE MATH BLOCKS (Question 22):
"""
22. (11.00)
![](https://cdn.mathpix.com/cropped/xxx.jpg)
$A(2,6,2) B(-4,0,\\lambda), C(2,3,-1) D(4,5,0)$
$\\begin{gathered} \\text{Area} = \\frac{1}{2}|\\overrightarrow{BD} \\times \\overrightarrow{AC}| = 18 \\\\ \\overrightarrow{AC} \\times \\overrightarrow{BD} = |\\begin{array}{ccc} \\hat{i} & \\hat{j} & \\hat{k} \\\\ 0 & -3 & -3 \\\\ 8 & 5 & -\\lambda \\end{array}| \\end{gathered}$
$\\begin{gathered} \\overrightarrow{AC} \\times \\overrightarrow{BD} = (3\\lambda+15)\\hat{i} + 24\\hat{j} - 24\\hat{k} \\\\ \\sqrt{(3\\lambda+15)^2 + 576 + 576} = 36 \\\\ \\lambda^2 + 10\\lambda + 9 = 0 \\\\ \\lambda = -1, -9 \\\\ |\\lambda| \\leq 5 \\Rightarrow \\lambda = -1 \\\\ 5 - 6\\lambda = 5 - 6(-1) = 11 \\end{gathered}$
23. (next question)
"""

You MUST extract ALL content from "22. (11.00)" until "23." - include EVERY equation and calculation:
{
  "question_label": "22",
  "answer_key": "11.00",
  "visual_path": "https://cdn.mathpix.com/cropped/xxx.jpg",
  "worked_solution": "$A(2,6,2) B(-4,0,\\lambda), C(2,3,-1) D(4,5,0)$\\n$\\begin{gathered} \\text{Area} = \\frac{1}{2}|\\overrightarrow{BD} \\times \\overrightarrow{AC}| = 18 \\\\ \\overrightarrow{AC} \\times \\overrightarrow{BD} = |\\begin{array}{ccc} \\hat{i} & \\hat{j} & \\hat{k} \\\\ 0 & -3 & -3 \\\\ 8 & 5 & -\\lambda \\end{array}| \\end{gathered}$\\n$\\begin{gathered} \\overrightarrow{AC} \\times \\overrightarrow{BD} = (3\\lambda+15)\\hat{i} + 24\\hat{j} - 24\\hat{k} \\\\ \\sqrt{(3\\lambda+15)^2 + 576 + 576} = 36 \\\\ \\lambda^2 + 10\\lambda + 9 = 0 \\\\ \\lambda = -1, -9 \\\\ |\\lambda| \\leq 5 \\Rightarrow \\lambda = -1 \\\\ 5 - 6\\lambda = 5 - 6(-1) = 11 \\end{gathered}$",
  "explanation": ""
}

MANDATORY RULE 1 - SOLUTION SEPARATION (MOST IMPORTANT):
- Create ONE JSON object per solution - NEVER combine multiple solutions into one object
- Solution N ENDS when you see "N+1. (X)" pattern (where X is an answer like A, B, C, D, or a number)
- Example: Solution 7's worked_solution ENDS when you see "8. (D)" - do NOT include "8. (D)" or anything after
- Example: Solution 22's worked_solution ENDS when you see "23. (514.00)"
- If your worked_solution for question 7 contains "\\section*{8." or "8. (D)", you made an ERROR
- Each worked_solution must contain ONLY that question's content, NOTHING from subsequent questions
- The document has 30 solutions - you must create exactly 30 separate JSON objects

MANDATORY RULE 2 - COMPLETE CONTENT WITHIN BOUNDARIES:
- EXTRACT image URL from ![](url) into visual_path field, then extract ALL content after it
- Within a solution's boundaries, include EVERYTHING until the next question number
- Do NOT stop at:
  - Image references ![](...)
  - Multiple $\\begin{gathered}...\\end{gathered}$ blocks - include ALL of them
  - Multiple $\\begin{aligned}...\\end{aligned}$ blocks - include ALL of them
  - Blank lines
  - Any math-only lines
  - Transitional phrases like "Equation will become", "Therefore", "Hence"
  - Lines with only inline math like $x^2 - y^2 = 10xy$
- When you see phrases like "Equation will become" or "Therefore", ALL equations that follow MUST be included
- Keep extracting until you see the NEXT question number pattern "^\\d+\\." at line start
- Include determinants, matrices, vectors - preserve ALL LaTeX exactly
- For numerical answers like (11.00), extract "11.00" as the answer_key
- Join multiple lines/blocks with \\n in the worked_solution
- NEVER truncate - include EVERY line until the next question number

CRITICAL - NO PLACEHOLDERS OR ABBREVIATIONS:
- NEVER use "..." or ellipsis as a placeholder for actual content
- NEVER abbreviate formulas - include the COMPLETE expression
- NEVER write \\sqrt{...} - write the ACTUAL content like \\sqrt{(a_2b_3-a_3b_2)^2+...}
- If the document has actual content, you MUST extract it exactly - do not summarize or abbreviate
- Every mathematical expression must be COMPLETE with all terms, not shortened

CRITICAL - SOLUTIONS WITH IMAGES:
- When a solution has an image ![](url), there is ALWAYS content AFTER the image
- The image is usually a diagram - the actual mathematical working is in the TEXT after it
- You MUST extract ALL text and math that appears AFTER the image line
- Example: If you see "6. (D)\\n![](url)\\n$m = -1/2$\\nWhen two lines..." you must include "$m = -1/2$\\nWhen two lines..." in worked_solution
- An EMPTY worked_solution for a solution with an image is WRONG - there is always content to extract
`,
  'Academic Book': `
CRITICAL: Extract EVERY SINGLE solution as a SEPARATE JSON object. Each solution must be its own entry.

This is an academic textbook solutions section.

CRITICAL - SOLUTION SEPARATION:
- Each question number (1, 2, 3, ...) is a SEPARATE solution
- NEVER combine multiple solutions into one JSON object
- When you see "8. (D)" that is the START of solution 8 and the END of solution 7
- Each worked_solution field contains ONLY the content for THAT specific question

IMPORTANT - HANDLING IMAGES:
- Solutions may contain image references like: ![](https://cdn.mathpix.com/cropped/...)
- EXTRACT the image URL into the "visual_path" field (just the URL, not the markdown)
- CONTINUE extracting all text and math AFTER the image into worked_solution
- Do NOT stop at images - the worked solution continues after them

CRITICAL - PRESERVING LATEX BLOCK ENVIRONMENTS:
- Keep $\\begin{aligned}...\\end{aligned}$ as ONE complete string
- Keep $\\begin{gathered}...\\end{gathered}$ as ONE complete string
- Keep $\\begin{array}...\\end{array}$ intact for matrices/determinants
- Do NOT add spaces between $ and \\begin
- Replace internal newlines within math blocks with spaces or \\\\

SOLUTION FORMAT IN DOCUMENT:
- Question number followed by answer: "12. (B)" or "22. (11.00)"
- May have an image reference: ![](url)
- Then the FULL worked solution with all math and steps
- Solution continues until the next question number appears

EXAMPLE WITH IMAGE:
"""
22. (11.00)
![](https://cdn.mathpix.com/cropped/xxx.jpg)
$A(2,6,2) B(-4,0,\\lambda)$
Area $= \\frac{1}{2}|\\overrightarrow{BD} \\times \\overrightarrow{AC}| = 18$
$\\lambda = -1$
$5 - 6\\lambda = 11$
"""

You must extract:
{
  "question_label": "22",
  "answer_key": "11.00",
  "visual_path": "https://cdn.mathpix.com/cropped/xxx.jpg",
  "worked_solution": "$A(2,6,2) B(-4,0,\\lambda)$\\nArea $= \\frac{1}{2}|\\overrightarrow{BD} \\times \\overrightarrow{AC}| = 18$\\n$\\lambda = -1$\\n$5 - 6\\lambda = 11$",
  "explanation": ""
}

For EACH solution, extract:
1. question_label: The question number
2. answer_key: The answer - letter (B, C, D) OR number (11.00) - just the value
3. visual_path: If there's an image ![](url), extract JUST the URL. Empty string if no image.
4. worked_solution: ALL content after answer key, including ALL math and text (skip image markdown)
5. explanation: Any additional explanation (can be empty)

Return in JSON format:
{
  "solutions": [...]
}

MANDATORY RULES:
- EXTRACT image URL from ![](url) into visual_path field, then CONTINUE extracting ALL content after it
- A solution includes EVERYTHING from the answer key until the NEXT question number appears
- The NEXT question number looks like: "6.", "7.", "23.", etc. at the START of a line
- Do NOT stop at:
  - Image references ![](...)
  - Multiple $\\begin{gathered}...\\end{gathered}$ blocks - include ALL of them
  - Multiple $\\begin{aligned}...\\end{aligned}$ blocks - include ALL of them
  - Blank lines or math-only lines
  - Transitional phrases like "Equation will become", "Therefore", "Hence", "So", "Thus", "We get"
  - Lines with only inline math like $x^2 - y^2 = 10xy$
- When you see phrases like "Equation will become" or "Therefore", ALL equations that follow MUST be included
- Multiple math blocks in one solution are COMMON - extract ALL of them
- Keep extracting until you see the pattern "^\\d+\\." (next question number at line start)
- Include determinants, matrices, vectors - preserve ALL LaTeX exactly
- Join multiple lines/blocks with \\n in the worked_solution
- NEVER truncate a solution - include EVERY line until the next question number

CRITICAL - NO PLACEHOLDERS OR ABBREVIATIONS:
- NEVER use "..." or ellipsis as a placeholder for actual content
- NEVER abbreviate formulas - include the COMPLETE expression
- If the document has actual content, you MUST extract it exactly - do not summarize or abbreviate
- Every mathematical expression must be COMPLETE with all terms

CRITICAL - SOLUTIONS WITH IMAGES:
- When a solution has an image ![](url), there is ALWAYS content AFTER the image
- The image is usually a diagram - the actual mathematical working is in the TEXT after it
- You MUST extract ALL text and math that appears AFTER the image line
- An EMPTY worked_solution for a solution with an image is WRONG - there is always content to extract
`,
};

// Helper to get parsing instructions for a type
const getParsingInstructions = (type) => {
  return SOLUTION_PARSING_INSTRUCTIONS[type] || SOLUTION_PARSING_INSTRUCTIONS['Question Bank'];
};

export const solutionExtractionService = {
  /**
   * Create a solution set from selected scanned items
   * @param {string[]} itemIds - Array of scanned item IDs (in selection order)
   * @param {object} options - Optional name, type, metadata, and question_set_id
   * @returns {Promise<object>} - Created solution set record
   */
  async createSolutionSet(itemIds, options = {}) {
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
      .from('solution_sets')
      .insert({
        name: options.name || `Solution Set ${new Date().toISOString()}`,
        book_id: firstItem.book_id,
        chapter_id: firstItem.chapter_id,
        source_item_ids: itemIds,
        question_set_id: options.question_set_id || null,
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
   * Extract solutions from a solution set
   * @param {string} solutionSetId - ID of the solution set
   * @param {string} provider - Extraction provider ('llamaparse' or 'gemini')
   * @returns {Promise<object>} - Updated solution set with extracted solutions
   */
  async extractSolutions(solutionSetId, provider = SOLUTION_EXTRACTION_PROVIDERS.LLAMAPARSE) {
    try {
      // Update status to processing
      await this.updateStatus(solutionSetId, 'processing');

      // Get solution set
      const solutionSet = await this.findById(solutionSetId);
      if (!solutionSet) {
        throw new Error('Solution set not found');
      }

      // Combine latex content from source items
      const combinedContent = await this.combineLatexContent(solutionSet.source_item_ids);
      console.log(`[SOLUTION_EXTRACT] Combined LaTeX content size: ${Math.round(combinedContent.length / 1024)}KB`);

      // Get source type for instructions
      const sourceType = solutionSet.source_type || 'Question Bank';
      let rawResult;

      if (provider === SOLUTION_EXTRACTION_PROVIDERS.GEMINI) {
        // Use Gemini for extraction
        console.log(`[SOLUTION_EXTRACT] Using Gemini AI for extraction`);
        rawResult = await this.extractWithGemini(combinedContent, sourceType);
        console.log(`[SOLUTION_EXTRACT] Gemini raw result size: ${Math.round(rawResult.length / 1024)}KB`);
      } else {
        // Use LlamaParse for extraction (default)
        console.log(`[SOLUTION_EXTRACT] Using LlamaParse for extraction`);
        const jobId = await this.submitToLlamaParse(combinedContent, sourceType);

        // Store the job ID
        await supabase
          .from('solution_sets')
          .update({ llamaparse_job_id: jobId })
          .eq('id', solutionSetId);

        // Poll for completion
        rawResult = await this.pollForCompletion(jobId);
        console.log(`[SOLUTION_EXTRACT] LlamaParse raw result size: ${Math.round(rawResult.length / 1024)}KB`);
      }

      console.log(`[SOLUTION_EXTRACT] Raw result preview (first 500 chars): ${rawResult.substring(0, 500)}`);

      // Parse the result into solution format
      const parsedSolutions = this.parseSolutionsFromContent(rawResult);
      console.log(`[SOLUTION_EXTRACT] Parsed solutions count: ${parsedSolutions.solutions?.length || 0}`);

      // Extract visual paths (image URLs) from original LaTeX content - ONLY extracts URLs, does not modify content
      const visualPathSolutions = this.extractVisualPaths(parsedSolutions, combinedContent);
      console.log(`[SOLUTION_EXTRACT] After visual path extraction, solutions count: ${visualPathSolutions.solutions?.length || 0}`);

      // Format LaTeX blocks for ALL solutions (ensures proper rendering)
      const solutions = this.formatAllSolutionsLatex(visualPathSolutions);
      const solutionsJson = JSON.stringify(solutions);
      console.log(`[SOLUTION_EXTRACT] After LaTeX formatting, solutions count: ${solutions.solutions?.length || 0}`);
      console.log(`[SOLUTION_EXTRACT] Solutions JSON size: ${Math.round(solutionsJson.length / 1024)}KB`);

      // Update solution set with results
      const { data, error } = await supabase
        .from('solution_sets')
        .update({
          solutions: solutions,
          total_solutions: solutions.solutions?.length || 0,
          status: 'completed',
          error_message: null,
        })
        .eq('id', solutionSetId)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        console.log(`[SOLUTION_EXTRACT] Solution Set ID: ${data.id}`);
        console.log(`[SOLUTION_EXTRACT] Saved to DB. Returned solutions count: ${data.solutions?.solutions?.length || 0}`);
        console.log(`[SOLUTION_EXTRACT] total_solutions field: ${data.total_solutions}`);
      }

      // Verify by re-fetching
      const { data: verifyData } = await supabase
        .from('solution_sets')
        .select('id, solutions, total_solutions')
        .eq('id', solutionSetId)
        .single();

      if (verifyData) {
        console.log(`[SOLUTION_EXTRACT] VERIFY - Re-fetched solutions count: ${verifyData.solutions?.solutions?.length || 0}`);
      }

      return data;
    } catch (error) {
      console.error('Solution extraction error:', error);
      await this.updateStatus(solutionSetId, 'failed', error.message);
      throw error;
    }
  },

  /**
   * Combine latex documents from scanned items (preserving order)
   * @param {string[]} itemIds - Array of scanned item IDs (in order)
   * @returns {Promise<string>} - Combined LaTeX content
   */
  async combineLatexContent(itemIds) {
    // Fetch items
    const { data: items, error } = await supabase
      .from('scanned_items')
      .select('id, latex_doc, latex_conversion_status')
      .in('id', itemIds);

    if (error) throw error;

    console.log(`[SOLUTION_EXTRACT] Source items: ${items.length} items for ${itemIds.length} IDs`);

    // Create a map for quick lookup
    const itemMap = new Map(items.map((item) => [item.id, item.latex_doc]));

    // Combine in the order of itemIds
    const combinedParts = itemIds.map((id, index) => {
      const latex = itemMap.get(id) || '';
      console.log(`[SOLUTION_EXTRACT] Item ${index + 1} (${id}): ${latex ? Math.round(latex.length / 1024) + 'KB' : 'EMPTY/NULL'}`);
      return `% ========== Document ${index + 1} ==========\n\n${latex}`;
    });

    return combinedParts.join('\n\n');
  },

  /**
   * Submit content to LlamaParse for solution extraction
   * @param {string} content - Combined LaTeX/text content
   * @param {string} sourceType - Source type ('Question Bank' or 'Academic Book')
   * @returns {Promise<string>} - Job ID from LlamaParse
   */
  async submitToLlamaParse(content, sourceType = 'Question Bank') {
    // Create a text file blob from the combined content
    const blob = new Blob([content], { type: 'text/plain' });

    // Get parsing instructions based on source type
    const parsingInstructions = getParsingInstructions(sourceType);
    console.log(`[SOLUTION_EXTRACT] Using parsing instructions for type: ${sourceType}`);

    const formData = new FormData();
    formData.append('file', blob, 'solutions.txt');
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
   * Extract solutions using Gemini AI
   * @param {string} content - Combined LaTeX/text content
   * @param {string} sourceType - Source type ('Question Bank' or 'Academic Book')
   * @returns {Promise<string>} - Extracted content with solutions in JSON format
   */
  async extractWithGemini(content, sourceType = 'Question Bank') {
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured. Please set GOOGLE_API_KEY in environment variables.');
    }

    const parsingInstructions = getParsingInstructions(sourceType);

    // Split content into chunks if too large (Gemini has context limits)
    const MAX_CONTENT_LENGTH = 900000; // ~900KB to stay within limits
    let chunks = [];

    if (content.length > MAX_CONTENT_LENGTH) {
      console.log(`[SOLUTION_EXTRACT] Content too large (${Math.round(content.length / 1024)}KB), splitting into chunks`);

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

      console.log(`[SOLUTION_EXTRACT] Split into ${chunks.length} chunks`);
    } else {
      chunks = [content];
    }

    // Process each chunk and merge results
    const allSolutions = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[SOLUTION_EXTRACT] Processing chunk ${i + 1}/${chunks.length} (${Math.round(chunk.length / 1024)}KB)`);

      const chunkPrompt = `${parsingInstructions}

DOCUMENT CONTENT (Part ${i + 1} of ${chunks.length}):
${chunk}

IMPORTANT: Return ONLY the JSON object with the "solutions" array. Do not include any markdown code blocks or additional text. The response should start with { and end with }.`;

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
        console.error(`[SOLUTION_EXTRACT] Gemini API error: ${response.status} - ${errorText}`);
        throw new Error(`Gemini API request failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      // Extract text from Gemini response
      const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!generatedText) {
        console.error(`[SOLUTION_EXTRACT] Gemini response structure:`, JSON.stringify(result, null, 2));
        throw new Error('No text generated from Gemini');
      }

      console.log(`[SOLUTION_EXTRACT] Gemini chunk ${i + 1} response length: ${generatedText.length}`);

      // Try to parse solutions from this chunk
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
        if (parsed.solutions && Array.isArray(parsed.solutions)) {
          allSolutions.push(...parsed.solutions);
          console.log(`[SOLUTION_EXTRACT] Extracted ${parsed.solutions.length} solutions from chunk ${i + 1}`);
        }
      } catch (parseErr) {
        console.error(`[SOLUTION_EXTRACT] Failed to parse Gemini chunk ${i + 1} response: ${parseErr.message}`);
        // Continue with raw text - the main parser will try to extract solutions
      }
    }

    // If we successfully extracted solutions from chunks, return them as JSON
    if (allSolutions.length > 0) {
      console.log(`[SOLUTION_EXTRACT] Total solutions extracted via Gemini: ${allSolutions.length}`);
      return JSON.stringify({ solutions: allSolutions });
    }

    // If chunk parsing failed, return the last result for main parser to handle
    const lastChunkPrompt = `${parsingInstructions}

DOCUMENT CONTENT:
${chunks[chunks.length - 1]}

IMPORTANT: Return ONLY the JSON object with the "solutions" array. Do not include any markdown code blocks or additional text.`;

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
      console.log(`[SOLUTION_EXTRACT] Fixed ${fixCount} invalid escape sequences in JSON`);
    }

    return result;
  },

  /**
   * Parse extracted content into solution JSON format
   * @param {string} rawContent - Raw extracted content from LlamaParse
   * @returns {object} - Structured solutions object
   */
  parseSolutionsFromContent(rawContent) {
    try {
      console.log(`[SOLUTION_EXTRACT] Starting to parse raw content of length: ${rawContent.length}`);

      // Find ALL JSON objects with "solutions" arrays and merge them
      const allSolutions = [];
      let searchStart = 0;
      let jsonBlockCount = 0;

      while (true) {
        // Find next JSON object with solutions - try multiple patterns
        let jsonStart = -1;

        // Pattern 1: {"solutions"
        const pattern1 = rawContent.indexOf('{"solutions"', searchStart);

        // Pattern 2: { "solutions" (with space)
        const pattern2 = rawContent.indexOf('{ "solutions"', searchStart);

        // Pattern 3: Regex for various whitespace
        const remainingContent = rawContent.substring(searchStart);
        const regexMatch = remainingContent.match(/\{\s*"solutions"\s*:\s*\[/);
        const pattern3 = regexMatch ? searchStart + remainingContent.indexOf(regexMatch[0]) : -1;

        // Take the earliest valid match
        const validPatterns = [pattern1, pattern2, pattern3].filter(p => p !== -1);
        if (validPatterns.length > 0) {
          jsonStart = Math.min(...validPatterns);
        }

        if (jsonStart === -1) {
          console.log(`[SOLUTION_EXTRACT] No more JSON blocks found after position ${searchStart}`);
          break;
        }

        console.log(`[SOLUTION_EXTRACT] Found potential JSON block at position ${jsonStart}`);

        // Find matching closing brace (handling strings properly)
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
          console.log(`[SOLUTION_EXTRACT] Attempting to parse JSON block ${++jsonBlockCount}, length: ${jsonStr.length}`);

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.solutions && Array.isArray(parsed.solutions)) {
              console.log(`[SOLUTION_EXTRACT] Successfully parsed JSON block ${jsonBlockCount} with ${parsed.solutions.length} solutions`);
              allSolutions.push(...parsed.solutions);
            } else {
              console.log(`[SOLUTION_EXTRACT] JSON block ${jsonBlockCount} does not have valid solutions array`);
            }
          } catch (parseErr) {
            console.error(`[SOLUTION_EXTRACT] Failed to parse JSON block ${jsonBlockCount}: ${parseErr.message}`);
            console.log(`[SOLUTION_EXTRACT] Attempting to fix invalid escape sequences and retry...`);

            try {
              // Fix invalid escape sequences (LlamaParse bug workaround)
              const fixedJsonStr = this.fixInvalidEscapeSequences(jsonStr);
              const parsed = JSON.parse(fixedJsonStr);

              if (parsed.solutions && Array.isArray(parsed.solutions)) {
                console.log(`[SOLUTION_EXTRACT] ✅ Successfully parsed JSON block ${jsonBlockCount} after fixing escape sequences (${parsed.solutions.length} solutions)`);
                allSolutions.push(...parsed.solutions);
              } else {
                console.log(`[SOLUTION_EXTRACT] JSON block ${jsonBlockCount} does not have valid solutions array after fix`);
              }
            } catch (retryErr) {
              console.error(`[SOLUTION_EXTRACT] Failed to parse JSON block ${jsonBlockCount} even after fixing escape sequences: ${retryErr.message}`);
              console.log(`[SOLUTION_EXTRACT] JSON block preview: ${jsonStr.substring(0, 200)}...`);
            }
          }
          searchStart = jsonEnd;
        } else {
          console.log(`[SOLUTION_EXTRACT] Could not find closing brace for JSON block starting at ${jsonStart}`);
          searchStart = jsonStart + 1;
        }
      }

      if (allSolutions.length > 0) {
        // Deduplicate solutions by question_label
        const uniqueSolutions = [];
        const seenLabels = new Set();

        for (const s of allSolutions) {
          const label = s.question_label || '';
          if (!seenLabels.has(label)) {
            seenLabels.add(label);
            uniqueSolutions.push(s);
          } else {
            console.log(`[SOLUTION_EXTRACT] Skipping duplicate solution with label: ${label}`);
          }
        }

        console.log(`[SOLUTION_EXTRACT] Total merged solutions: ${allSolutions.length}, unique: ${uniqueSolutions.length}`);
        return { solutions: uniqueSolutions };
      }

      console.log(`[SOLUTION_EXTRACT] No JSON blocks found, attempting text parsing`);

      // If no JSON found, try to parse from structured text
      const solutions = [];

      // Try to find answer key patterns - handle both uppercase A,B,C,D and lowercase (a),(b),(c),(d)
      const answerKeyPatterns = [
        // Uppercase patterns: "1. C" or "1) A" or "Q1: B"
        /(?:^|\n)\s*(?:Q(?:uestion)?\.?\s*)?(\d+[a-z]?)[\.\)\:\s]+([A-Ea-e])\s*(?:\n|$)/gi,
        // Parentheses format: "(1) C" or "1. (a)"
        /(?:^|\n)\s*\(?(\d+[a-z]?)\)?\s*[\.\:\s]*\(?([A-Ea-e])\)?\s*(?:\n|$)/gi,
        // Answer format: "1. Ans: C" or "1) Answer: (a)"
        /(?:^|\n)\s*(\d+[a-z]?)[\.\)]\s*(?:Ans(?:wer)?\.?[\:\s]*)\(?([A-Ea-e])\)?\s*(?:\n|$)/gi,
      ];

      for (const regex of answerKeyPatterns) {
        let match;
        while ((match = regex.exec(rawContent)) !== null) {
          const questionLabel = match[1].trim();
          const answerKey = match[2].trim();

          // Check if we already have this question label
          const existing = solutions.find(s => s.question_label === questionLabel);
          if (existing) {
            existing.answer_key = answerKey;
          } else {
            solutions.push({
              question_label: questionLabel,
              answer_key: answerKey,
              worked_solution: '',
              explanation: '',
            });
          }
        }
      }

      // Try to find worked solution patterns
      const solutionPatterns = [
        /(?:^|\n)\s*(?:Solution|Answer|Sol\.?)\s*(?:for\s+)?(?:Q(?:uestion)?\.?\s*)?(\d+[a-z]?)[\.\)\:\s]*([\s\S]*?)(?=\n\s*(?:Solution|Answer|Sol\.?)\s*(?:for\s+)?(?:Q(?:uestion)?\.?\s*)?\d+|\n\s*$|$)/gi,
        /(?:^|\n)\s*(\d+[a-z]?)[\.\)]\s*([\s\S]*?)(?=\n\s*\d+[a-z]?[\.\)]|\n\s*$|$)/gi,
      ];

      for (const regex of solutionPatterns) {
        let match;
        while ((match = regex.exec(rawContent)) !== null) {
          const questionLabel = match[1].trim();
          const workedSolution = match[2].trim();

          if (workedSolution.length > 10) { // Only add if there's substantial content
            // Check if we already have this question label
            const existing = solutions.find(s => s.question_label === questionLabel);
            if (existing) {
              existing.worked_solution = workedSolution;
            } else {
              solutions.push({
                question_label: questionLabel,
                answer_key: '',
                worked_solution: workedSolution,
                explanation: '',
              });
            }
          }
        }

        if (solutions.length > 0) break;
      }

      console.log(`[SOLUTION_EXTRACT] Parsed ${solutions.length} solutions using text fallback`);
      return { solutions };
    } catch (error) {
      console.error('Error parsing solutions:', error);
      // Return raw content wrapped in a structure
      return {
        solutions: [],
        raw_content: rawContent,
        parse_error: error.message,
      };
    }
  },

  /**
   * Fix truncated solutions by detecting incomplete extractions and
   * extracting missing content from raw output
   * @param {object} solutions - Parsed solutions object
   * @param {string} rawContent - Raw content from LlamaParse
   * @returns {object} - Solutions with truncated ones fixed
   */
  fixTruncatedSolutions(solutions, rawContent) {
    // Transitional phrases that indicate more content should follow
    const truncationIndicators = [
      'Equation will become',
      'equation will become',
      'Therefore',
      'Hence',
      'So we get',
      'We get',
      'becomes',
      'gives us',
      'which gives'
    ];

    if (!solutions.solutions || !Array.isArray(solutions.solutions)) {
      return solutions;
    }

    for (const solution of solutions.solutions) {
      const workedSolution = solution.worked_solution || '';

      // Check if solution ends with a truncation indicator
      const endsWithIndicator = truncationIndicators.some(indicator =>
        workedSolution.trim().endsWith(indicator)
      );

      // Also check if solution appears truncated by comparing with raw content
      // This helps catch cases where LlamaParse stopped mid-solution
      let needsMoreContent = endsWithIndicator;

      if (!needsMoreContent && workedSolution.length > 50) {
        // Check if raw content has significantly more content for this solution
        const rawSolutionContent = this.extractSolutionFromRaw(solution.question_label, rawContent);
        if (rawSolutionContent && rawSolutionContent.length > workedSolution.length + 200) {
          needsMoreContent = true;
          console.log(`[SOLUTION_EXTRACT] Question ${solution.question_label}: raw has ${rawSolutionContent.length} chars vs current ${workedSolution.length} chars`);
        }
      }

      if (needsMoreContent) {
        console.log(`[SOLUTION_EXTRACT] Detected truncated solution for question ${solution.question_label}`);

        // Get full solution content from raw
        const fullRawContent = this.extractSolutionFromRaw(solution.question_label, rawContent);

        if (fullRawContent && fullRawContent.length > workedSolution.length) {
          console.log(`[SOLUTION_EXTRACT] Replacing truncated solution for question ${solution.question_label} (${workedSolution.length} -> ${fullRawContent.length} chars)`);
          solution.worked_solution = fullRawContent;
        } else {
          // Fallback to appending remaining content
          const additionalContent = this.extractRemainingContent(
            solution.question_label,
            workedSolution,
            rawContent
          );

          if (additionalContent) {
            console.log(`[SOLUTION_EXTRACT] Found additional content for question ${solution.question_label}: ${additionalContent.substring(0, 100)}...`);
            solution.worked_solution = workedSolution + '\n' + additionalContent;
          } else {
            console.log(`[SOLUTION_EXTRACT] Could not find additional content for question ${solution.question_label}`);
          }
        }
      }
    }

    return solutions;
  },

  /**
   * Extract full solution content from raw content for a given question
   * @param {string} questionLabel - The question number/label
   * @param {string} rawContent - Raw content
   * @returns {string|null} - Full solution content or null
   */
  extractSolutionFromRaw(questionLabel, rawContent) {
    const currentQuestionNum = parseInt(questionLabel);
    const nextQuestionNum = currentQuestionNum + 1;

    // Find where this solution starts
    const solutionStartPattern = new RegExp(
      `(?:^|\\n)\\s*${questionLabel}[\\s\\.\\)]+\\(?[A-Da-d0-9\\.]+\\)?`,
      'i'
    );

    const startMatch = rawContent.match(solutionStartPattern);
    if (!startMatch) return null;

    const startIndex = startMatch.index + startMatch[0].length;

    // Find where next sequential question starts
    const nextQuestionPattern = new RegExp(
      `\\n\\s*${nextQuestionNum}\\s*[\\.\\)]\\s*\\(?[A-Da-d0-9\\.]+\\)?`,
      'i'
    );

    let endIndex = rawContent.length;
    const nextMatch = rawContent.substring(startIndex).match(nextQuestionPattern);
    if (nextMatch) {
      endIndex = startIndex + nextMatch.index;
    }

    // Extract and clean content
    const solutionContent = rawContent.substring(startIndex, endIndex).trim();

    // Remove image markdown lines but keep the rest
    const cleanedContent = solutionContent
      .split('\n')
      .filter(line => !line.trim().startsWith('!['))
      .join('\n')
      .trim();

    return cleanedContent || null;
  },

  /**
   * Extract remaining content for a solution from raw content
   * @param {string} questionLabel - The question number/label
   * @param {string} currentContent - Current worked solution content
   * @param {string} rawContent - Raw content from LlamaParse
   * @returns {string|null} - Additional content found, or null
   */
  extractRemainingContent(questionLabel, currentContent, rawContent) {
    // Find where this solution starts in rawContent
    // Pattern matches: "8. (D)" or "8." followed by answer
    const solutionStartPattern = new RegExp(
      `${questionLabel}[\\s\\.\\)]+\\(?[A-Da-d0-9\\.]+\\)?`,
      'i'
    );

    const match = rawContent.match(solutionStartPattern);
    if (!match) {
      console.log(`[SOLUTION_EXTRACT] Could not find solution start for question ${questionLabel}`);
      return null;
    }

    const startIndex = match.index + match[0].length;

    // Find where next question starts
    const nextQuestionPattern = /\n\s*(\d+)\s*[\.\)]/g;
    nextQuestionPattern.lastIndex = startIndex;

    let endIndex = rawContent.length;
    let nextMatch;
    while ((nextMatch = nextQuestionPattern.exec(rawContent)) !== null) {
      if (parseInt(nextMatch[1]) > parseInt(questionLabel)) {
        endIndex = nextMatch.index;
        break;
      }
    }

    // Extract full solution text from raw content
    const fullSolutionText = rawContent.substring(startIndex, endIndex);

    // Find content after the last part of currentContent
    const lastPart = currentContent.slice(-50).trim();
    const lastPartIndex = fullSolutionText.indexOf(lastPart);

    if (lastPartIndex !== -1) {
      const remaining = fullSolutionText.substring(lastPartIndex + lastPart.length).trim();

      // Extract any math content (lines starting with $ or containing equations)
      const mathLines = remaining.split('\n')
        .filter(line => line.trim())
        .filter(line =>
          line.includes('$') ||
          line.includes('\\frac') ||
          line.includes('=')
        );

      if (mathLines.length > 0) {
        return mathLines.join('\n');
      }
    }

    return null;
  },

  /**
   * Extract visual paths (image URLs) from original content
   * ONLY extracts image URLs - does NOT modify worked_solution (trust LlamaParse instructions)
   * @param {object} solutions - Parsed solutions object
   * @param {string} rawContent - Original combined LaTeX content
   * @returns {object} - Solutions with visual_path populated
   */
  extractVisualPaths(solutions, rawContent) {
    if (!solutions.solutions || !Array.isArray(solutions.solutions)) {
      return solutions;
    }

    for (const solution of solutions.solutions) {
      const questionLabel = solution.question_label;
      if (!questionLabel) continue;

      // Skip if visual_path already set by LlamaParse
      if (solution.visual_path) continue;

      const currentQuestionNum = parseInt(questionLabel);
      const nextQuestionNum = currentQuestionNum + 1;

      // Find where this solution starts in rawContent
      const solutionStartPattern = new RegExp(
        `(?:^|\\n)\\s*${questionLabel}[\\s\\.\\)]+\\(?[A-Da-d0-9\\.]+\\)?`,
        'i'
      );

      const startMatch = rawContent.match(solutionStartPattern);
      if (!startMatch) continue;

      const startIndex = startMatch.index;

      // Find where next question starts
      const nextQuestionPattern = new RegExp(
        `\\n\\s*${nextQuestionNum}\\s*[\\.\\)]\\s*\\(?[A-Da-d0-9\\.]+\\)?`,
        'i'
      );

      let endIndex = rawContent.length;
      const nextMatch = rawContent.substring(startIndex + startMatch[0].length).match(nextQuestionPattern);
      if (nextMatch) {
        endIndex = startIndex + startMatch[0].length + nextMatch.index;
      }

      // Extract section for this solution
      const solutionSection = rawContent.substring(startIndex, endIndex);

      // Find image in this section - ONLY extract URL
      const imageMatch = solutionSection.match(/!\[[^\]]*\]\(([^)]+)\)/);

      if (imageMatch && imageMatch[1]) {
        solution.visual_path = imageMatch[1];
        console.log(`[SOLUTION_EXTRACT] Found visual_path for question ${questionLabel}: ${imageMatch[1].substring(0, 60)}...`);
      }
    }

    return solutions;
  },

  /**
   * Clean up solutions that have content from subsequent solutions merged in
   * LlamaParse sometimes fails to separate solutions properly
   * @param {object} solutions - Solutions object
   * @returns {object} - Cleaned solutions
   */
  cleanMergedSolutions(solutions) {
    if (!solutions.solutions || !Array.isArray(solutions.solutions)) {
      return solutions;
    }

    for (const solution of solutions.solutions) {
      const questionNum = parseInt(solution.question_label);
      const workedSolution = solution.worked_solution || '';

      if (!workedSolution || workedSolution.length < 500) {
        continue; // Skip short solutions - unlikely to have merged content
      }

      // Look for patterns that indicate another solution is embedded
      // Patterns: "8. (D)", "\section*{8. (D)}", "8. (D)\n", etc.
      const nextNum = questionNum + 1;

      // Look for section headers of ANY higher question number
      // Pattern: \section*{N. (X)} where N > current question number
      const sectionPattern = /\\section\*?\{\s*(\d+)\.\s*\([A-Da-d0-9\.]+\)\s*\}/gi;

      let truncateIndex = -1;
      let match;
      while ((match = sectionPattern.exec(workedSolution)) !== null) {
        const foundNum = parseInt(match[1]);
        if (foundNum > questionNum) {
          truncateIndex = match.index;
          console.log(`[SOLUTION_EXTRACT] Found merged content in Q${questionNum} - Q${foundNum} header at position ${truncateIndex}`);
          break;
        }
      }

      // Also check for newline + "N. (X)" pattern for higher question numbers
      if (truncateIndex === -1) {
        const linePattern = /\n\s*(\d+)\.\s*\([A-Da-d0-9\.]+\)\s*\n/gi;
        while ((match = linePattern.exec(workedSolution)) !== null) {
          const foundNum = parseInt(match[1]);
          if (foundNum > questionNum) {
            truncateIndex = match.index;
            console.log(`[SOLUTION_EXTRACT] Found merged content in Q${questionNum} - Q${foundNum} line header at position ${truncateIndex}`);
            break;
          }
        }
      }

      if (truncateIndex > 0) {
        const truncatedContent = workedSolution.substring(0, truncateIndex).trim();
        console.log(`[SOLUTION_EXTRACT] Truncating Q${questionNum} from ${workedSolution.length} to ${truncatedContent.length} chars`);
        solution.worked_solution = truncatedContent;
      }
    }

    return solutions;
  },

  /**
   * Format LaTeX block environments to single lines for proper rendering
   * @param {string} content - Content with potential multi-line LaTeX blocks
   * @returns {string} - Content with LaTeX blocks on single lines
   */
  formatLatexBlocks(content) {
    // Match $\begin{env}...\end{env}$ blocks (gathered, aligned, array, etc.)
    const blockPattern = /\$\\begin\{(\w+)\}([\s\S]*?)\\end\{\1\}\$/g;

    return content.replace(blockPattern, (match, envName, innerContent) => {
      // Join lines with space, preserving \\ for LaTeX line breaks
      const formatted = innerContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join(' ');

      return `$\\begin{${envName}} ${formatted} \\end{${envName}}$`;
    });
  },

  /**
   * Format LaTeX blocks for all solutions in the set
   * Applies formatLatexBlocks to each solution's worked_solution
   * @param {object} solutions - Solutions object with solutions array
   * @returns {object} - Solutions with formatted LaTeX blocks
   */
  formatAllSolutionsLatex(solutions) {
    if (!solutions.solutions || !Array.isArray(solutions.solutions)) {
      return solutions;
    }

    for (const solution of solutions.solutions) {
      if (solution.worked_solution) {
        solution.worked_solution = this.formatLatexBlocks(solution.worked_solution);
      }
    }

    return solutions;
  },

  /**
   * Link a solution set to a question set
   * @param {string} solutionSetId - ID of the solution set
   * @param {string} questionSetId - ID of the question set to link
   * @returns {Promise<object>} - Updated solution set
   */
  async linkToQuestionSet(solutionSetId, questionSetId) {
    const { data, error } = await supabase
      .from('solution_sets')
      .update({ question_set_id: questionSetId })
      .eq('id', solutionSetId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Update solution set status
   */
  async updateStatus(solutionSetId, status, errorMessage = null) {
    const updateData = { status };
    if (errorMessage) {
      updateData.error_message = errorMessage;
    }

    const { error } = await supabase
      .from('solution_sets')
      .update(updateData)
      .eq('id', solutionSetId);

    if (error) console.error('Failed to update status:', error);
  },

  /**
   * Get solution set by ID
   */
  async findById(solutionSetId) {
    const { data, error } = await supabase
      .from('solution_sets')
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number),
        question_set:question_sets(id, name, total_questions)
      `)
      .eq('id', solutionSetId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  /**
   * Get all solution sets with optional filters
   */
  async getAll(filters = {}) {
    let query = supabase
      .from('solution_sets')
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number),
        question_set:question_sets(id, name, total_questions)
      `)
      .order('created_at', { ascending: false });

    if (filters.bookId) {
      query = query.eq('book_id', filters.bookId);
    }
    if (filters.chapterId) {
      query = query.eq('chapter_id', filters.chapterId);
    }
    if (filters.questionSetId) {
      query = query.eq('question_set_id', filters.questionSetId);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data;
  },

  /**
   * Delete a solution set
   */
  async delete(solutionSetId) {
    const { error } = await supabase
      .from('solution_sets')
      .delete()
      .eq('id', solutionSetId);

    if (error) throw error;
    return true;
  },

  /**
   * Create a solution set from manually provided JSON
   * @param {object} options - Options for creating the solution set
   * @param {string} options.name - Name of the solution set
   * @param {string} options.bookId - Book ID (optional)
   * @param {string} options.chapterId - Chapter ID (optional)
   * @param {string} options.questionSetId - Question set ID to link (optional)
   * @param {object} options.solutions - Solutions JSON object with solutions array
   * @returns {Promise<object>} - Created solution set record
   */
  async createManualSolutionSet(options) {
    const { name, bookId, chapterId, questionSetId, solutions } = options;

    if (!solutions || !solutions.solutions || !Array.isArray(solutions.solutions)) {
      throw new Error('Invalid solutions format. Expected { solutions: [...] }');
    }

    const { data, error } = await supabase
      .from('solution_sets')
      .insert({
        name: name || `Manual Import ${new Date().toISOString()}`,
        book_id: bookId || null,
        chapter_id: chapterId || null,
        question_set_id: questionSetId || null,
        source_item_ids: [],
        source_type: 'Question Bank', // Must use valid type per DB constraint
        status: 'completed',
        solutions: solutions,
        total_solutions: solutions.solutions.length,
        metadata: { source: 'manual_import' },
      })
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number),
        question_set:question_sets(id, name, total_questions)
      `)
      .single();

    if (error) throw error;
    return data;
  },
};

export default solutionExtractionService;
