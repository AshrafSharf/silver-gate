import { supabase } from '../config/database.js';
import { questionExtractionService } from './questionExtraction.service.js';
import { solutionExtractionService } from './solutionExtraction.service.js';
import { generateMongoId } from '../utils/mongoId.js';
import {
  flattenQuestions,
  flattenBlockGroups,
  buildSolutionLookup,
  applySolution,
} from './academicBook.matching.js';
import { countSolutions } from './academicBookSolution.parser.js';

/**
 * Matched / unmatched counts per Academic Book block.
 *
 * A headline "27 of 48 matched" hides the failure that actually matters — one
 * exercise annotated wrongly and matching nothing at all. Returns null for flat
 * Question Bank items, which have no blocks to group by.
 */
function summarizeByBlock(items) {
  const groups = new Map();

  for (const item of items) {
    if (!item.block_name) continue;
    const key = `${item.block_type}|${item.block_index}`;
    if (!groups.has(key)) {
      groups.set(key, { type: item.block_type, index: item.block_index, name: item.block_name, total: 0, matched: 0 });
    }
    const group = groups.get(key);
    group.total += 1;
    if (item.has_solution) group.matched += 1;
  }

  return groups.size > 0 ? [...groups.values()] : null;
}

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

    // The solutions PDF is optional — see `create`.
    let solutionSet = null;
    if (solution_set_id) {
      solutionSet = await solutionExtractionService.findById(solution_set_id);
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
    }

    // Flatten both shapes to one item list, then match. Academic Book sets are
    // grouped into blocks and key on (block, label); Question Bank sets stay flat.
    const questions = flattenQuestions(questionSet.questions);
    const lookup = buildSolutionLookup(solutionSet?.solutions);

    const mergedItems = questions.map((question) => {
      const item = { ...question, has_solution: false };
      item.has_solution = applySolution(item, lookup(question));
      return item;
    });

    // Count matched vs unmatched
    const matchedCount = mergedItems.filter(item => item.has_solution).length;
    const unmatchedCount = mergedItems.length - matchedCount;
    const solutionsCount = countSolutions(solutionSet?.solutions);

    // Academic Book sets ship the lesson plan with them — one block per lesson,
    // already named and sectioned. Hand it to the client so block mode can
    // prefill rather than asking for what the parser already read.
    const blockGroups = flattenBlockGroups(questionSet.questions);

    return {
      question_set_id,
      solution_set_id: solution_set_id || null,
      book_id: questionSet.book_id,
      chapter_id: questionSet.chapter_id,
      question_set: {
        id: questionSet.id,
        name: questionSet.name,
      },
      solution_set: solutionSet ? { id: solutionSet.id, name: solutionSet.name } : null,
      blocks: blockGroups
        ? blockGroups.map(({ items, ...meta }) => ({ ...meta, item_count: items.length }))
        : null,
      book: questionSet.book,
      chapter: questionSet.chapter,
      summary: {
        total_questions: questions.length,
        total_solutions: solutionsCount,
        matched: matchedCount,
        unmatched: unmatchedCount,
        // Per-block counts make a mis-annotated exercise visible before lessons
        // are written — a whole block matching zero solutions is the failure
        // mode worth catching, and a headline total hides it.
        by_block: summarizeByBlock(mergedItems),
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
   *
   * Block mode (Academic Book): one lesson per exercise / example block, taking
   * its name, sections and question type from the block itself. Used when
   * `block_configs` is supplied, or derived from the question set when it holds
   * blocks and no other mode was asked for.
   * block_configs format: [{ block_type: 'EXERCISE', block_index: '1.1', lesson_name: 'EXERCISE', parent_section_name: '...', common_parent_section_name: '...', question_type: 'OTHER' }, ...]
   * (lesson_name is number-free — the printed number travels as block_index and
   * is stored with the rest of the block metadata in question_solution_json.)
   */
  async create({ name, common_parent_section_name, parent_section_name, lesson_item_count, range_configs, block_configs, question_set_id, solution_set_id, items: providedItems, question_type = 'OTHER' }) {
    // Fetch question set
    const questionSet = await questionExtractionService.findById(question_set_id);
    if (!questionSet) {
      throw new Error('Question set not found');
    }

    // The solutions PDF is optional: an Academic Book's worked examples carry
    // their working from the chapter itself, and an exercise's solutions can be
    // attached later through mergeSolutionSet.
    let solutionSet = null;
    if (solution_set_id) {
      solutionSet = await solutionExtractionService.findById(solution_set_id);
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
      const lookup = buildSolutionLookup(solutionSet?.solutions);
      mergedItems = flattenQuestions(questionSet.questions).map((question) => {
        const item = { ...question };
        applySolution(item, lookup(question));
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
    // blockFields carries the Academic Book block provenance (type, printed
    // index, per-type order, page span) for block mode; null for every other
    // mode, whose lessons are not blocks. It is stored inside the existing
    // `question_solution_json` column rather than as columns of its own — the
    // deployment has no schema-change access, and that column is unused by any
    // code (it is declared in the original CREATE TABLE and read nowhere).
    const createSingleLesson = async (lessonName, lessonItems, lessonCommonParentSectionName = null, lessonParentSectionName = null, questionRange = null, display_orderValue = null, lessonQuestionType = null, blockFields = null) => {
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
          // Academic Book multi-part questions carry their printed parts;
          // dropping them here would leave "Express each number as a product of
          // its prime factors:" with nothing to express.
          baseItem.sub_questions = (item.sub_questions || []).map((sub, subIndex) => ({
            id: `${questionId}.${subIndex + 1}`,
            question: sub.question || '',
            question_label: sub.question_label,
          }));
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
          ...(blockFields ? { question_solution_json: { block: blockFields } } : {}),
        })
        .select()
        .single();

      if (lessonError) throw lessonError;

      // Create lesson_items for each item
      const lessonItemRecords = lessonItems.map((item, index) => {
        let problemStatement = item.text || '';
        if (item.choices && item.choices.length > 0) {
          problemStatement += ' $\\\\$ ' + item.choices.join(' $\\hspace{2em}$');
        } else if (item.sub_questions && item.sub_questions.length > 0) {
          problemStatement += ' $\\\\$ ' + item.sub_questions
            .map((sub) => `${sub.question_label || ''} ${sub.question || ''}`.trim())
            .join(' $\\\\$ ');
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

    // Block mode (Academic Book): one lesson per exercise / example block.
    //
    // The chapter already did the grouping by hand-splitting an operator would
    // otherwise redo — the exercise heading names the lesson and the topic it
    // sat under names the sections — so a flat split by count would discard
    // work the parser already produced. Explicit `block_configs` (the operator
    // having edited the prefilled names) win; otherwise a block-shaped question
    // set with no other mode requested falls into block mode.
    const blockGroups = flattenBlockGroups(questionSet.questions);
    const hasBlockConfigs = Array.isArray(block_configs) && block_configs.length > 0;
    const otherModeRequested =
      (range_configs && range_configs.length > 0) ||
      lesson_item_count > 0 ||
      (providedItems && providedItems.length > 0);

    if (hasBlockConfigs || (blockGroups && !otherModeRequested)) {
      if (!blockGroups) {
        throw new Error(
          'block_configs was supplied but the question set has no blocks. Block mode needs an ' +
          'Academic Book extraction; this set is a flat question list.'
        );
      }

      // Overrides are keyed on block identity rather than position, so a config
      // list that omits a block (or arrives reordered) still lands on the right
      // one instead of silently renaming its neighbour.
      const overrides = new Map();
      for (const cfg of block_configs || []) {
        overrides.set(`${cfg.block_type || ''}|${cfg.block_index || ''}`, cfg);
      }

      const lookup = buildSolutionLookup(solutionSet?.solutions);
      let currentOrder = await getNextOrderForChapter(questionSet.chapter_id);
      const createdLessonIds = [];

      for (const group of blockGroups) {
        const override = overrides.get(`${group.block_type}|${group.block_index}`) || {};

        // An operator who cleared a name meant the block's own name, not "".
        // The name is number-free ("EXERCISE"); the number is stored separately
        // as block_index, which is how the downstream `exercise` document keeps
        // name and index apart.
        const lessonName = (override.lesson_name || '').trim() || group.lesson_name;
        if (!lessonName) {
          throw new Error(`Block ${group.block_type} ${group.block_index} has no name and none was supplied`);
        }

        const groupItems = group.items.map((question) => {
          const item = { ...question };
          applySolution(item, lookup(question));
          return item;
        });

        if (groupItems.length === 0) {
          console.warn(`[LESSONS] Skipping block "${lessonName}" — it has no question items`);
          continue;
        }

        const questionRange =
          `${groupItems[0].question_label || 1} - ${groupItems[groupItems.length - 1].question_label || groupItems.length}`;

        const lessonId = await createSingleLesson(
          lessonName,
          groupItems,
          override.common_parent_section_name !== undefined
            ? override.common_parent_section_name
            : group.common_parent_section_name,
          override.parent_section_name !== undefined
            ? override.parent_section_name
            : group.parent_section_name,
          questionRange,
          currentOrder,
          override.question_type || group.question_type,
          {
            type: group.block_type,
            index: group.block_index,
            order: group.block_order,
            start_page: group.start_page,
            end_page: group.end_page,
          }
        );
        createdLessonIds.push(lessonId);
        currentOrder++;
      }

      if (createdLessonIds.length === 0) {
        throw new Error('No lessons were created — every block in this question set is empty');
      }

      return await Promise.all(createdLessonIds.map((id) => this.findById(id)));
    }

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
   * Prepare items for appending to an existing lesson.
   * Accepts a required `question_set_id` and an optional `solution_set_id`.
   * When the solution set is omitted, items are returned from the question set only.
   */
  async prepareItems({ question_set_id, solution_set_id }) {
    const questionSet = await questionExtractionService.findById(question_set_id);
    if (!questionSet) {
      throw new Error('Question set not found');
    }

    let solutionSet = null;
    if (solution_set_id) {
      solutionSet = await solutionExtractionService.findById(solution_set_id);
      if (!solutionSet) {
        throw new Error('Solution set not found');
      }
    }

    const questions = flattenQuestions(questionSet.questions);
    const lookup = buildSolutionLookup(solutionSet?.solutions);

    const mergedItems = questions.map((question) => {
      const item = { ...question, has_solution: false };
      item.has_solution = applySolution(item, lookup(question));
      return item;
    });

    return {
      question_set: { id: questionSet.id, name: questionSet.name },
      solution_set: solutionSet ? { id: solutionSet.id, name: solutionSet.name } : null,
      summary: {
        total_questions: questions.length,
        total_solutions: countSolutions(solutionSet?.solutions),
        matched: mergedItems.filter((i) => i.has_solution).length,
        by_block: summarizeByBlock(mergedItems),
      },
      items: mergedItems,
    };
  },

  /**
   * Append selected items to an existing lesson.
   * Inserts new lesson_items rows at positions continuing after the current max.
   */
  async appendItems(lessonId, { items, question_type = 'OTHER' }) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('items must be a non-empty array');
    }

    const { data: lesson, error: lessonError } = await supabase
      .from('lessons')
      .select('id, toc_output_json')
      .eq('id', lessonId)
      .single();

    if (lessonError || !lesson) {
      throw new Error('Lesson not found');
    }

    const { data: existing, error: existingError } = await supabase
      .from('lesson_items')
      .select('position')
      .eq('lesson_id', lessonId)
      .order('position', { ascending: false })
      .limit(1);

    if (existingError) throw existingError;

    const startPosition = existing && existing.length > 0 && existing[0].position !== null
      ? existing[0].position + 1
      : 0;

    const extractChoiceLabel = (choiceText, fallbackIndex) => {
      const patterns = [
        /^\$\(([a-zA-Z])\)\$\s*/,
        /^\(([a-zA-Z])\)\s*/,
        /^\$([a-zA-Z])\$\s*/,
        /^([a-zA-Z])\.\s*/,
        /^([a-zA-Z])\)\s*/,
      ];
      for (const pattern of patterns) {
        const match = choiceText.match(pattern);
        if (match && match[1]) return match[1].toLowerCase();
      }
      return String.fromCharCode(97 + fallbackIndex);
    };

    const cleanChoiceText = (choiceText) =>
      choiceText
        .replace(/^\$\([a-zA-Z]\)\$\s*/, '')
        .replace(/^\([a-zA-Z]\)\s*/, '')
        .replace(/^\$[a-zA-Z]\$\s*/, '')
        .replace(/^[a-zA-Z]\.\s*/, '')
        .replace(/^[a-zA-Z]\)\s*/, '')
        .trim();

    const newRecords = items.map((item, idx) => {
      const position = startPosition + idx;
      let problemStatement = item.text || '';
      if (item.choices && item.choices.length > 0) {
        problemStatement += ' $\\\\$ ' + item.choices.join(' $\\hspace{2em}$');
      } else if (item.sub_questions && item.sub_questions.length > 0) {
        problemStatement += ' $\\\\$ ' + item.sub_questions
          .map((sub) => `${sub.question_label || ''} ${sub.question || ''}`.trim())
          .join(' $\\\\$ ');
      }

      let solutionContext = '';
      if (item.answer_key) solutionContext = `Answer: ${item.answer_key}`;
      if (item.worked_solution) {
        solutionContext += (solutionContext ? '\n\n' : '') + item.worked_solution;
      }

      return {
        lesson_id: lessonId,
        question_label: item.question_label,
        problem_statement: problemStatement,
        solution_context: solutionContext,
        question_solution_item_json: item,
        position,
        ref_id: generateMongoId(),
        question_type,
        index: String(position + 1),
      };
    });

    const { error: insertError } = await supabase
      .from('lesson_items')
      .insert(newRecords);

    if (insertError) throw insertError;

    // Rebuild the full toc_output_json from ALL current lesson_items (existing + newly inserted)
    // so the list stays in sync with lesson_items at all times.
    const { data: allItems, error: allItemsError } = await supabase
      .from('lesson_items')
      .select('position, question_label, question_solution_item_json')
      .eq('lesson_id', lessonId)
      .order('position', { ascending: true });

    if (allItemsError) throw allItemsError;

    const tocQuestionItems = (allItems || []).map((row, index) => {
      const source = row.question_solution_item_json || {};
      const questionId = String(index + 1);
      const baseItem = {
        id: questionId,
        question: source.text || '',
        question_label: String(row.question_label ?? source.question_label ?? questionId),
      };
      const choices = source.choices || [];
      if (choices.length > 0) {
        baseItem.choices = choices.map((choice, choiceIndex) => ({
          id: `${questionId}.${choiceIndex + 1}`,
          question: cleanChoiceText(choice),
          question_label: extractChoiceLabel(choice, choiceIndex),
        }));
      } else {
        baseItem.sub_questions = (source.sub_questions || []).map((sub, subIndex) => ({
          id: `${questionId}.${subIndex + 1}`,
          question: sub.question || '',
          question_label: sub.question_label,
        }));
      }
      return baseItem;
    });

    const { error: updateError } = await supabase
      .from('lessons')
      .update({ toc_output_json: { toc_question_items: tocQuestionItems } })
      .eq('id', lessonId);

    if (updateError) throw updateError;

    return await this.findById(lessonId);
  },

  /**
   * Create an empty lesson (no lesson_items, no question/solution sets required).
   * Used by the standalone "Create Lesson" flow that only captures metadata.
   */
  async createEmpty({ name, book_id, chapter_id, common_parent_section_name, parent_section_name, lesson_item_count, question_type = 'OTHER' }) {
    if (!name || !name.trim()) {
      throw new Error('Lesson name is required');
    }

    // Determine next display_order for the chapter (if provided)
    let display_order = null;
    if (chapter_id) {
      const { data, error } = await supabase
        .from('lessons')
        .select('display_order')
        .eq('chapter_id', chapter_id)
        .not('display_order', 'is', null)
        .order('display_order', { ascending: false })
        .limit(1);

      if (error) throw error;
      display_order = (!data || data.length === 0 || data[0].display_order === null) ? 1 : data[0].display_order + 1;
    }

    const { data: lesson, error: lessonError } = await supabase
      .from('lessons')
      .insert({
        name: name.trim(),
        common_parent_section_name: common_parent_section_name?.trim() || null,
        parent_section_name: parent_section_name?.trim() || null,
        book_id: book_id || null,
        chapter_id: chapter_id || null,
        display_order,
        toc_output_json: { toc_question_items: [] },
        ref_id: generateMongoId(),
      })
      .select()
      .single();

    if (lessonError) throw lessonError;

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
   * Merge a solution set into all of a lesson's items.
   *
   * Two modes:
   *  - Auto-match (default): looks up each lesson_item's matching solution by
   *    question_label and merges answer_key / worked_solution / explanation /
   *    visual_path into question_solution_item_json.
   *  - Per-item overrides (when `options.items` is provided): applies the
   *    user-edited values directly, ignoring auto-match. Each entry must be
   *    `{ item_id, answer_key?, worked_solution?, explanation?, visual_path? }`.
   *
   * In both modes, solution_context is rebuilt from the merged JSON using the
   * same convention as create / appendItems / updateLessonItem. Items with no
   * match (and no override) are left untouched. Always links the chosen
   * solution_set to the lesson so the footer reflects it.
   */
  async mergeSolutionSet(lessonId, solutionSetId, options = {}) {
    const { items: itemOverrides = null } = options;

    const { data: lesson, error: lessonError } = await supabase
      .from('lessons')
      .select('id')
      .eq('id', lessonId)
      .single();

    if (lessonError || !lesson) {
      throw new Error('Lesson not found');
    }

    const solutionSet = await solutionExtractionService.findById(solutionSetId);
    if (!solutionSet) {
      throw new Error('Solution set not found');
    }

    const overrideMode = Array.isArray(itemOverrides) && itemOverrides.length > 0;

    let lookup = null;
    if (!overrideMode) {
      if (countSolutions(solutionSet.solutions) === 0) {
        throw new Error('Selected solution set has no solutions');
      }
      // Academic Book lesson items carry block_type / block_index in their
      // question_solution_item_json, which is what the lookup keys on; flat
      // items fall back to the bare label as before.
      lookup = buildSolutionLookup(solutionSet.solutions);
    }

    const { data: items, error: itemsError } = await supabase
      .from('lesson_items')
      .select('id, question_label, question_solution_item_json')
      .eq('lesson_id', lessonId);

    if (itemsError) throw itemsError;

    const overridesById = new Map();
    if (overrideMode) {
      for (const o of itemOverrides) {
        if (o && o.item_id) overridesById.set(o.item_id, o);
      }
    }

    let matched = 0;
    const unmatchedLabels = [];

    for (const row of items || []) {
      const baseJson = row.question_solution_item_json || {};
      let solFields;

      if (overrideMode) {
        const o = overridesById.get(row.id);
        if (!o) continue;
        solFields = {
          answer_key: o.answer_key,
          worked_solution: o.worked_solution,
          explanation: o.explanation,
          visual_path: o.visual_path,
        };
      } else {
        const label = row.question_label !== null && row.question_label !== undefined
          ? String(row.question_label)
          : null;
        // Match on the stored item json (which carries block identity for
        // Academic Book items), falling back to the row's own label.
        const sol = lookup({ ...baseJson, question_label: baseJson.question_label ?? label });
        if (!sol) {
          if (label) {
            unmatchedLabels.push(baseJson.block_name ? `${baseJson.block_name} ${label}` : label);
          }
          continue;
        }
        solFields = {
          answer_key: sol.answer_key,
          worked_solution: sol.worked_solution,
          explanation: sol.explanation,
          visual_path: sol.visual_path,
        };
      }

      const mergedJson = {
        ...baseJson,
        answer_key: solFields.answer_key ?? baseJson.answer_key ?? '',
        worked_solution: solFields.worked_solution ?? baseJson.worked_solution ?? '',
        explanation: solFields.explanation ?? baseJson.explanation ?? '',
        visual_path: solFields.visual_path ?? baseJson.visual_path ?? '',
      };

      let solutionContext = '';
      if (mergedJson.answer_key) solutionContext = `Answer: ${mergedJson.answer_key}`;
      if (mergedJson.worked_solution) {
        solutionContext += (solutionContext ? '\n\n' : '') + mergedJson.worked_solution;
      }

      const { error: updateError } = await supabase
        .from('lesson_items')
        .update({
          question_solution_item_json: mergedJson,
          solution_context: solutionContext,
        })
        .eq('id', row.id);

      if (updateError) throw updateError;
      matched += 1;
    }

    // Link the solution set to the lesson so the modal footer reflects it.
    await supabase
      .from('lessons')
      .update({ solution_set_id: solutionSetId })
      .eq('id', lessonId);

    const refreshed = await this.findById(lessonId);
    return {
      lesson: refreshed,
      matched,
      total_items: items?.length || 0,
      unmatched_labels: unmatchedLabels,
    };
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
