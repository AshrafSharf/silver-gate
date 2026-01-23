import { Router } from 'express';
import { lessonsService } from '../services/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Get all lessons
router.get('/', asyncHandler(async (req, res) => {
  const { bookId, chapterId } = req.query;
  const lessons = await lessonsService.getAll({ bookId, chapterId });
  res.json({ success: true, data: lessons });
}));

// Get lesson by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const lesson = await lessonsService.findById(req.params.id);
  if (!lesson) {
    return res.status(404).json({ success: false, error: 'Lesson not found' });
  }
  res.json({ success: true, data: lesson });
}));

// Create a new lesson
router.post('/', asyncHandler(async (req, res) => {
  const { name, question_set_id, solution_set_id } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Lesson name is required',
    });
  }

  if (!question_set_id) {
    return res.status(400).json({
      success: false,
      error: 'question_set_id is required',
    });
  }

  if (!solution_set_id) {
    return res.status(400).json({
      success: false,
      error: 'solution_set_id is required',
    });
  }

  try {
    const lesson = await lessonsService.create({
      name: name.trim(),
      question_set_id,
      solution_set_id,
    });

    res.status(201).json({ success: true, data: lesson });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}));

// Update a lesson (name only)
router.put('/:id', asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      error: 'Lesson name is required',
    });
  }

  const lesson = await lessonsService.update(req.params.id, { name: name.trim() });
  res.json({ success: true, data: lesson });
}));

// Update a single lesson item
router.put('/:lessonId/items/:itemId', asyncHandler(async (req, res) => {
  const { question_solution_item_json } = req.body;

  if (!question_solution_item_json) {
    return res.status(400).json({
      success: false,
      error: 'question_solution_item_json is required',
    });
  }

  const item = await lessonsService.updateLessonItem(req.params.itemId, {
    question_solution_item_json,
  });

  res.json({ success: true, data: item });
}));

// Delete a lesson item
router.delete('/:lessonId/items/:itemId', asyncHandler(async (req, res) => {
  await lessonsService.deleteLessonItem(req.params.itemId);
  res.json({ success: true, message: 'Lesson item deleted successfully' });
}));

// Delete a lesson
router.delete('/:id', asyncHandler(async (req, res) => {
  await lessonsService.delete(req.params.id);
  res.json({ success: true, message: 'Lesson deleted successfully' });
}));

export default router;
