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
        lesson_items(id, ref_id, question_label, problem_statement, solution_context, question_solution_item_json, position)
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
        lesson_items(id, ref_id, question_label, problem_statement, solution_context, question_solution_item_json, position)
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
   * Create a new lesson by merging question set and solution set
   * If `items` array is provided, use those directly (for edited/custom items)
   */
  async create({ name, question_set_id, solution_set_id, items: providedItems }) {
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

    // Create the lesson record
    const { data: lesson, error: lessonError } = await supabase
      .from('lessons')
      .insert({
        name,
        book_id: questionSet.book_id,
        chapter_id: questionSet.chapter_id,
        question_set_id,
        solution_set_id,
      })
      .select()
      .single();

    if (lessonError) throw lessonError;

    // Create lesson_items for each merged item
    const lessonItems = mergedItems.map((item, index) => {
      // Build problem_statement: question text + choices
      let problemStatement = item.text || '';
      if (item.choices && item.choices.length > 0) {
        problemStatement += '\n\n' + item.choices.join('\n');
      }

      // Build solution_context: answer_key + worked_solution
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
      };
    });

    // Insert all lesson_items
    if (lessonItems.length > 0) {
      const { error: itemsError } = await supabase
        .from('lesson_items')
        .insert(lessonItems);

      if (itemsError) throw itemsError;
    }

    // Fetch and return the complete lesson with items
    return await this.findById(lesson.id);
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
      let problemStatement = item.text || '';
      if (item.choices && item.choices.length > 0) {
        problemStatement += '\n\n' + item.choices.join('\n');
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
