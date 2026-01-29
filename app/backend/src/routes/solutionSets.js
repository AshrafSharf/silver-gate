import { Router } from 'express';
import { solutionExtractionService, SOLUTION_EXTRACTION_PROVIDERS } from '../services/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Get all solution sets
router.get('/', asyncHandler(async (req, res) => {
  const { bookId, chapterId, questionSetId } = req.query;
  const solutionSets = await solutionExtractionService.getAll({ bookId, chapterId, questionSetId });
  res.json({ success: true, data: solutionSets });
}));

// Get solution set by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const solutionSet = await solutionExtractionService.findById(req.params.id);
  if (!solutionSet) {
    return res.status(404).json({ success: false, error: 'Solution set not found' });
  }
  res.json({ success: true, data: solutionSet });
}));

// Get extraction status
router.get('/:id/status', asyncHandler(async (req, res) => {
  const solutionSet = await solutionExtractionService.findById(req.params.id);
  if (!solutionSet) {
    return res.status(404).json({ success: false, error: 'Solution set not found' });
  }
  res.json({
    success: true,
    data: {
      id: solutionSet.id,
      status: solutionSet.status,
      total_solutions: solutionSet.total_solutions,
      error_message: solutionSet.error_message,
    },
  });
}));

// Create solution set and start extraction
router.post('/extract', asyncHandler(async (req, res) => {
  const { item_ids, name, type, question_set_id, provider } = req.body;

  if (!item_ids || !Array.isArray(item_ids) || item_ids.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'item_ids array is required and must not be empty',
    });
  }

  // Validate type if provided
  const validTypes = ['Question Bank', 'Academic Book'];
  if (type && !validTypes.includes(type)) {
    return res.status(400).json({
      success: false,
      error: `type must be one of: ${validTypes.join(', ')}`,
    });
  }

  // Validate provider if provided
  const validProviders = Object.values(SOLUTION_EXTRACTION_PROVIDERS);
  const extractionProvider = provider || SOLUTION_EXTRACTION_PROVIDERS.LLAMAPARSE;
  if (provider && !validProviders.includes(provider)) {
    return res.status(400).json({
      success: false,
      error: `provider must be one of: ${validProviders.join(', ')}`,
    });
  }

  // Create the solution set
  const solutionSet = await solutionExtractionService.createSolutionSet(item_ids, { name, type, question_set_id });

  // Start extraction asynchronously (don't wait)
  solutionExtractionService.extractSolutions(solutionSet.id, extractionProvider).catch((err) => {
    console.error('Solution extraction error:', err);
  });

  res.status(201).json({ success: true, data: solutionSet });
}));

// Link solution set to a question set
router.post('/:id/link', asyncHandler(async (req, res) => {
  const { question_set_id } = req.body;

  if (!question_set_id) {
    return res.status(400).json({
      success: false,
      error: 'question_set_id is required',
    });
  }

  const solutionSet = await solutionExtractionService.linkToQuestionSet(req.params.id, question_set_id);
  res.json({ success: true, data: solutionSet });
}));

// Delete solution set
router.delete('/:id', asyncHandler(async (req, res) => {
  await solutionExtractionService.delete(req.params.id);
  res.json({ success: true, message: 'Solution set deleted successfully' });
}));

export default router;
