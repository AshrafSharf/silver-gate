import { supabase } from '../config/database.js';
import { generateMongoId } from '../utils/mongoId.js';

export const chapterService = {
  async getAll(bookId = null) {
    let query = supabase
      .from('chapters')
      .select('*, books(id, name, display_name)')
      .order('position', { ascending: true });

    if (bookId) {
      query = query.eq('book_id', bookId);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data;
  },

  async findById(id) {
    const { data, error } = await supabase
      .from('chapters')
      .select('*, books(id, name, display_name)')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  },

  async getByBookId(bookId) {
    const { data, error } = await supabase
      .from('chapters')
      .select('*')
      .eq('book_id', bookId)
      .order('position', { ascending: true });

    if (error) throw error;
    return data;
  },

  async create(chapterData) {
    const { data, error } = await supabase
      .from('chapters')
      .insert({
        name: chapterData.name,
        display_name: chapterData.display_name,
        book_id: chapterData.book_id,
        chapter_number: chapterData.chapter_number,
        position: chapterData.position,
        source_id: chapterData.source_id,
        ref_id: chapterData.ref_id || generateMongoId(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Import a list of chapters for a single book from an uploaded JSON payload.
   *
   * Idempotent: an incoming chapter is matched against an existing row by
   * ref_id first, then by name within the same book. Matches are updated,
   * everything else is inserted, so re-uploading a corrected file does not
   * create duplicates.
   *
   * Each row is processed independently — one bad row (e.g. a ref_id already
   * claimed by a chapter in another book) is reported without aborting the
   * rest of the import.
   */
  async bulkImport(bookId, chapters) {
    const created = [];
    const updated = [];
    const errors = [];

    // Existing chapters of this book, for name-based matching.
    const { data: existing, error: existingError } = await supabase
      .from('chapters')
      .select('id, name, ref_id, book_id')
      .eq('book_id', bookId);

    if (existingError) throw existingError;

    const byName = new Map(existing.map((c) => [c.name, c]));

    // ref_id is globally unique across chapters, so look incoming ref_ids up
    // across all books to detect cross-book collisions before inserting.
    const incomingRefIds = chapters.map((c) => c.ref_id).filter(Boolean);
    let byRefId = new Map();

    if (incomingRefIds.length > 0) {
      const { data: refMatches, error: refError } = await supabase
        .from('chapters')
        .select('id, name, ref_id, book_id')
        .in('ref_id', incomingRefIds);

      if (refError) throw refError;
      byRefId = new Map(refMatches.map((c) => [c.ref_id, c]));
    }

    for (let i = 0; i < chapters.length; i++) {
      const incoming = chapters[i];
      const label = incoming.name || `row ${i + 1}`;

      try {
        const match = (incoming.ref_id && byRefId.get(incoming.ref_id)) || byName.get(incoming.name);

        if (match && match.book_id !== bookId) {
          errors.push({
            name: label,
            error: `ref_id ${incoming.ref_id} is already used by a chapter in another book`,
          });
          continue;
        }

        const fields = {
          name: incoming.name,
          display_name: incoming.display_name,
          chapter_number: incoming.chapter_number,
          position: incoming.position,
        };

        if (match) {
          const updateFields = { ...fields };
          if (incoming.ref_id) updateFields.ref_id = incoming.ref_id;

          const { data, error } = await supabase
            .from('chapters')
            .update(updateFields)
            .eq('id', match.id)
            .select()
            .single();

          if (error) throw error;
          updated.push(data);
        } else {
          const { data, error } = await supabase
            .from('chapters')
            .insert({
              ...fields,
              book_id: bookId,
              ref_id: incoming.ref_id || generateMongoId(),
            })
            .select()
            .single();

          if (error) throw error;
          created.push(data);

          // Keep the lookups current so duplicates within the same payload
          // update the row we just inserted instead of inserting again.
          byName.set(data.name, data);
          if (data.ref_id) byRefId.set(data.ref_id, data);
        }
      } catch (err) {
        errors.push({ name: label, error: err.message || 'Failed to import chapter' });
      }
    }

    return { created, updated, errors };
  },

  async update(id, chapterData) {
    const updateFields = {
      name: chapterData.name,
      display_name: chapterData.display_name,
      chapter_number: chapterData.chapter_number,
      position: chapterData.position,
    };

    // Only update ref_id if provided
    if (chapterData.ref_id !== undefined) {
      updateFields.ref_id = chapterData.ref_id;
    }

    const { data, error } = await supabase
      .from('chapters')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('chapters')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  },
};

export default chapterService;
