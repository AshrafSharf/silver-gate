import { supabase } from '../config/database.js';
import { config } from '../config/index.js';

const LLAMAPARSE_API_URL = config.llamaParse.apiUrl;
const LLAMAPARSE_API_KEY = config.llamaParse.apiKey;

// Parsing instructions by source type
const SOLUTION_PARSING_INSTRUCTIONS = {
  'Question Bank': `
Extract all solutions, answer keys, and worked solutions from this document.

For each solution, identify:
1. The question label/number it corresponds to (e.g., "1", "2", "1a", "1b", "Q1", etc.)
2. The answer key (if multiple choice, e.g., "A", "B", "C", "D")
3. The complete step-by-step worked solution
4. Any brief explanation (if provided)

Return the result in the following JSON format:
{
  "solutions": [
    {
      "question_label": "1",
      "answer_key": "C",
      "worked_solution": "Step 1: Apply formula $x = \\frac{-b}{2a}$...\\nStep 2: Substitute values...",
      "explanation": "Optional explanation"
    }
  ]
}

Important:
- Preserve the original question label/number exactly as it appears in the document
- Preserve LaTeX math notation ($...$ and $$...$$)
- If only an answer key is provided (no worked solution), still include the entry with worked_solution as empty string
- If only a worked solution is provided (no answer key), leave answer_key as empty string
- Include all solutions found in the document
- If a solution has sub-parts, treat each sub-part as a separate solution entry (e.g., "1a", "1b")
`,
  'Academic Book': `
Extract all solutions, answer keys, and worked solutions from this document.

For each solution, identify:
1. The question label/number it corresponds to (e.g., "1", "2", "1a", "1b", "Q1", etc.)
2. The answer key (if multiple choice, e.g., "A", "B", "C", "D")
3. The complete step-by-step worked solution
4. Any brief explanation (if provided)

Return the result in the following JSON format:
{
  "solutions": [
    {
      "question_label": "1",
      "answer_key": "C",
      "worked_solution": "Step 1: Apply formula $x = \\frac{-b}{2a}$...\\nStep 2: Substitute values...",
      "explanation": "Optional explanation"
    }
  ]
}

Important:
- Preserve the original question label/number exactly as it appears in the document
- Preserve LaTeX math notation ($...$ and $$...$$)
- If only an answer key is provided (no worked solution), still include the entry with worked_solution as empty string
- If only a worked solution is provided (no answer key), leave answer_key as empty string
- Include all solutions found in the document
- If a solution has sub-parts, treat each sub-part as a separate solution entry (e.g., "1a", "1b")
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
   * @returns {Promise<object>} - Updated solution set with extracted solutions
   */
  async extractSolutions(solutionSetId) {
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

      // Submit to LlamaParse with type-specific instructions
      const sourceType = solutionSet.source_type || 'Question Bank';
      const jobId = await this.submitToLlamaParse(combinedContent, sourceType);

      // Store the job ID
      await supabase
        .from('solution_sets')
        .update({ llamaparse_job_id: jobId })
        .eq('id', solutionSetId);

      // Poll for completion
      const rawResult = await this.pollForCompletion(jobId);
      console.log(`[SOLUTION_EXTRACT] LlamaParse raw result size: ${Math.round(rawResult.length / 1024)}KB`);
      console.log(`[SOLUTION_EXTRACT] Raw result preview (first 500 chars): ${rawResult.substring(0, 500)}`);

      // Parse the result into solution format
      const solutions = this.parseSolutionsFromContent(rawResult);
      const solutionsJson = JSON.stringify(solutions);
      console.log(`[SOLUTION_EXTRACT] Parsed solutions count: ${solutions.solutions?.length || 0}`);
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
   * Parse extracted content into solution JSON format
   * @param {string} rawContent - Raw extracted content from LlamaParse
   * @returns {object} - Structured solutions object
   */
  parseSolutionsFromContent(rawContent) {
    try {
      // Find ALL JSON objects with "solutions" arrays and merge them
      const allSolutions = [];
      let searchStart = 0;

      while (true) {
        // Find next JSON object with solutions
        let jsonStart = rawContent.indexOf('{"solutions"', searchStart);

        // Also try with whitespace variations
        if (jsonStart === -1) {
          const match = rawContent.substring(searchStart).match(/\{\s*"solutions"\s*:\s*\[/);
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
            if (parsed.solutions && Array.isArray(parsed.solutions)) {
              console.log(`[SOLUTION_EXTRACT] Found JSON block with ${parsed.solutions.length} solutions`);
              allSolutions.push(...parsed.solutions);
            }
          } catch (parseErr) {
            console.error(`[SOLUTION_EXTRACT] Failed to parse JSON block: ${parseErr.message}`);
          }
          searchStart = jsonEnd;
        } else {
          break;
        }
      }

      if (allSolutions.length > 0) {
        console.log(`[SOLUTION_EXTRACT] Total merged solutions: ${allSolutions.length}`);
        return { solutions: allSolutions };
      }

      // If no JSON found, try to parse from structured text
      const solutions = [];

      // Try to find answer key patterns like "1. C" or "1) A" or "Q1: B"
      const answerKeyRegex = /(?:^|\n)\s*(?:Q(?:uestion)?\.?\s*)?(\d+[a-z]?)[\.\)\:\s]+([A-E])\s*(?:\n|$)/gi;

      let match;
      while ((match = answerKeyRegex.exec(rawContent)) !== null) {
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

      // Try to find worked solution patterns
      const solutionRegex = /(?:^|\n)\s*(?:Solution|Answer|Q(?:uestion)?)\s*(?:for\s+)?(\d+[a-z]?)[\.\)\:\s]*([\s\S]*?)(?=\n\s*(?:Solution|Answer|Q(?:uestion)?)\s*(?:for\s+)?\d+|\Z)/gi;

      while ((match = solutionRegex.exec(rawContent)) !== null) {
        const questionLabel = match[1].trim();
        const workedSolution = match[2].trim();

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
};

export default solutionExtractionService;
