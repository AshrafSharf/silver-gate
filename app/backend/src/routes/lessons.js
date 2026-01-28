import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import http from 'http';
import { lessonsService } from '../services/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * Download an image from a URL and save it to a file
 * @param {string} imageUrl - URL of the image to download
 * @param {string} destPath - Destination file path
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
async function downloadImage(imageUrl, destPath) {
  return new Promise((resolve) => {
    try {
      const protocol = imageUrl.startsWith('https') ? https : http;

      protocol.get(imageUrl, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          downloadImage(response.headers.location, destPath).then(resolve);
          return;
        }

        if (response.statusCode !== 200) {
          console.error(`Failed to download image: HTTP ${response.statusCode}`);
          resolve(false);
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks);
            await fs.writeFile(destPath, buffer);
            resolve(true);
          } catch (err) {
            console.error(`Failed to write image: ${err.message}`);
            resolve(false);
          }
        });
        response.on('error', (err) => {
          console.error(`Download error: ${err.message}`);
          resolve(false);
        });
      }).on('error', (err) => {
        console.error(`Request error: ${err.message}`);
        resolve(false);
      });
    } catch (err) {
      console.error(`Download exception: ${err.message}`);
      resolve(false);
    }
  });
}

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

// Create a new lesson (or multiple lessons if lesson_item_count or range_configs is provided)
router.post('/', asyncHandler(async (req, res) => {
  const { name, common_parent_section_name, parent_section_name, lesson_item_count, range_configs, question_set_id, solution_set_id, items, question_type } = req.body;
  console.log('POST /lessons - question_type:', question_type);
  console.log('POST /lessons - range_configs:', JSON.stringify(range_configs, null, 2));

  // Name is required for Auto Split mode, not for Manual Range mode (which has lesson_name per range)
  if (!range_configs && (!name || !name.trim())) {
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

  // Validate range_configs if provided
  if (range_configs) {
    if (!Array.isArray(range_configs)) {
      return res.status(400).json({
        success: false,
        error: 'range_configs must be an array',
      });
    }

    if (range_configs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'range_configs must have at least one range',
      });
    }

    // Get total items count from provided items or will be validated in service
    const totalItems = items?.length || 0;
    if (totalItems > 0 && range_configs.length > totalItems) {
      return res.status(400).json({
        success: false,
        error: `Number of ranges (${range_configs.length}) cannot exceed total items (${totalItems})`,
      });
    }

    for (let i = 0; i < range_configs.length; i++) {
      const config = range_configs[i];

      // Validate lesson_name is provided
      if (!config.lesson_name || !config.lesson_name.trim()) {
        return res.status(400).json({
          success: false,
          error: `Range ${i + 1}: lesson_name is required`,
        });
      }

      if (typeof config.start !== 'number' || typeof config.end !== 'number') {
        return res.status(400).json({
          success: false,
          error: `Range ${i + 1}: start and end must be numbers`,
        });
      }
      if (config.start < 1) {
        return res.status(400).json({
          success: false,
          error: `Range ${i + 1}: start must be >= 1`,
        });
      }
      if (config.start > config.end) {
        return res.status(400).json({
          success: false,
          error: `Range ${i + 1}: start must be <= end`,
        });
      }
    }

    // Check for overlapping ranges
    const sortedRanges = [...range_configs].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sortedRanges.length; i++) {
      if (sortedRanges[i].start <= sortedRanges[i - 1].end) {
        return res.status(400).json({
          success: false,
          error: `Ranges overlap: ${sortedRanges[i - 1].start}-${sortedRanges[i - 1].end} and ${sortedRanges[i].start}-${sortedRanges[i].end}`,
        });
      }
    }
  }

  try {
    const lessons = await lessonsService.create({
      name: name?.trim() || null,
      common_parent_section_name: common_parent_section_name?.trim() || null,
      parent_section_name: parent_section_name?.trim() || null,
      lesson_item_count: lesson_item_count ? parseInt(lesson_item_count, 10) : null,
      range_configs: range_configs || null,
      question_set_id,
      solution_set_id,
      items, // Optional: pre-edited items from the prepare modal
      question_type: question_type || 'OTHER',
    });

    res.status(201).json({ success: true, data: lessons });
  } catch (error) {
    console.error('Error creating lesson:', error);
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

// Create folders for multiple lessons (all items directly in basePath)
router.post('/create-folders', asyncHandler(async (req, res) => {
  const { lessonIds, basePath } = req.body;

  if (!basePath || !basePath.trim()) {
    return res.status(400).json({
      success: false,
      error: 'basePath is required',
    });
  }

  if (!lessonIds || !Array.isArray(lessonIds) || lessonIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'lessonIds array is required',
    });
  }

  try {
    const trimmedBasePath = basePath.trim();
    const createdFolders = [];
    const lessonsSummary = [];

    // Create the base folder
    await fs.mkdir(trimmedBasePath, { recursive: true });

    // Process each lesson and collect all items
    for (const lessonId of lessonIds) {
      const lesson = await lessonsService.findById(lessonId);
      if (!lesson) {
        lessonsSummary.push({
          lessonId,
          lessonName: null,
          success: false,
          error: 'Lesson not found',
          itemsCreated: 0,
        });
        continue;
      }

      let itemsCreated = 0;

      // Create folders for each lesson item directly in basePath
      for (const item of lesson.lesson_items || []) {
        const questionLabel = item.question_label || item.position || 'unknown';
        const itemFolderName = `question_${questionLabel}`;
        const itemFolderPath = path.join(trimmedBasePath, itemFolderName);

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

        const filesCreated = ['empty.txt', 'problem_statement.txt', 'solution_context.txt'];

        // Download visual.png if visual_path exists in the JSON
        const visualPath = item.question_solution_item_json?.visual_path;
        if (visualPath && typeof visualPath === 'string' && visualPath.trim()) {
          const visualDestPath = path.join(itemFolderPath, 'visual.png');
          const downloaded = await downloadImage(visualPath.trim(), visualDestPath);
          if (downloaded) {
            filesCreated.push('visual.png');
          }
        }

        // Create step_solutions subfolder
        const stepSolutionsPath = path.join(itemFolderPath, 'step_solutions');
        await fs.mkdir(stepSolutionsPath, { recursive: true });

        // Create empty.txt inside step_solutions with the same ref_id content
        await fs.writeFile(
          path.join(stepSolutionsPath, 'empty.txt'),
          item.ref_id || '',
          'utf-8'
        );

        filesCreated.push('step_solutions/empty.txt');

        createdFolders.push({
          folder: itemFolderName,
          path: itemFolderPath,
          questionLabel,
          lessonName: lesson.name,
          files: filesCreated,
        });

        itemsCreated++;
      }

      lessonsSummary.push({
        lessonId,
        lessonName: lesson.name,
        success: true,
        itemsCreated,
      });
    }

    res.json({
      success: true,
      data: {
        basePath: trimmedBasePath,
        lessonsProcessed: lessonsSummary.length,
        totalFoldersCreated: createdFolders.length,
        lessonsSummary,
        createdFolders,
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
