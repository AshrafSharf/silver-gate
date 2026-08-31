import { supabaseAdmin } from '../../../config/database.js';
import { getMongoConnection } from '../../../config/mongoConnection.js';
import { BaseReverseSyncer } from '../base.reverse-syncer.js';
import { toObjectId, toDBRef, tallyGroup } from '../helpers.js';
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

    // Load chapter ref_ids and human-readable labels for the run summary.
    const { data: chapters, error: chaptersError } = await supabaseAdmin
      .from('chapters')
      .select('id, ref_id, name, display_name, chapter_number');

    if (chaptersError) {
      throw new Error(`Failed to fetch chapters: ${chaptersError.message}`);
    }

    context.chapterRefIds = {};
    context.chapterLabels = {};
    for (const chapter of chapters || []) {
      if (chapter.ref_id) {
        context.chapterRefIds[chapter.id] = chapter.ref_id;
      }
      const label = chapter.display_name || chapter.name || null;
      if (label) {
        context.chapterLabels[chapter.id] = chapter.chapter_number
          ? `Ch ${chapter.chapter_number}: ${label}`
          : label;
      }
    }

    return context;
  }

  /**
   * Per-group key: bucket inserts/skips by source chapter_id so the run
   * summary can show "chapter X: N lessons inserted".
   */
  getGroupKey(item /* , context */) {
    return item.chapter_id || null;
  }

  /**
   * Human-readable label: "Ch 3: Algebra Basics".
   */
  getGroupLabel(item, context) {
    return context?.chapterLabels?.[item.chapter_id] || null;
  }

  /**
   * Transform a lesson to an exercise document
   */
  transformItem(item, context) {
    const bookRefId = context.bookRefIds[item.book_id];
    const chapterRefId = context.chapterRefIds[item.chapter_id];

    // If lesson name follows "Questions <min>-<max>" (e.g. "Questions 11-20",
    // optionally with trailing period/whitespace), strip the range out of the
    // name and use it as the index. Otherwise fall back to the stored fields.
    const rangeMatch = typeof item.name === 'string'
      ? item.name.match(/^(Questions)\s+(\d+)\s*-\s*(\d+)\s*\.?\s*$/)
      : null;
    const name = rangeMatch ? rangeMatch[1] : item.name;

    // An Academic Book lesson is a textbook block and carries its own identity:
    // the printed number ("1.1", "1 - 4"), its kind, and its position among
    // blocks of that kind. Lesson creation stores that under `block` in the
    // otherwise-unused question_solution_json column. A Question Bank lesson has
    // no block, so it keeps the previous behaviour — question_range as the
    // index, the chapter-wide display_order, and type EXAMPLE.
    //
    // Getting `type` from the block is not cosmetic: this collection is uniquely
    // keyed on (order, chapter, type) and `batchUpsert` deletes rows that
    // collide on it. Writing every lesson as EXAMPLE made a chapter's exercises
    // and examples contend for the same key.
    const block = item.question_solution_json?.block || null;

    const index = rangeMatch
      ? `${rangeMatch[2]}-${rangeMatch[3]}`
      : block?.index || item.question_range;

    const document = {
      _id: toObjectId(item.ref_id),
      name,
      index,
      order: block?.order ?? item.display_order,
      common_parent_section_name: item.common_parent_section_name,
      parent_section_name: item.parent_section_name,
      toc_output_json: item.toc_output_json,
      toc_status: 'COMPLETED',
      toc_prompt: item.name,
      type: block?.type || 'EXAMPLE',
      book: bookRefId ? toDBRef('book', bookRefId) : null,
      chapter: chapterRefId ? toDBRef('chapter', chapterRefId) : null,
    };

    // Page numbers are optional in the annotation, so only send them when the
    // source actually recorded them rather than writing nulls over the field.
    if (block?.start_page !== null && block?.start_page !== undefined) {
      document.start_page = block.start_page;
    }
    if (block?.end_page !== null && block?.end_page !== undefined) {
      document.end_page = block.end_page;
    }

    return document;
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
      const skippedDocuments = documents.filter(doc => existingIds.has(doc._id.toString()));
      const skippedCount = skippedDocuments.length;

      if (skippedCount > 0) {
        logger.info(this.logTag, `Skipping ${skippedCount} existing records`);
        stats.skipped += skippedCount;
        for (const doc of skippedDocuments) tallyGroup(stats, 'skipped', doc.__groupKey, doc.__groupLabel);
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

      // Insert only new documents (strip the transient __groupKey/__groupLabel fields)
      const now = new Date();
      const documentsToInsert = newDocuments.map(({ __groupKey, __groupLabel, ...doc }) => ({
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
      for (const doc of newDocuments) tallyGroup(stats, 'inserted', doc.__groupKey, doc.__groupLabel);
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
