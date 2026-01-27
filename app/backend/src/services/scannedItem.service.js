import { supabase } from '../config/database.js';
import { jobService } from './job.service.js';
import { mathpixService } from './mathpix.service.js';
import { logger } from '../utils/logger.js';

export const scannedItemService = {
  async getAll(filters = {}) {
    console.log('[ScannedItems] getAll filters:', filters);

    let query = supabase
      .from('scanned_items')
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number)
      `)
      .order('created_at', { ascending: false });

    if (filters.bookId) {
      query = query.eq('book_id', filters.bookId);
    }
    if (filters.chapterId) {
      query = query.eq('chapter_id', filters.chapterId);
    }
    if (filters.itemType) {
      query = query.eq('item_type', filters.itemType);
    }

    const { data, error } = await query;

    console.log('[ScannedItems] Query result:', { count: data?.length, error: error?.message });

    if (error) throw error;
    return data;
  },

  async findById(id) {
    const { data, error } = await supabase
      .from('scanned_items')
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  },

  // Create a scanned item using the active job's book/chapter/item_type
  async create(itemData) {
    // Get active job to get current book/chapter/item_type
    const activeJob = await jobService.getActiveJob();

    if (!activeJob) {
      throw new Error('No active job configured. Please set an active book and chapter first.');
    }

    const { data, error } = await supabase
      .from('scanned_items')
      .insert({
        book_id: activeJob.active_book_id,
        chapter_id: activeJob.active_chapter_id,
        item_type: activeJob.active_item_type || 'question',
        item_data: itemData.item_data,
        scan_type: itemData.scan_type,
        status: itemData.status || 'pending',
        latex_conversion_status: 'pending',
        metadata: itemData.metadata || {},
      })
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number)
      `)
      .single();

    if (error) throw error;

    // Trigger MathPix conversion asynchronously (don't wait for it)
    this.triggerMathPixConversion(data.id, data.item_data, data.scan_type);

    return data;
  },

  // Trigger MathPix conversion in background
  async triggerMathPixConversion(scannedItemId, itemData, scanType, contentBuffer = null) {
    try {
      // Handle email attachments and file uploads with BYTEA content
      if ((scanType === 'email_attachment' || scanType === 'file_upload') && contentBuffer) {
        const base64Content = contentBuffer.toString('base64');
        await mathpixService.convertPdfToLatex(base64Content, scannedItemId);
        return;
      }

      // Only convert PDF or image types
      if (scanType === 'pdf' || scanType === 'image') {
        await mathpixService.convertPdfToLatex(itemData, scannedItemId);
      } else if (scanType === 'url') {
        // Check if URL points to a PDF
        if (itemData.toLowerCase().endsWith('.pdf')) {
          await mathpixService.convertPdfToLatex(itemData, scannedItemId);
        } else {
          // Assume it's an image URL
          const latex = await mathpixService.convertImageToLatex(itemData);
          await mathpixService.updateWithLatex(scannedItemId, latex);
        }
      }
    } catch (error) {
      logger.error('MATHPIX', `Conversion failed: ${error.message}`);
    }
  },

  // Create scanned item from uploaded file (uses active job)
  async createWithFileUpload({ filename, buffer, mimetype }) {
    // Get active job to get current book/chapter/item_type
    const activeJob = await jobService.getActiveJob();

    if (!activeJob) {
      throw new Error('No active job configured. Please set an active book and chapter first.');
    }

    // Store the PDF content as base64 for the BYTEA field
    const base64Content = buffer.toString('base64');

    const { data, error } = await supabase
      .from('scanned_items')
      .insert({
        book_id: activeJob.active_book_id,
        chapter_id: activeJob.active_chapter_id,
        item_type: activeJob.active_item_type || 'question',
        item_data: filename,
        content: base64Content,
        scan_type: 'file_upload',
        status: 'pending',
        latex_conversion_status: 'pending',
        metadata: { mimetype, size: buffer.length },
      })
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number)
      `)
      .single();

    if (error) throw error;

    // Trigger MathPix conversion asynchronously with the buffer
    this.triggerMathPixConversion(data.id, data.item_data, 'file_upload', buffer);

    return data;
  },

  // Create with explicit book/chapter/item_type (override active job)
  async createWithBookChapter(itemData, bookId, chapterId, itemType = 'question') {
    const { data, error } = await supabase
      .from('scanned_items')
      .insert({
        book_id: bookId,
        chapter_id: chapterId,
        item_type: itemType,
        item_data: itemData.item_data,
        scan_type: itemData.scan_type,
        status: itemData.status || 'pending',
        latex_conversion_status: 'pending',
        metadata: itemData.metadata || {},
      })
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number)
      `)
      .single();

    if (error) throw error;

    // Trigger MathPix conversion asynchronously
    this.triggerMathPixConversion(data.id, data.item_data, data.scan_type);

    return data;
  },

  async update(id, itemData) {
    const { data, error } = await supabase
      .from('scanned_items')
      .update({
        item_data: itemData.item_data,
        scan_type: itemData.scan_type,
        status: itemData.status,
        metadata: itemData.metadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(`
        *,
        book:books(id, name, display_name),
        chapter:chapters(id, name, display_name, chapter_number)
      `)
      .single();

    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('scanned_items')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  },

  async getByActiveJob() {
    const activeJob = await jobService.getActiveJob();
    if (!activeJob) return [];

    return this.getAll({
      bookId: activeJob.active_book_id,
      chapterId: activeJob.active_chapter_id,
    });
  },
};

export default scannedItemService;
