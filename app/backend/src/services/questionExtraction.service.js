import { supabase } from '../config/database.js';
import { config } from '../config/index.js';

const LLAMAPARSE_API_URL = config.llamaParse.apiUrl;
const LLAMAPARSE_API_KEY = config.llamaParse.apiKey;

// Parsing instructions by source type
const PARSING_INSTRUCTIONS = {
  'Question Bank': `
Extract all multiple choice questions (MCQs) from this document.

For each question, identify:
1. The question label/number as it appears in the document (e.g., "1", "2", "Q1", "Question 5", etc.)
2. The question text (including any mathematical notation)
3. All answer choices (labeled A, B, C, D, etc.)

Return the result in the following JSON format:
{
  "questions": [
    {
      "question_label": "1",
      "text": "Question text here with $math$ notation preserved",
      "choices": ["A. choice1", "B. choice2", "C. choice3", "D. choice4"]
    }
  ]
}

Important:
- Preserve the original question label/number exactly as it appears in the document
- Preserve LaTeX math notation ($...$ and $$...$$)
- Include all answer choices for each question
- Maintain the original question numbering if present
- If a question has sub-parts, treat each sub-part as a separate question with appropriate labels (e.g., "1a", "1b")
`,
  'Academic Book': `
Extract all multiple choice questions (MCQs) from this document.

For each question, identify:
1. The question label/number as it appears in the document (e.g., "1", "2", "Q1", "Question 5", etc.)
2. The question text (including any mathematical notation)
3. All answer choices (labeled A, B, C, D, etc.)

Return the result in the following JSON format:
{
  "questions": [
    {
      "question_label": "1",
      "text": "Question text here with $math$ notation preserved",
      "choices": ["A. choice1", "B. choice2", "C. choice3", "D. choice4"]
    }
  ]
}

Important:
- Preserve the original question label/number exactly as it appears in the document
- Preserve LaTeX math notation ($...$ and $$...$$)
- Include all answer choices for each question
- Maintain the original question numbering if present
- If a question has sub-parts, treat each sub-part as a separate question with appropriate labels (e.g., "1a", "1b")
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
      // Find ALL JSON objects with "questions" arrays and merge them
      const allQuestions = [];
      let searchStart = 0;

      while (true) {
        // Find next JSON object with questions
        let jsonStart = rawContent.indexOf('{"questions"', searchStart);

        // Also try with whitespace variations
        if (jsonStart === -1) {
          const match = rawContent.substring(searchStart).match(/\{\s*"questions"\s*:\s*\[/);
          if (match) {
            jsonStart = searchStart + rawContent.substring(searchStart).indexOf(match[0]);
          }
        }

        if (jsonStart === -1) break;

        // Find matching closing brace
        let braceCount = 0;
        let jsonEnd = -1;

        for (let i = jsonStart; i < rawContent.length; i++) {
          if (rawContent[i] === '{') braceCount++;
          if (rawContent[i] === '}') braceCount--;
          if (braceCount === 0) {
            jsonEnd = i + 1;
            break;
          }
        }

        if (jsonEnd !== -1) {
          const jsonStr = rawContent.substring(jsonStart, jsonEnd);
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.questions && Array.isArray(parsed.questions)) {
              console.log(`[EXTRACT] Found JSON block with ${parsed.questions.length} questions`);
              allQuestions.push(...parsed.questions);
            }
          } catch (parseErr) {
            console.error(`[EXTRACT] Failed to parse JSON block: ${parseErr.message}`);
          }
          searchStart = jsonEnd;
        } else {
          break;
        }
      }

      if (allQuestions.length > 0) {
        console.log(`[EXTRACT] Total merged questions: ${allQuestions.length}`);
        return { questions: allQuestions };
      }

      // If no JSON found, try to parse markdown format
      const questions = [];
      const questionRegex = /(?:^|\n)((?:\d+[\.\)]\s*|Q(?:uestion)?[\s\.:]+\d*\s*))(.*?)(?=\n(?:\d+[\.\)]|Q(?:uestion)?[\s\.:]+\d*|\Z))/gis;
      const choiceRegex = /\n\s*([A-E])[\.\)]\s*(.+)/gi;

      let match;
      let questionIndex = 1;
      while ((match = questionRegex.exec(rawContent)) !== null) {
        const questionLabelRaw = match[1] || '';
        const questionBlock = match[0];
        const choices = [];

        let choiceMatch;
        while ((choiceMatch = choiceRegex.exec(questionBlock)) !== null) {
          choices.push(`${choiceMatch[1]}. ${choiceMatch[2].trim()}`);
        }

        if (choices.length > 0) {
          // Extract question label (number/identifier)
          const questionLabel = questionLabelRaw
            .replace(/[\.\)\s:]+$/, '')
            .trim() || String(questionIndex);

          // Extract question text (before choices)
          const questionText = questionBlock
            .split(/\n\s*[A-E][\.\)]/)[0]
            .replace(/^\d+[\.\)]\s*/, '')
            .replace(/^Q(?:uestion)?[\s\.:]+\d*\s*/i, '')
            .trim();

          questions.push({
            question_label: questionLabel,
            text: questionText,
            choices: choices,
          });

          questionIndex++;
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
