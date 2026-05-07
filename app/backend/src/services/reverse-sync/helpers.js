import mongoose from 'mongoose';
import { DBRef } from 'mongodb';

export const BATCH_SIZE = 100;

/**
 * Convert a 24-character hex string to a MongoDB ObjectId
 */
export function toObjectId(id) {
  if (!id || typeof id !== 'string' || id.length !== 24) {
    throw new Error(`Invalid ObjectId format: ${id}`);
  }
  return new mongoose.Types.ObjectId(id);
}

/**
 * Create a MongoDB DBRef
 */
export function toDBRef(collection, id) {
  if (!id) {
    return null;
  }
  const objectId = typeof id === 'string' ? toObjectId(id) : id;
  return new DBRef(collection, objectId);
}

/**
 * Create initial sync stats object.
 *
 * `byGroup` carries per-group breakdowns (e.g. inserts grouped by chapter_id
 * for lessons, or by parent exercise_id for lesson_items). Each syncer
 * decides its grouping key by overriding `getGroupKey()`.
 */
export function createStats() {
  return {
    total: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    startTime: Date.now(),
    endTime: null,
    byGroup: {
      inserted: {},
      skipped: {},
      labels: {},
    },
  };
}

/**
 * Increment the per-group counter for a given outcome ("inserted" or
 * "skipped"). Falls back to "_unknown" when the syncer didn't supply a key.
 * If `label` is supplied (e.g. a human-readable chapter name), it is stored
 * once in `stats.byGroup.labels[key]` so the script can render it.
 */
export function tallyGroup(stats, kind, key, label = null) {
  if (!stats.byGroup) return;
  const bucket = stats.byGroup[kind];
  if (!bucket) return;
  const groupKey = key == null || key === '' ? '_unknown' : String(key);
  bucket[groupKey] = (bucket[groupKey] || 0) + 1;
  if (label && stats.byGroup.labels && !stats.byGroup.labels[groupKey]) {
    stats.byGroup.labels[groupKey] = String(label);
  }
}

/**
 * Finalize stats with end time and duration
 */
export function finalizeStats(stats) {
  stats.endTime = Date.now();
  stats.duration = `${((stats.endTime - stats.startTime) / 1000).toFixed(2)}s`;
  return stats;
}

/**
 * Log sync progress
 */
export function logProgress(logger, tag, message, stats = null) {
  if (stats) {
    logger.info(tag, `${message} - Total: ${stats.total}, Inserted: ${stats.inserted}, Updated: ${stats.updated}, Errors: ${stats.errors}`);
  } else {
    logger.info(tag, message);
  }
}
