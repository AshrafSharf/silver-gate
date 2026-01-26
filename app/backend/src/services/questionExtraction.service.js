import { supabase } from '../config/database.js';
import { config } from '../config/index.js';

const LLAMAPARSE_API_URL = config.llamaParse.apiUrl;
const LLAMAPARSE_API_KEY = config.llamaParse.apiKey;

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

// Helper to get parsing instructions for a type
const getParsingInstructions = (type) => {
  return PARSING_INSTRUCTIONS[type] || PARSING_INSTRUCTIONS['Question Bank'];
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
   * @returns {Promise<object>} - Updated question set with extracted questions
   */
  async extractQuestions(questionSetId) {
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

      // Submit to LlamaParse with type-specific instructions
      const sourceType = questionSet.source_type || 'Question Bank';
      const jobId = await this.submitToLlamaParse(combinedContent, sourceType);

      // Store the job ID
      await supabase
        .from('question_sets')
        .update({ llamaparse_job_id: jobId })
        .eq('id', questionSetId);

      // Poll for completion
      const rawResult = await this.pollForCompletion(jobId);
      console.log(`[EXTRACT] LlamaParse raw result size: ${Math.round(rawResult.length / 1024)}KB`);
      console.log(`[EXTRACT] Raw result preview (first 500 chars): ${rawResult.substring(0, 500)}`);

      // Parse the result into MCQ format
      const questions = this.parseQuestionsFromContent(rawResult);
      const questionsJson = JSON.stringify(questions);
      console.log(`[EXTRACT] Parsed questions count: ${questions.questions?.length || 0}`);
      console.log(`[EXTRACT] Questions JSON size: ${Math.round(questionsJson.length / 1024)}KB`);

      // Update question set with results
      const { data, error } = await supabase
        .from('question_sets')
        .update({
          questions: questions,
          total_questions: questions.questions?.length || 0,
          status: 'completed',
          error_message: null,
        })
        .eq('id', questionSetId)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        console.log(`[EXTRACT] Question Set ID: ${data.id}`);
        console.log(`[EXTRACT] Saved to DB. Returned questions count: ${data.questions?.questions?.length || 0}`);
        console.log(`[EXTRACT] total_questions field: ${data.total_questions}`);
      }

      // Verify by re-fetching
      const { data: verifyData } = await supabase
        .from('question_sets')
        .select('id, questions, total_questions')
        .eq('id', questionSetId)
        .single();

      if (verifyData) {
        console.log(`[EXTRACT] VERIFY - Re-fetched questions count: ${verifyData.questions?.questions?.length || 0}`);
      }

      return data;
    } catch (error) {
      console.error('Question extraction error:', error);
      await this.updateStatus(questionSetId, 'failed', error.message);
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

    console.log(`[EXTRACT] Source items: ${items.length} items for ${itemIds.length} IDs`);

    // Create a map for quick lookup
    const itemMap = new Map(items.map((item) => [item.id, item.latex_doc]));

    // Combine in the order of itemIds
    const combinedParts = itemIds.map((id, index) => {
      const latex = itemMap.get(id) || '';
      console.log(`[EXTRACT] Item ${index + 1} (${id}): ${latex ? Math.round(latex.length / 1024) + 'KB' : 'EMPTY/NULL'}`);
      return `% ========== Document ${index + 1} ==========\n\n${latex}`;
    });

    return combinedParts.join('\n\n');
  },

  /**
   * Submit content to LlamaParse for question extraction
   * @param {string} content - Combined LaTeX/text content
   * @param {string} sourceType - Source type ('Question Bank' or 'Academic Book')
   * @returns {Promise<string>} - Job ID from LlamaParse
   */
  async submitToLlamaParse(content, sourceType = 'Question Bank') {
    // Create a text file blob from the combined content
    const blob = new Blob([content], { type: 'text/plain' });

    // Get parsing instructions based on source type
    const parsingInstructions = getParsingInstructions(sourceType);
    console.log(`[EXTRACT] Using parsing instructions for type: ${sourceType}`);

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
            console.log(`[EXTRACT] JSON block preview: ${jsonStr.substring(0, 200)}...`);
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
};

export default questionExtractionService;
