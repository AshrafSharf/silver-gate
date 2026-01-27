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
 * Create initial sync stats object
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
  };
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
