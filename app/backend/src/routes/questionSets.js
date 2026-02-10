import { Router } from 'express';
import { questionExtractionService, EXTRACTION_PROVIDERS } from '../services/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Get all question sets
router.get('/', asyncHandler(async (req, res) => {
  const { bookId, chapterId } = req.query;
  const questionSets = await questionExtractionService.getAll({ bookId, chapterId });
  res.json({ success: true, data: questionSets });
}));

// Manual import - create question set from JSON (must be before /:id routes)
router.post('/import', asyncHandler(async (req, res) => {
  const { name, bookId, chapterId, questions } = req.body;

  console.log('[IMPORT] Received import request:', {
    name,
    bookId: bookId || '(none)',
    chapterId: chapterId || '(none)',
    questionsType: typeof questions,
    hasQuestions: !!questions,
  });

  if (!questions) {
    return res.status(400).json({
      success: false,
      error: 'questions field is required',
    });
  }

  // Parse questions if it's a string
  let parsedQuestions = questions;
  if (typeof questions === 'string') {
    try {
      parsedQuestions = JSON.parse(questions);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON format for questions',
      });
    }
  }

  // Validate questions structure
  if (!parsedQuestions.questions || !Array.isArray(parsedQuestions.questions)) {
    return res.status(400).json({
      success: false,
      error: 'questions must have a "questions" array property',
    });
  }

  console.log('[IMPORT] Validated questions count:', parsedQuestions.questions.length);

  try {
    const questionSet = await questionExtractionService.createManualQuestionSet({
      name,
      bookId,
      chapterId,
      questions: parsedQuestions,
    });

    console.log('[IMPORT] Successfully created question set:', questionSet.id);
    res.status(201).json({ success: true, data: questionSet });
  } catch (error) {
    console.error('[IMPORT] Error creating question set:', error.message);
    console.error('[IMPORT] Error details:', error);
    throw error;
  }
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
  const { item_ids, name, type, provider } = req.body;

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
  const validProviders = Object.values(EXTRACTION_PROVIDERS);
  const extractionProvider = provider || EXTRACTION_PROVIDERS.LLAMAPARSE;
  if (provider && !validProviders.includes(provider)) {
    return res.status(400).json({
      success: false,
      error: `provider must be one of: ${validProviders.join(', ')}`,
    });
  }

  // Create the question set
  const questionSet = await questionExtractionService.createQuestionSet(item_ids, { name, type });

  // Start extraction asynchronously (don't wait)
  questionExtractionService.extractQuestions(questionSet.id, extractionProvider).catch((err) => {
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
