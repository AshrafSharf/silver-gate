import { supabaseAdmin } from '../../../config/database.js';
import { BaseReverseSyncer } from '../base.reverse-syncer.js';
import { toObjectId, toDBRef } from '../helpers.js';

class LessonItemReverseSyncer extends BaseReverseSyncer {
  constructor() {
    super({
      supabaseTable: 'lesson_items',
      mongoCollection: 'exercise_item',
      logTag: 'LESSON_ITEM_SYNC',
    });
  }

  /**
   * Load lesson ref_id mappings before sync
   */
  async preSyncHook(context) {
    // Load lesson ref_ids: { supabase_id: ref_id }
    const { data: lessons, error: lessonsError } = await supabaseAdmin
      .from('lessons')
      .select('id, ref_id');

    if (lessonsError) {
      throw new Error(`Failed to fetch lessons: ${lessonsError.message}`);
    }

    context.lessonRefIds = {};
    for (const lesson of lessons || []) {
      if (lesson.ref_id) {
        context.lessonRefIds[lesson.id] = lesson.ref_id;
      }
    }

    return context;
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
      index: item.question_label,
      display_order: item.question_label,
      question_label: item.question_label,
      question_type: item.question_type,
    };
  }
}

export const lessonItemReverseSyncer = new LessonItemReverseSyncer();
