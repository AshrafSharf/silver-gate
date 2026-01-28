import { supabaseAdmin } from '../../../config/database.js';
import { getMongoConnection } from '../../../config/mongoConnection.js';
import { BaseReverseSyncer } from '../base.reverse-syncer.js';
import { toObjectId, toDBRef } from '../helpers.js';
import logger from '../../../utils/logger.js';

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
      index: item.question_range,
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

  /**
   * Override batchUpsert to handle unique index on (order, chapter, type)
   * Only inserts new documents, skips existing ones
   */
  async batchUpsert(documents, stats) {
    if (documents.length === 0) return;

    const collection = getMongoConnection().collection(this.mongoCollection);

    try {
      // Check which documents already exist
      const documentIds = documents.map(doc => doc._id);
      const existingDocs = await collection.find(
        { _id: { $in: documentIds } },
        { projection: { _id: 1 } }
      ).toArray();

      const existingIds = new Set(existingDocs.map(doc => doc._id.toString()));

      // Filter to only new documents
      const newDocuments = documents.filter(doc => !existingIds.has(doc._id.toString()));
      const skippedCount = documents.length - newDocuments.length;

      if (skippedCount > 0) {
        logger.info(this.logTag, `Skipping ${skippedCount} existing records`);
        stats.skipped += skippedCount;
      }

      if (newDocuments.length === 0) {
        logger.info(this.logTag, `No new documents to insert in this batch`);
        return;
      }

      // Build delete operations for documents with same unique key but different _id
      // This handles the case where the unique index (order, chapter, type) might conflict
      const deleteOperations = newDocuments.map(doc => ({
        deleteMany: {
          filter: {
            _id: { $ne: doc._id },
            order: doc.order,
            chapter: doc.chapter,
            type: doc.type,
          },
        },
      }));

      try {
        // First, delete any conflicting documents
        const deleteResult = await collection.bulkWrite(deleteOperations, { ordered: false });
        if (deleteResult.deletedCount > 0) {
          logger.info(this.logTag, `Deleted ${deleteResult.deletedCount} conflicting documents`);
        }
      } catch (error) {
        logger.warn(this.logTag, `Delete conflicts error (continuing): ${error.message}`);
      }

      // Insert only new documents
      const now = new Date();
      const documentsToInsert = newDocuments.map(doc => ({
        ...doc,
        created_at: now,
        updated_at: now,
      }));

      logger.info(this.logTag, `Inserting to collection: ${this.mongoCollection}, DB: ${collection.dbName}`);
      documentsToInsert.forEach(doc => {
        logger.info(this.logTag, `  Document _id: ${doc._id}, name: ${doc.name}`);
      });

      const result = await collection.insertMany(documentsToInsert, { ordered: false });
      stats.inserted += result.insertedCount;
      logger.info(this.logTag, `Batch result - Inserted: ${result.insertedCount}, Skipped: ${skippedCount}`);

      // Verify documents exist after insert
      const ids = newDocuments.map(d => d._id);
      const count = await collection.countDocuments({ _id: { $in: ids } });
      logger.info(this.logTag, `Verification: ${count} of ${ids.length} documents found after insert`);
    } catch (error) {
      // Handle duplicate key errors gracefully (in case of race conditions)
      if (error.code === 11000) {
        logger.warn(this.logTag, `Some documents already exist (duplicate key), continuing...`);
        // Count successful inserts
        const successCount = error.result?.insertedCount || 0;
        stats.inserted += successCount;
        stats.skipped += (documents.length - successCount);
      } else {
        logger.error(this.logTag, `Batch insert error: ${error.message}`);
        logger.error(this.logTag, `Stack: ${error.stack}`);
        stats.errors += documents.length;
      }
    }
  }
}

export const lessonReverseSyncer = new LessonReverseSyncer();
