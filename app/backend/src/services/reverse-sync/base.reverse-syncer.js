import { supabaseAdmin } from '../../config/database.js';
import { getMongoConnection } from '../../config/mongoConnection.js';
import logger from '../../utils/logger.js';
import { BATCH_SIZE, createStats, finalizeStats, logProgress } from './helpers.js';

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
   * Batch upsert documents to MongoDB
   */
  async batchUpsert(documents, stats) {
    if (documents.length === 0) return;

    const collection = getMongoConnection().collection(this.mongoCollection);

    const operations = documents.map(doc => ({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: doc },
        upsert: true,
      },
    }));

    try {
      const result = await collection.bulkWrite(operations, { ordered: false });
      stats.inserted += result.upsertedCount;
      stats.updated += result.modifiedCount;
    } catch (error) {
      logger.error(this.logTag, `Batch upsert error: ${error.message}`);
      stats.errors += documents.length;
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
      for (const item of supabaseData) {
        try {
          // Skip items without ref_id
          if (!item.ref_id) {
            stats.skipped++;
            continue;
          }

          const document = this.transformItem(item, context);
          if (document) {
            batch.push(document);
          } else {
            stats.skipped++;
          }

          if (batch.length >= BATCH_SIZE) {
            await this.batchUpsert(batch, stats);
            batch = [];
            logProgress(logger, this.logTag, 'Progress', stats);
          }
        } catch (error) {
          logger.error(this.logTag, `Error transforming item ${item.id}: ${error.message}`);
          stats.errors++;
        }
      }

      // Process remaining batch
      if (batch.length > 0) {
        await this.batchUpsert(batch, stats);
      }

      finalizeStats(stats);
      logger.success(this.logTag, `Sync complete - Inserted: ${stats.inserted}, Updated: ${stats.updated}, Skipped: ${stats.skipped}, Errors: ${stats.errors}, Duration: ${stats.duration}`);

      return stats;
    } catch (error) {
      logger.error(this.logTag, `Sync failed: ${error.message}`);
      throw error;
    }
  }
}
