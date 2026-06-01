import { Router } from 'express';
import authRoutes from './auth.js';
import booksRoutes from './books.js';
import chaptersRoutes from './chapters.js';
import jobsRoutes from './jobs.js';
import scannedItemsRoutes from './scannedItems.js';
import questionSetsRoutes from './questionSets.js';
import solutionSetsRoutes from './solutionSets.js';
import driveRoutes from './drive.js';
import lessonsRoutes from './lessons.js';
import solutionRefineRoutes from './solutionRefine.js';

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount routes
router.use('/auth', authRoutes);
router.use('/books', booksRoutes);
router.use('/chapters', chaptersRoutes);
router.use('/jobs', jobsRoutes);
router.use('/scanned-items', scannedItemsRoutes);
router.use('/question-sets', questionSetsRoutes);
router.use('/solution-sets', solutionSetsRoutes);
router.use('/drive', driveRoutes);
router.use('/lessons', lessonsRoutes);
router.use('/solution-refine', solutionRefineRoutes);

export default router;
