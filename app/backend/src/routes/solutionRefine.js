import { Router } from 'express';
import { solutionRefinerService } from '../services/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// List a chapter's exercises (with solution counts) so the UI can scope a
// refinement to a single exercise.
router.get('/chapter/:chapterId/exercises', asyncHandler(async (req, res) => {
  const exercises = await solutionRefinerService.listExercises(req.params.chapterId);
  res.json({ success: true, data: exercises });
}));

// Start a background job that refines solutions in a chapter via DeepSeek and
// saves the refined output back to MongoDB. Optionally scoped to one exercise
// via body { exerciseId }. Returns immediately.
router.post('/chapter/:chapterId', asyncHandler(async (req, res) => {
  const { exerciseId } = req.body || {};
  const job = await solutionRefinerService.startChapterRefinement(req.params.chapterId, exerciseId || null);
  res.status(202).json({ success: true, data: job });
}));

// Latest job for a chapter (optionally a specific exercise via ?exerciseId=) —
// lets the UI resume showing progress after a reload.
router.get('/chapter/:chapterId/job', asyncHandler(async (req, res) => {
  const job = solutionRefinerService.getJobForScope(req.params.chapterId, req.query.exerciseId || null);
  res.json({ success: true, data: job });
}));

// Poll a specific job's progress.
router.get('/jobs/:jobId', asyncHandler(async (req, res) => {
  const job = solutionRefinerService.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }
  res.json({ success: true, data: job });
}));

export default router;
