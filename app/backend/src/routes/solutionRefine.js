import { Router } from 'express';
import { solutionRefinerService } from '../services/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// List a chapter's common parent sections (with exercise/solution counts) so
// the UI can scope a refinement to one whole section.
router.get('/chapter/:chapterId/common-parents', asyncHandler(async (req, res) => {
  const sections = await solutionRefinerService.listCommonParents(req.params.chapterId);
  res.json({ success: true, data: sections });
}));

// Start a background job that refines solutions in a chapter via DeepSeek and
// saves the refined output back to MongoDB. Optionally scoped to one common
// parent section via body { commonParent }. Returns immediately.
router.post('/chapter/:chapterId', asyncHandler(async (req, res) => {
  const { commonParent } = req.body || {};
  const job = await solutionRefinerService.startChapterRefinement(req.params.chapterId, commonParent || null);
  res.status(202).json({ success: true, data: job });
}));

// Latest job for a chapter (optionally a specific section via ?commonParent=) —
// lets the UI resume showing progress after a reload.
router.get('/chapter/:chapterId/job', asyncHandler(async (req, res) => {
  const job = solutionRefinerService.getJobForScope(req.params.chapterId, req.query.commonParent || null);
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
