import { connectToMongoDB, disconnectFromMongoDB } from '../../config/mongoConnection.js';
import logger from '../../utils/logger.js';
import { lessonReverseSyncer, lessonItemReverseSyncer } from './syncers/index.js';

export const reverseSyncService = {
  /**
   * Sync all data from Supabase to MongoDB
   * Order matters: lessons first, then lesson items
   */
  async syncAll() {
    const results = {
      lessons: null,
      lessonItems: null,
      success: false,
    };

    try {
      logger.info('REVERSE_SYNC', '='.repeat(50));
      logger.info('REVERSE_SYNC', 'Starting SilverGate → MongoDB Reverse Sync');
      logger.info('REVERSE_SYNC', '='.repeat(50));

      // Connect to MongoDB
      await connectToMongoDB();

      // Sync lessons first (exercises depend on nothing else in this sync)
      logger.info('REVERSE_SYNC', '');
      logger.info('REVERSE_SYNC', '--- Syncing Lessons → Exercises ---');
      results.lessons = await lessonReverseSyncer.sync();

      // Sync lesson items (exercise_items depend on exercises)
      logger.info('REVERSE_SYNC', '');
      logger.info('REVERSE_SYNC', '--- Syncing Lesson Items → Exercise Items ---');
      results.lessonItems = await lessonItemReverseSyncer.sync();

      results.success = true;

      logger.info('REVERSE_SYNC', '');
      logger.info('REVERSE_SYNC', '='.repeat(50));
      logger.success('REVERSE_SYNC', 'Reverse sync completed successfully');
      logger.info('REVERSE_SYNC', '='.repeat(50));

      return results;
    } catch (error) {
      logger.error('REVERSE_SYNC', `Reverse sync failed: ${error.message}`);
      throw error;
    } finally {
      // Always disconnect from MongoDB
      await disconnectFromMongoDB();
    }
  },

  /**
   * Sync only lessons
   */
  async syncLessons() {
    try {
      await connectToMongoDB();
      const result = await lessonReverseSyncer.sync();
      return result;
    } finally {
      await disconnectFromMongoDB();
    }
  },

  /**
   * Sync only lesson items
   */
  async syncLessonItems() {
    try {
      await connectToMongoDB();
      const result = await lessonItemReverseSyncer.sync();
      return result;
    } finally {
      await disconnectFromMongoDB();
    }
  },
};

export default reverseSyncService;
