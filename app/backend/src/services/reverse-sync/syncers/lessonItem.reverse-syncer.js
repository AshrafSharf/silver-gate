import { supabaseAdmin } from '../../../config/database.js';
import { BaseReverseSyncer } from '../base.reverse-syncer.js';
import { toObjectId, toDBRef } from '../helpers.js';
import logger from '../../../utils/logger.js';

class LessonItemReverseSyncer extends BaseReverseSyncer {
  constructor() {
    super({
      supabaseTable: 'lesson_items',
      mongoCollection: 'exercise_item',
      logTag: 'LESSON_ITEM_SYNC',
    });
  }

  /**
   * Load lesson + chapter mappings used to attribute each lesson_item to its
   * parent exercise (MongoDB _id) and to label the row with the chapter
   * name in the run summary.
   */
  async preSyncHook(context) {
    const { data: lessons, error: lessonsError } = await supabaseAdmin
      .from('lessons')
      .select('id, ref_id, chapter_id');

    if (lessonsError) {
      throw new Error(`Failed to fetch lessons: ${lessonsError.message}`);
    }

    context.lessonRefIds = {};
    context.lessonChapterIds = {};
    for (const lesson of lessons || []) {
      if (lesson.ref_id) {
        context.lessonRefIds[lesson.id] = lesson.ref_id;
      }
      if (lesson.chapter_id) {
        context.lessonChapterIds[lesson.id] = lesson.chapter_id;
      }
    }

    const { data: chapters, error: chaptersError } = await supabaseAdmin
      .from('chapters')
      .select('id, name, display_name, chapter_number');

    if (chaptersError) {
      throw new Error(`Failed to fetch chapters: ${chaptersError.message}`);
    }

    context.chapterLabels = {};
    for (const chapter of chapters || []) {
      const label = chapter.display_name || chapter.name || null;
      if (label) {
        context.chapterLabels[chapter.id] = chapter.chapter_number
          ? `Ch ${chapter.chapter_number}: ${label}`
          : label;
      }
    }

    logger.info(this.logTag, `Loaded ${Object.keys(context.lessonRefIds).length} lesson ref_id mappings from ${lessons?.length || 0} lessons; ${Object.keys(context.chapterLabels).length} chapter labels`);
    return context;
  }

  /**
   * Per-group key: bucket inserts/skips by the parent exercise_id
   * (= the parent lesson's ref_id, which is the MongoDB exercise's _id).
   * Falls back to the source lesson_id when no ref_id mapping exists.
   */
  getGroupKey(item, context) {
    const exerciseId = context?.lessonRefIds?.[item.lesson_id];
    return exerciseId || item.lesson_id || null;
  }

  /**
   * Human-readable label: chapter name of the parent lesson's chapter.
   */
  getGroupLabel(item, context) {
    const chapterId = context?.lessonChapterIds?.[item.lesson_id];
    if (!chapterId) return null;
    return context?.chapterLabels?.[chapterId] || null;
  }

  /**
   * Transform a lesson_item to an exercise_item document
   */
  transformItem(item, context) {
    const lessonRefId = context.lessonRefIds[item.lesson_id];

    if (!lessonRefId) {
      // Skip items without a valid lesson reference
      return null;
    }

    return {
      _id: toObjectId(item.ref_id),
      exercise: toDBRef('exercise', lessonRefId),
      question: item.problem_statement,
      index: item.index,
      display_order: item.question_label,
      question_label: item.question_label,
      question_type: item.question_type,
      question_solution_item_json: item.question_solution_item_json,
    };
  }
}

export const lessonItemReverseSyncer = new LessonItemReverseSyncer();
