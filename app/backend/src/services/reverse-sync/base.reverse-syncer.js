import { supabaseAdmin } from '../../config/database.js';
import { getMongoConnection } from '../../config/mongoConnection.js';
import logger from '../../utils/logger.js';
import { BATCH_SIZE, createStats, finalizeStats, logProgress, tallyGroup } from './helpers.js';

const PAGE_SIZE = 1000;

/**
 * Base class for reverse sync operations (Supabase → MongoDB)
 */
export class BaseReverseSyncer {
  constructor(options) {
    this.supabaseTable = options.supabaseTable;
    this.mongoCollection = options.mongoCollection;
    this.logTag = options.logTag || 'SYNC';
  }

  /**
   * Fetch all data from Supabase table with pagination
   */
  async fetchSupabaseData(selectQuery = '*') {
    const allData = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await supabaseAdmin
        .from(this.supabaseTable)
        .select(selectQuery)
        .range(from, to);

      if (error) {
        throw new Error(`Failed to fetch from ${this.supabaseTable}: ${error.message}`);
      }

      if (data && data.length > 0) {
        allData.push(...data);
        hasMore = data.length === PAGE_SIZE;
        page++;
      } else {
        hasMore = false;
      }
    }

    return allData;
  }

  /**
   * Load existing document IDs from MongoDB collection
   */
  async loadExistingIds() {
    const collection = getMongoConnection().collection(this.mongoCollection);
    const cursor = collection.find({}, { projection: { _id: 1 } });
    const existingIds = new Set();

    for await (const doc of cursor) {
      existingIds.add(doc._id.toString());
    }

    return existingIds;
  }

  /**
   * Batch insert documents to MongoDB (skip existing records). Each document
   * may carry a transient `__groupKey` field (added by `sync()`); we use it
   * to attribute the insert/skip to a per-group bucket and strip it before
   * sending to MongoDB.
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

      // Insert only new documents (strip the transient __groupKey/__groupLabel fields)
      const now = new Date();
      const documentsToInsert = newDocuments.map(({ __groupKey, __groupLabel, ...doc }) => ({
        ...doc,
        created_at: now,
        updated_at: now,
      }));

      const result = await collection.insertMany(documentsToInsert, { ordered: false });
      stats.inserted += result.insertedCount;
      for (const doc of newDocuments) tallyGroup(stats, 'inserted', doc.__groupKey, doc.__groupLabel);
      logger.info(this.logTag, `Batch result - Inserted: ${result.insertedCount}, Skipped: ${skippedCount}`);
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

  /**
   * Transform a Supabase item to MongoDB document
   * Must be implemented by subclass
   */
  transformItem(item, context) {
    throw new Error('transformItem must be implemented by subclass');
  }

  /**
   * Hook called before sync to load reference data
   * Can be overridden by subclass
   */
  async preSyncHook(context) {
    return context;
  }

  /**
   * Optional hook for subclasses: derive a grouping key for the per-group
   * stats breakdown (e.g. chapter_id for lessons, parent exercise_id for
   * lesson_items). Returning `null` / `undefined` buckets the row under
   * "_unknown".
   */
  getGroupKey(/* sourceItem, context */) {
    return null;
  }

  /**
   * Optional hook: human-readable label for the group (e.g. chapter name).
   * Stored once per group key in `stats.byGroup.labels` so the run summary
   * can render it next to the ID.
   */
  getGroupLabel(/* sourceItem, context */) {
    return null;
  }

  /**
   * Main sync orchestration method
   */
  async sync() {
    const stats = createStats();
    const context = {};

    try {
      logger.info(this.logTag, `Starting sync: ${this.supabaseTable} → ${this.mongoCollection}`);

      // Pre-sync hook for loading reference data
      await this.preSyncHook(context);

      // Fetch all data from Supabase
      const supabaseData = await this.fetchSupabaseData();
      stats.total = supabaseData.length;
      logger.info(this.logTag, `Fetched ${stats.total} records from Supabase`);

      if (stats.total === 0) {
        logger.info(this.logTag, 'No records to sync');
        return finalizeStats(stats);
      }

      // Transform and batch upsert
      let batch = [];
      let skippedNoRefId = 0;
      let skippedNullTransform = 0;

      for (const item of supabaseData) {
        try {
          const groupKey = this.getGroupKey(item, context);
          const groupLabel = this.getGroupLabel(item, context);

          // Skip items without ref_id
          if (!item.ref_id) {
            skippedNoRefId++;
            stats.skipped++;
            tallyGroup(stats, 'skipped', groupKey, groupLabel);
            continue;
          }

          const document = this.transformItem(item, context);
          if (document) {
            // Tag the document so batchUpsert can attribute insert/skip
            // back to the right group bucket. Stripped before mongo insert.
            document.__groupKey = groupKey;
            document.__groupLabel = groupLabel;
            batch.push(document);
          } else {
            skippedNullTransform++;
            stats.skipped++;
            tallyGroup(stats, 'skipped', groupKey, groupLabel);
          }

          if (batch.length >= BATCH_SIZE) {
            await this.batchUpsert(batch, stats);
            batch = [];
            logProgress(logger, this.logTag, 'Progress', stats);
          }
        } catch (error) {
          logger.error(this.logTag, `Error transforming item ${item.id} (ref_id: ${item.ref_id}): ${error.message}`);
          logger.error(this.logTag, `Stack: ${error.stack}`);
          stats.errors++;
        }
      }

      // Process remaining batch
      logger.info(this.logTag, `Batch size before final upsert: ${batch.length}`);
      if (batch.length > 0) {
        await this.batchUpsert(batch, stats);
      }

      logger.info(this.logTag, `Skipped stats - No ref_id: ${skippedNoRefId}, Null transform: ${skippedNullTransform}`);
      if (skippedNoRefId > 0) {
        logger.warn(this.logTag, `Skipped ${skippedNoRefId} items with no ref_id`);
      }
      if (skippedNullTransform > 0) {
        logger.warn(this.logTag, `Skipped ${skippedNullTransform} items with null transform result`);
      }

      finalizeStats(stats);
      logger.success(this.logTag, `Sync complete - Inserted: ${stats.inserted}, Skipped (existing): ${stats.skipped}, Errors: ${stats.errors}, Duration: ${stats.duration}`);

      return stats;
    } catch (error) {
      logger.error(this.logTag, `Sync failed: ${error.message}`);
      throw error;
    }
  }
}
