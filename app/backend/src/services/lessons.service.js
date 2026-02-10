import { supabase } from '../config/database.js';
import { questionExtractionService } from './questionExtraction.service.js';
import { solutionExtractionService } from './solutionExtraction.service.js';
import { generateMongoId } from '../utils/mongoId.js';

export const lessonsService = {
  /**
   * Get all lessons with optional filtering
   */
  async getAll(filters = {}) {
    let query = supabase
      .from('lessons')
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number),
        question_set:question_sets(id, name),
        solution_set:solution_sets(id, name),
        lesson_items(id, ref_id, question_label, problem_statement, solution_context, question_solution_item_json, position, index)
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

    // Sort lesson_items by position for each lesson
    if (data) {
      data.forEach(lesson => {
        if (lesson.lesson_items) {
          lesson.lesson_items.sort((a, b) => a.position - b.position);
        }
      });
    }

    return data;
  },

  /**
   * Find lesson by ID
   */
  async findById(id) {
    const { data, error } = await supabase
      .from('lessons')
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number),
        question_set:question_sets(id, name),
        solution_set:solution_sets(id, name),
        lesson_items(id, ref_id, question_label, problem_statement, solution_context, question_solution_item_json, position, index)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw error;
    }

    // Sort lesson_items by position
    if (data && data.lesson_items) {
      data.lesson_items.sort((a, b) => a.position - b.position);
    }

    return data;
  },

  /**
   * Prepare lesson data by merging question set and solution set (without creating)
   * Returns the merged JSON for preview/verification
   */
  async prepare({ question_set_id, solution_set_id }) {
    // Fetch question set
    const questionSet = await questionExtractionService.findById(question_set_id);
    if (!questionSet) {
      throw new Error('Question set not found');
    }

    // Fetch solution set
    const solutionSet = await solutionExtractionService.findById(solution_set_id);
    if (!solutionSet) {
      throw new Error('Solution set not found');
    }

    // Validate that both sets belong to the same book and chapter
    if (questionSet.book_id !== solutionSet.book_id) {
      throw new Error('Question set and solution set must belong to the same book');
    }

    if (questionSet.chapter_id !== solutionSet.chapter_id) {
      throw new Error('Question set and solution set must belong to the same chapter');
    }

    // Get questions and solutions arrays
    const questions = questionSet.questions?.questions || [];
    const solutions = solutionSet.solutions?.solutions || [];

    // Create a map of solutions by question_label for quick lookup
    const solutionsMap = new Map();
    solutions.forEach((solution) => {
      if (solution.question_label) {
        solutionsMap.set(String(solution.question_label), solution);
      }
    });

    // Merge questions with solutions based on question_label
    const mergedItems = questions.map((question) => {
      const questionLabel = String(question.question_label || '');
      const matchingSolution = solutionsMap.get(questionLabel);

      const item = {
        question_label: question.question_label,
        text: question.text,
        choices: question.choices || [],
        has_solution: !!matchingSolution,
      };

      // Add solution fields if matching solution exists
      if (matchingSolution) {
        if (matchingSolution.answer_key) {
          item.answer_key = matchingSolution.answer_key;
        }
        if (matchingSolution.worked_solution) {
          item.worked_solution = matchingSolution.worked_solution;
        }
        if (matchingSolution.explanation) {
          item.explanation = matchingSolution.explanation;
        }
      }

      return item;
    });

    // Count matched vs unmatched
    const matchedCount = mergedItems.filter(item => item.has_solution).length;
    const unmatchedCount = mergedItems.length - matchedCount;

    return {
      question_set_id,
      solution_set_id,
      book_id: questionSet.book_id,
      chapter_id: questionSet.chapter_id,
      question_set: {
        id: questionSet.id,
        name: questionSet.name,
      },
      solution_set: {
        id: solutionSet.id,
        name: solutionSet.name,
      },
      book: questionSet.book,
      chapter: questionSet.chapter,
      summary: {
        total_questions: questions.length,
        total_solutions: solutions.length,
        matched: matchedCount,
        unmatched: unmatchedCount,
      },
      items: mergedItems,
    };
  },

  /**
   * Create a new lesson (or multiple lessons if lesson_item_count or range_configs is provided)
   * If `items` array is provided, use those directly (for edited/custom items)
   * If `lesson_item_count` is provided, split items into chunks and create multiple lessons (Auto Split mode)
   * If `range_configs` is provided, create lessons based on custom ranges (Manual Range mode)
   *
   * Auto Split mode: Uses shared `name`, `common_parent_section_name`, and `parent_section_name`
   * Manual Range mode: Each range has its own `lesson_name`, `parent_section_name`, and `common_parent_section_name`
   *
   * range_configs format: [{ start: 1, end: 20, lesson_name: 'Lesson 1', parent_section_name: 'Section A', common_parent_section_name: 'Algebra' }, ...]
   */
  async create({ name, common_parent_section_name, parent_section_name, lesson_item_count, range_configs, question_set_id, solution_set_id, items: providedItems, question_type = 'OTHER' }) {
    // Fetch question set
    const questionSet = await questionExtractionService.findById(question_set_id);
    if (!questionSet) {
      throw new Error('Question set not found');
    }

    // Fetch solution set
    const solutionSet = await solutionExtractionService.findById(solution_set_id);
    if (!solutionSet) {
      throw new Error('Solution set not found');
    }

    // Validate that both sets belong to the same book and chapter
    if (questionSet.book_id !== solutionSet.book_id) {
      throw new Error('Question set and solution set must belong to the same book');
    }

    if (questionSet.chapter_id !== solutionSet.chapter_id) {
      throw new Error('Question set and solution set must belong to the same chapter');
    }

    let mergedItems;

    // If items are provided directly (edited by user), use those
    if (providedItems && Array.isArray(providedItems) && providedItems.length > 0) {
      mergedItems = providedItems.map(item => ({
        question_label: item.question_label,
        text: item.text,
        choices: item.choices || [],
        answer_key: item.answer_key,
        worked_solution: item.worked_solution,
        explanation: item.explanation,
      }));
    } else {
      // Otherwise, merge from question and solution sets
      const questions = questionSet.questions?.questions || [];
      const solutions = solutionSet.solutions?.solutions || [];

      // Create a map of solutions by question_label for quick lookup
      const solutionsMap = new Map();
      solutions.forEach((solution) => {
        if (solution.question_label) {
          solutionsMap.set(String(solution.question_label), solution);
        }
      });

      // Merge questions with solutions based on question_label
      mergedItems = questions.map((question) => {
        const questionLabel = String(question.question_label || '');
        const matchingSolution = solutionsMap.get(questionLabel);

        const item = {
          question_label: question.question_label,
          text: question.text,
          choices: question.choices || [],
        };

        // Add solution fields if matching solution exists
        if (matchingSolution) {
          if (matchingSolution.answer_key) {
            item.answer_key = matchingSolution.answer_key;
          }
          if (matchingSolution.worked_solution) {
            item.worked_solution = matchingSolution.worked_solution;
          }
          if (matchingSolution.explanation) {
            item.explanation = matchingSolution.explanation;
          }
        }

        return item;
      });
    }

    // Helper function to build question text (combining text + choices) for problem_statement
    const buildQuestionText = (item) => {
      let questionText = item.text || '';
      if (item.choices && item.choices.length > 0) {
        questionText += ' $\\\\$ ' + item.choices.join(' $\\hspace{2em}$');
      }
      return questionText;
    };

    // Helper function to extract choice label from choice text
    // Handles formats like "$(a)$ text", "(a) text", etc.
    const extractChoiceLabel = (choiceText, fallbackIndex) => {
      // Try to match patterns like $(a)$, (a), (A), etc.
      const patterns = [
        /^\$\(([a-zA-Z])\)\$\s*/,      // $(a)$ format
        /^\(([a-zA-Z])\)\s*/,          // (a) format
        /^\$([a-zA-Z])\$\s*/,          // $a$ format
        /^([a-zA-Z])\.\s*/,            // a. format
        /^([a-zA-Z])\)\s*/,            // a) format
      ];

      for (const pattern of patterns) {
        const match = choiceText.match(pattern);
        if (match && match[1]) {
          return match[1].toLowerCase();
        }
      }

      // Fallback to letter based on index
      return String.fromCharCode(97 + fallbackIndex); // 'a', 'b', 'c', 'd'
    };

    // Helper function to clean choice text (remove the label prefix)
    const cleanChoiceText = (choiceText) => {
      // Remove common label patterns from the beginning
      return choiceText
        .replace(/^\$\([a-zA-Z]\)\$\s*/, '')   // $(a)$ format
        .replace(/^\([a-zA-Z]\)\s*/, '')       // (a) format
        .replace(/^\$[a-zA-Z]\$\s*/, '')       // $a$ format
        .replace(/^[a-zA-Z]\.\s*/, '')         // a. format
        .replace(/^[a-zA-Z]\)\s*/, '')         // a) format
        .trim();
    };

    // Helper function to get the next display_order value for a chapter
    const getNextOrderForChapter = async (chapterId) => {
      const { data, error } = await supabase
        .from('lessons')
        .select('display_order')
        .eq('chapter_id', chapterId)
        .not('display_order', 'is', null)
        .order('display_order', { ascending: false })
        .limit(1);

      if (error) throw error;

      // If no lessons exist or none have display_order, start at 1
      if (!data || data.length === 0 || data[0].display_order === null) {
        return 1;
      }

      return data[0].display_order + 1;
    };

    // Helper function to create a single lesson with its items
    // lessonCommonParentSectionName and lessonParentSectionName are optional overrides for manual range mode
    // questionRange is the string representation of the range (e.g., "1 - 10")
    // display_orderValue is the display_order of this lesson within its chapter
    // lessonQuestionType is the question type for all items in this lesson (defaults to global question_type)
    const createSingleLesson = async (lessonName, lessonItems, lessonCommonParentSectionName = null, lessonParentSectionName = null, questionRange = null, display_orderValue = null, lessonQuestionType = null) => {
      console.log('createSingleLesson called with lessonQuestionType:', lessonQuestionType, 'global question_type:', question_type);
      // Generate toc_output_json from lesson items
      const tocQuestionItems = lessonItems.map((item, index) => {
        const questionId = String(index + 1);
        const baseItem = {
          id: questionId,
          question: item.text || '',
          question_label: String(item.question_label || questionId),
        };

        // If item has choices, add choices array; otherwise add sub_questions
        if (item.choices && item.choices.length > 0) {
          baseItem.choices = item.choices.map((choice, choiceIndex) => ({
            id: `${questionId}.${choiceIndex + 1}`,
            question: cleanChoiceText(choice),
            question_label: extractChoiceLabel(choice, choiceIndex),
          }));
        } else {
          baseItem.sub_questions = [];
        }

        return baseItem;
      });

      const tocOutputJson = {
        toc_question_items: tocQuestionItems,
      };

      // Create the lesson record
      // Use provided overrides or fall back to main common_parent_section_name
      const { data: lesson, error: lessonError } = await supabase
        .from('lessons')
        .insert({
          name: lessonName,
          common_parent_section_name: lessonCommonParentSectionName !== null ? lessonCommonParentSectionName : common_parent_section_name,
          parent_section_name: lessonParentSectionName,
          question_range: questionRange,
          display_order: display_orderValue,
          book_id: questionSet.book_id,
          chapter_id: questionSet.chapter_id,
          question_set_id,
          solution_set_id,
          toc_output_json: tocOutputJson,
          ref_id: generateMongoId(),
        })
        .select()
        .single();

      if (lessonError) throw lessonError;

      // Create lesson_items for each item
      const lessonItemRecords = lessonItems.map((item, index) => {
        let problemStatement = item.text || '';
        if (item.choices && item.choices.length > 0) {
          problemStatement += ' $\\\\$ ' + item.choices.join(' $\\hspace{2em}$');
        }

        let solutionContext = '';
        if (item.answer_key) {
          solutionContext = `Answer: ${item.answer_key}`;
        }
        if (item.worked_solution) {
          solutionContext += (solutionContext ? '\n\n' : '') + item.worked_solution;
        }

        return {
          lesson_id: lesson.id,
          question_label: item.question_label,
          problem_statement: problemStatement,
          solution_context: solutionContext,
          question_solution_item_json: item,
          position: index,
          ref_id: generateMongoId(),
          question_type: lessonQuestionType || question_type,
          index: String(index + 1),
        };
      });

      if (lessonItemRecords.length > 0) {
        console.log('Inserting lesson items with question_type:', lessonItemRecords[0]?.question_type);
        const { error: itemsError } = await supabase
          .from('lesson_items')
          .insert(lessonItemRecords);

        if (itemsError) throw itemsError;
      }

      return lesson.id;
    };

    // If range_configs is provided, use Manual Range Mode
    if (range_configs && Array.isArray(range_configs) && range_configs.length > 0) {
      // Validate that range count doesn't exceed total items
      if (range_configs.length > mergedItems.length) {
        throw new Error(`Number of ranges (${range_configs.length}) cannot exceed total items (${mergedItems.length})`);
      }

      // Get the starting display_order value for this chapter
      let currentOrder = await getNextOrderForChapter(questionSet.chapter_id);

      const createdLessonIds = [];

      for (const config of range_configs) {
        console.log('Range config received:', JSON.stringify(config, null, 2));
        const {
          start,
          end,
          lesson_name: rangeLessonName,
          parent_section_name: rangeParentSectionName,
          common_parent_section_name: rangeCommonParentSectionName,
          question_type: rangeQuestionType
        } = config;
        console.log('Extracted rangeQuestionType:', rangeQuestionType);

        // Validate lesson_name is provided
        if (!rangeLessonName || !rangeLessonName.trim()) {
          throw new Error(`lesson_name is required for each range`);
        }

        // Validate range (1-indexed)
        if (start < 1 || end > mergedItems.length || start > end) {
          throw new Error(`Invalid range: ${start}-${end}. Valid range is 1-${mergedItems.length}`);
        }

        // Extract items for this range (convert 1-indexed to 0-indexed)
        const rangeItems = mergedItems.slice(start - 1, end);

        // Create question_range string using actual question labels
        const firstLabel = rangeItems[0]?.question_label || start;
        const lastLabel = rangeItems[rangeItems.length - 1]?.question_label || end;
        const questionRange = `${firstLabel} - ${lastLabel}`;

        // Use lesson_name from the config (no range appending)
        const lessonId = await createSingleLesson(
          rangeLessonName.trim(),
          rangeItems,
          rangeCommonParentSectionName || null,
          rangeParentSectionName || null,
          questionRange,
          currentOrder,
          rangeQuestionType || 'OTHER'
        );
        createdLessonIds.push(lessonId);
        currentOrder++; // Increment display_order for next lesson
      }

      // Fetch and return all created lessons
      const createdLessons = await Promise.all(
        createdLessonIds.map(id => this.findById(id))
      );

      return createdLessons;
    }

    // If lesson_item_count is not provided, create a single lesson with all items
    if (!lesson_item_count || lesson_item_count <= 0) {
      const display_orderValue = await getNextOrderForChapter(questionSet.chapter_id);
      const totalItems = mergedItems.length;
      const questionRange = totalItems > 0
        ? `${mergedItems[0].question_label || 1} - ${mergedItems[totalItems - 1].question_label || totalItems}`
        : null;
      const lessonId = await createSingleLesson(name, mergedItems, null, parent_section_name, questionRange, display_orderValue);
      return await this.findById(lessonId);
    }

    // Split items into chunks and create multiple lessons (Auto Split mode)
    // Get the starting display_order value for this chapter
    let currentOrder = await getNextOrderForChapter(questionSet.chapter_id);

    const createdLessonIds = [];
    const totalItems = mergedItems.length;

    for (let i = 0; i < totalItems; i += lesson_item_count) {
      const chunkItems = mergedItems.slice(i, i + lesson_item_count);

      // Create question_range string using actual question labels
      const firstLabel = chunkItems[0].question_label || (i + 1);
      const lastLabel = chunkItems[chunkItems.length - 1].question_label || Math.min(i + lesson_item_count, totalItems);
      const questionRange = `${firstLabel} - ${lastLabel}`;

      // Use lesson name without range appending, store range in question_range column
      // Pass parent_section_name for Auto Split mode (shared across all lessons)
      const lessonId = await createSingleLesson(name, chunkItems, null, parent_section_name, questionRange, currentOrder);
      createdLessonIds.push(lessonId);
      currentOrder++; // Increment display_order for next lesson
    }

    // Fetch and return all created lessons
    const createdLessons = await Promise.all(
      createdLessonIds.map(id => this.findById(id))
    );

    return createdLessons;
  },

  /**
   * Update a lesson (name only)
   */
  async update(id, updateData) {
    const updates = {};

    if (updateData.name !== undefined) {
      updates.name = updateData.name;
    }

    const { data, error } = await supabase
      .from('lessons')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Return full lesson with items
    return await this.findById(id);
  },

  /**
   * Update a single lesson item
   */
  async updateLessonItem(itemId, updateData) {
    const updates = {};

    // Extract individual fields from question_solution_item_json if provided
    if (updateData.question_solution_item_json !== undefined) {
      updates.question_solution_item_json = updateData.question_solution_item_json;

      // Also update problem_statement and solution_context based on the JSON
      const item = updateData.question_solution_item_json;

      // Build problem_statement
      // Uses LaTeX line break ($\\\\$) between text and choices
      // Uses LaTeX horizontal space ($\hspace{2em}$) between each choice
      let problemStatement = item.text || '';
      if (item.choices && item.choices.length > 0) {
        problemStatement += ' $\\\\$ ' + item.choices.join(' $\\hspace{2em}$');
      }
      updates.problem_statement = problemStatement;

      // Build solution_context
      let solutionContext = '';
      if (item.answer_key) {
        solutionContext = `Answer: ${item.answer_key}`;
      }
      if (item.worked_solution) {
        solutionContext += (solutionContext ? '\n\n' : '') + item.worked_solution;
      }
      updates.solution_context = solutionContext;

      // Update question_label if present
      if (item.question_label !== undefined) {
        updates.question_label = item.question_label;
      }
    }

    const { data, error } = await supabase
      .from('lesson_items')
      .update(updates)
      .eq('id', itemId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Delete a lesson (cascades to lesson_items)
   */
  async delete(id) {
    const { error } = await supabase
      .from('lessons')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  },

  /**
   * Delete a single lesson item
   */
  async deleteLessonItem(itemId) {
    const { error } = await supabase
      .from('lesson_items')
      .delete()
      .eq('id', itemId);

    if (error) throw error;
    return true;
  },
};

export default lessonsService;
