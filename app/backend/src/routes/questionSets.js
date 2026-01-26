import { Router } from 'express';
import { questionExtractionService } from '../services/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Get all question sets
router.get('/', asyncHandler(async (req, res) => {
  const { bookId, chapterId } = req.query;
  const questionSets = await questionExtractionService.getAll({ bookId, chapterId });
  res.json({ success: true, data: questionSets });
}));

// Get question set by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const questionSet = await questionExtractionService.findById(req.params.id);
  if (!questionSet) {
    return res.status(404).json({ success: false, error: 'Question set not found' });
  }
  res.json({ success: true, data: questionSet });
}));

// Get extraction status
router.get('/:id/status', asyncHandler(async (req, res) => {
  const questionSet = await questionExtractionService.findById(req.params.id);
  if (!questionSet) {
    return res.status(404).json({ success: false, error: 'Question set not found' });
  }
  res.json({
    success: true,
    data: {
      id: questionSet.id,
      status: questionSet.status,
      total_questions: questionSet.total_questions,
      error_message: questionSet.error_message,
    },
  });
}));

// Create question set and start extraction
router.post('/extract', asyncHandler(async (req, res) => {
  const { item_ids, name, type } = req.body;

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

  // Create the question set
  const questionSet = await questionExtractionService.createQuestionSet(item_ids, { name, type });

  // Start extraction asynchronously (don't wait)
  questionExtractionService.extractQuestions(questionSet.id).catch((err) => {
    console.error('Extraction error:', err);
  });

  res.status(201).json({ success: true, data: questionSet });
}));

// Delete question set
router.delete('/:id', asyncHandler(async (req, res) => {
  await questionExtractionService.delete(req.params.id);
  res.json({ success: true, message: 'Question set deleted successfully' });
}));

export default router;
