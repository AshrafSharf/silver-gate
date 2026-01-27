import { supabaseAdmin } from '../../../config/database.js';
import { BaseReverseSyncer } from '../base.reverse-syncer.js';
import { toObjectId, toDBRef } from '../helpers.js';

class LessonReverseSyncer extends BaseReverseSyncer {
  constructor() {
    super({
      supabaseTable: 'lessons',
      mongoCollection: 'exercise',
      logTag: 'LESSON_SYNC',
    });
  }

  /**
   * Load book and chapter ref_id mappings before sync
   */
  async preSyncHook(context) {
    // Load book ref_ids: { supabase_id: ref_id }
    const { data: books, error: booksError } = await supabaseAdmin
      .from('books')
      .select('id, ref_id');

    if (booksError) {
      throw new Error(`Failed to fetch books: ${booksError.message}`);
    }

    context.bookRefIds = {};
    for (const book of books || []) {
      if (book.ref_id) {
        context.bookRefIds[book.id] = book.ref_id;
      }
    }

    // Load chapter ref_ids: { supabase_id: ref_id }
    const { data: chapters, error: chaptersError } = await supabaseAdmin
      .from('chapters')
      .select('id, ref_id');

    if (chaptersError) {
      throw new Error(`Failed to fetch chapters: ${chaptersError.message}`);
    }

    context.chapterRefIds = {};
    for (const chapter of chapters || []) {
      if (chapter.ref_id) {
        context.chapterRefIds[chapter.id] = chapter.ref_id;
      }
    }

    return context;
  }

  /**
   * Transform a lesson to an exercise document
   */
  transformItem(item, context) {
    const bookRefId = context.bookRefIds[item.book_id];
    const chapterRefId = context.chapterRefIds[item.chapter_id];

    return {
      _id: toObjectId(item.ref_id),
      name: item.name,
      index: item.display_order,
      order: item.display_order,
      common_parent_section_name: item.common_parent_section_name,
      parent_section_name: item.parent_section_name,
      toc_output_json: item.toc_output_json,
      toc_status: 'COMPLETED',
      type: 'EXAMPLE',
      book: bookRefId ? toDBRef('book', bookRefId) : null,
      chapter: chapterRefId ? toDBRef('chapter', chapterRefId) : null,
    };
  }
}

export const lessonReverseSyncer = new LessonReverseSyncer();
