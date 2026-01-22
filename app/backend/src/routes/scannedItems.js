import { Router } from 'express';
import { scannedItemService } from '../services/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Get all scanned items (with optional filters)
router.get('/', asyncHandler(async (req, res) => {
  const { bookId, chapterId, itemType } = req.query;
  const items = await scannedItemService.getAll({ bookId, chapterId, itemType });
  res.json({ success: true, data: items });
}));

// Get scanned items for active job
router.get('/active', asyncHandler(async (req, res) => {
  const items = await scannedItemService.getByActiveJob();
  res.json({ success: true, data: items });
}));

// Get scanned item by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const item = await scannedItemService.findById(req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, error: 'Scanned item not found' });
  }
  res.json({ success: true, data: item });
}));

// Get PDF content for viewing
router.get('/:id/pdf', asyncHandler(async (req, res) => {
  const item = await scannedItemService.findById(req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, error: 'Scanned item not found' });
  }

  // If content is stored as binary (BYTEA for email attachments)
  if (item.content) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
    return res.send(item.content);
  }

  // If item_data is a URL, redirect to it
  if (item.item_data && (item.item_data.startsWith('http://') || item.item_data.startsWith('https://'))) {
    return res.redirect(item.item_data);
  }

  // If item_data is base64 encoded
  if (item.item_data) {
    try {
      // Check if it's a data URL or raw base64
      let base64Data = item.item_data;
      if (base64Data.startsWith('data:')) {
        base64Data = base64Data.split(',')[1];
      }
      const pdfBuffer = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
      return res.send(pdfBuffer);
    } catch (error) {
      return res.status(400).json({ success: false, error: 'Invalid PDF data format' });
    }
  }

  return res.status(404).json({ success: false, error: 'No PDF content available' });
}));

// Create scanned item (uses active job's book/chapter)
router.post('/', asyncHandler(async (req, res) => {
  const { item_data, scan_type, status, metadata } = req.body;

  if (!item_data) {
    return res.status(400).json({ success: false, error: 'item_data is required' });
  }

  const item = await scannedItemService.create({
    item_data,
    scan_type,
    status,
    metadata,
  });
  res.status(201).json({ success: true, data: item });
}));

// Create scanned item with explicit book/chapter/item_type
router.post('/manual', asyncHandler(async (req, res) => {
  const { book_id, chapter_id, item_type, item_data, scan_type, status, metadata } = req.body;

  if (!book_id || !chapter_id || !item_data) {
    return res.status(400).json({
      success: false,
      error: 'book_id, chapter_id, and item_data are required',
    });
  }

  const item = await scannedItemService.createWithBookChapter(
    { item_data, scan_type, status, metadata },
    book_id,
    chapter_id,
    item_type || 'question'
  );
  res.status(201).json({ success: true, data: item });
}));

// Update scanned item
router.put('/:id', asyncHandler(async (req, res) => {
  const { item_data, scan_type, status, metadata } = req.body;
  const item = await scannedItemService.update(req.params.id, {
    item_data,
    scan_type,
    status,
    metadata,
  });
  res.json({ success: true, data: item });
}));

// Delete scanned item
router.delete('/:id', asyncHandler(async (req, res) => {
  await scannedItemService.delete(req.params.id);
  res.json({ success: true, message: 'Scanned item deleted successfully' });
}));

export default router;
