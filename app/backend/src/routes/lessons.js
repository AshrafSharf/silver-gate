import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { lessonsService } from '../services/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Get all lessons
router.get('/', asyncHandler(async (req, res) => {
  const { bookId, chapterId } = req.query;
  const lessons = await lessonsService.getAll({ bookId, chapterId });
  res.json({ success: true, data: lessons });
}));

// Prepare lesson (preview merged questions + solutions without creating)
router.post('/prepare', asyncHandler(async (req, res) => {
  const { question_set_id, solution_set_id } = req.body;

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
    const preparedData = await lessonsService.prepare({
      question_set_id,
      solution_set_id,
    });

    res.json({ success: true, data: preparedData });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
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
  const { name, question_set_id, solution_set_id, items } = req.body;

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
      items, // Optional: pre-edited items from the prepare modal
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

// Create folders for a lesson
router.post('/:id/create-folders', asyncHandler(async (req, res) => {
  const { basePath } = req.body;

  if (!basePath || !basePath.trim()) {
    return res.status(400).json({
      success: false,
      error: 'basePath is required',
    });
  }

  // Get the lesson with its items
  const lesson = await lessonsService.findById(req.params.id);
  if (!lesson) {
    return res.status(404).json({ success: false, error: 'Lesson not found' });
  }

  try {
    // Sanitize lesson name for folder name (remove special characters)
    const sanitizedLessonName = lesson.name.replace(/[<>:"/\\|?*]/g, '_').trim();
    const lessonFolderPath = path.join(basePath.trim(), sanitizedLessonName);

    // Create the main lesson folder
    await fs.mkdir(lessonFolderPath, { recursive: true });

    const createdFolders = [];

    // Create folders for each lesson item
    for (const item of lesson.lesson_items || []) {
      const questionLabel = item.question_label || item.position || 'unknown';
      const itemFolderName = `question_${questionLabel}`;
      const itemFolderPath = path.join(lessonFolderPath, itemFolderName);

      // Create the item folder
      await fs.mkdir(itemFolderPath, { recursive: true });

      // Create empty.txt with the lesson_item's ref_id
      await fs.writeFile(
        path.join(itemFolderPath, 'empty.txt'),
        item.ref_id || '',
        'utf-8'
      );

      // Create problem_statement.txt with the problem_statement field
      await fs.writeFile(
        path.join(itemFolderPath, 'problem_statement.txt'),
        item.problem_statement || '',
        'utf-8'
      );

      // Create solution_context.txt with the solution_context field
      await fs.writeFile(
        path.join(itemFolderPath, 'solution_context.txt'),
        item.solution_context || '',
        'utf-8'
      );

      createdFolders.push({
        folder: itemFolderName,
        path: itemFolderPath,
        files: ['empty.txt', 'problem_statement.txt', 'solution_context.txt'],
      });
    }

    res.json({
      success: true,
      data: {
        lessonFolder: lessonFolderPath,
        itemFolders: createdFolders,
        totalFolders: createdFolders.length,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: `Failed to create folders: ${error.message}`,
    });
  }
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
