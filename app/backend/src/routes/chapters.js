import { Router } from 'express';
import { bookService, chapterService } from '../services/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Get all chapters (optionally filter by book)
router.get('/', asyncHandler(async (req, res) => {
  const { bookId } = req.query;
  const chapters = await chapterService.getAll(bookId);
  res.json({ success: true, data: chapters });
}));

// Get chapters by book ID
router.get('/book/:bookId', asyncHandler(async (req, res) => {
  const chapters = await chapterService.getByBookId(req.params.bookId);
  res.json({ success: true, data: chapters });
}));

// Get chapter by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const chapter = await chapterService.findById(req.params.id);
  if (!chapter) {
    return res.status(404).json({ success: false, error: 'Chapter not found' });
  }
  res.json({ success: true, data: chapter });
}));

// Create chapter
router.post('/', asyncHandler(async (req, res) => {
  const { name, display_name, book_id, chapter_number, position, source_id, ref_id } = req.body;

  if (!name || !book_id) {
    return res.status(400).json({ success: false, error: 'Name and book_id are required' });
  }

  const chapter = await chapterService.create({
    name,
    display_name,
    book_id,
    chapter_number,
    position,
    source_id,
    ref_id,
  });
  res.status(201).json({ success: true, data: chapter });
}));

// Bulk import chapters for a book from an uploaded JSON payload.
// Accepts the camelCase export shape { bookId, chapters: [{ chapterNumber,
// name, displayName, refId }] } and normalizes it to the DB column names.
router.post('/import', asyncHandler(async (req, res) => {
  const { book_id, book_ref_id, chapters } = req.body;

  if (!book_id) {
    return res.status(400).json({ success: false, error: 'book_id is required' });
  }

  if (!Array.isArray(chapters) || chapters.length === 0) {
    return res.status(400).json({ success: false, error: 'chapters must be a non-empty array' });
  }

  // The export file records the ref id of the book it came from. When it is
  // supplied, refuse to import into a different book — importing a chapter
  // list into the wrong book is tedious to unpick after the fact.
  if (book_ref_id) {
    // findById uses .single(), which throws rather than returning null when
    // the id matches nothing — treat that as a plain 404.
    let book;
    try {
      book = await bookService.findById(book_id);
    } catch {
      book = null;
    }

    if (!book) {
      return res.status(404).json({ success: false, error: 'Book not found' });
    }

    if (book.ref_id !== book_ref_id) {
      return res.status(409).json({
        success: false,
        error: `This file was exported for book ${book_ref_id}, but the selected book has ref id ${book.ref_id || '(none)'}`,
      });
    }
  }

  const normalized = [];

  for (let i = 0; i < chapters.length; i++) {
    const raw = chapters[i] || {};
    const name = (raw.name ?? '').toString().trim();

    if (!name) {
      return res.status(400).json({
        success: false,
        error: `Chapter at index ${i} is missing a "name"`,
      });
    }

    const chapterNumber = raw.chapterNumber ?? raw.chapter_number;
    const parsedNumber = chapterNumber === undefined || chapterNumber === null || chapterNumber === ''
      ? null
      : parseInt(chapterNumber, 10);

    if (parsedNumber !== null && Number.isNaN(parsedNumber)) {
      return res.status(400).json({
        success: false,
        error: `Chapter "${name}" has a non-numeric chapterNumber`,
      });
    }

    const refId = (raw.refId ?? raw.ref_id ?? '').toString().trim();

    if (refId && !/^[a-f0-9]{24}$/i.test(refId)) {
      return res.status(400).json({
        success: false,
        error: `Chapter "${name}" has an invalid refId (expected 24 hex characters)`,
      });
    }

    normalized.push({
      name,
      display_name: (raw.displayName ?? raw.display_name ?? '').toString().trim() || name,
      chapter_number: parsedNumber,
      // Fall back to file order so chapters without a number still sort stably.
      position: parsedNumber ?? i + 1,
      ref_id: refId || null,
    });
  }

  const result = await chapterService.bulkImport(book_id, normalized);

  res.status(result.errors.length > 0 && result.created.length === 0 && result.updated.length === 0 ? 400 : 200).json({
    success: true,
    data: {
      created: result.created.length,
      updated: result.updated.length,
      errors: result.errors,
      chapters: [...result.created, ...result.updated],
    },
  });
}));

// Update chapter
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, display_name, chapter_number, position, ref_id } = req.body;
  const chapter = await chapterService.update(req.params.id, {
    name,
    display_name,
    chapter_number,
    position,
    ref_id,
  });
  res.json({ success: true, data: chapter });
}));

// Delete chapter
router.delete('/:id', asyncHandler(async (req, res) => {
  await chapterService.delete(req.params.id);
  res.json({ success: true, message: 'Chapter deleted successfully' });
}));

export default router;
