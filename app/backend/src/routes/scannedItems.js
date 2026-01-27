import { Router } from 'express';
import multer from 'multer';
import { scannedItemService } from '../services/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Configure multer for memory storage (files stored in buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
});

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

  const filename = item.item_data || 'document.pdf';
  console.log(`[PDF] Fetching PDF for item ${req.params.id}, scan_type: ${item.scan_type}, has content: ${!!item.content}, content type: ${typeof item.content}`);

  // If content is stored as binary (BYTEA for email attachments)
  // Supabase returns BYTEA as base64 string or hex format
  if (item.content) {
    try {
      let pdfBuffer;
      if (Buffer.isBuffer(item.content)) {
        pdfBuffer = item.content;
      } else if (typeof item.content === 'string') {
        // Check if it's hex format (starts with \x)
        if (item.content.startsWith('\\x')) {
          const hexString = item.content.slice(2);
          const decodedFromHex = Buffer.from(hexString, 'hex');

          // Check if the hex-decoded content is base64-encoded PDF
          // Base64-encoded PDF starts with "JVBER" (which is "%PDF" in base64)
          const hexDecodedStr = decodedFromHex.toString('utf8');
          if (hexDecodedStr.startsWith('JVBER')) {
            console.log(`[PDF] Detected double-encoding: hex -> base64. Decoding base64...`);
            pdfBuffer = Buffer.from(hexDecodedStr, 'base64');
          } else {
            // Direct hex to binary
            pdfBuffer = decodedFromHex;
          }
        } else if (item.content.startsWith('JVBER')) {
          // Direct base64-encoded PDF (starts with "JVBER" = "%PDF" in base64)
          console.log(`[PDF] Detected base64-encoded PDF`);
          pdfBuffer = Buffer.from(item.content, 'base64');
        } else {
          // Supabase returns BYTEA as base64 string
          pdfBuffer = Buffer.from(item.content, 'base64');
        }
      } else if (item.content instanceof Uint8Array) {
        pdfBuffer = Buffer.from(item.content);
      } else if (typeof item.content === 'object' && item.content.type === 'Buffer' && Array.isArray(item.content.data)) {
        // Handle JSON-serialized Buffer: {type: "Buffer", data: [...]}
        console.log(`[PDF] Handling JSON-serialized Buffer format`);
        pdfBuffer = Buffer.from(item.content.data);
      } else {
        throw new Error(`Unknown content format: ${typeof item.content}`);
      }

      // Verify it looks like a PDF (starts with %PDF)
      const header = pdfBuffer.slice(0, 4).toString('utf8');
      console.log(`[PDF] Buffer size: ${pdfBuffer.length}, header: "${header}"`);

      if (header !== '%PDF') {
        console.error(`[PDF] Invalid PDF header: "${header}" (expected "%PDF"). First 20 bytes: ${pdfBuffer.slice(0, 20).toString('hex')}`);
        return res.status(400).json({
          success: false,
          error: `Invalid PDF structure. The file does not appear to be a valid PDF (header: "${header}").`
        });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      return res.send(pdfBuffer);
    } catch (error) {
      console.error(`[PDF] Error decoding content:`, error);
      return res.status(400).json({ success: false, error: `Failed to decode PDF content: ${error.message}` });
    }
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
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
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

// Upload PDF file (uses active job's book/chapter)
router.post('/upload', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No PDF file uploaded' });
  }

  const item = await scannedItemService.createWithFileUpload({
    filename: req.file.originalname,
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
  });

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
