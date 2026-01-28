import dotenv from 'dotenv';
dotenv.config({ override: true });
import { supabaseAdmin } from '../src/config/database.js';

// Check chapters
const { data: chapters, error: chaptersError } = await supabaseAdmin.from('chapters').select('id, ref_id, name');
if (chaptersError) {
  console.error('Chapters Error:', chaptersError);
} else {
  console.log('Chapters in Supabase:', chapters.length);
  chapters.forEach(r => console.log(`  ${r.id} -> ref_id: ${r.ref_id} (${r.name})`));
}

console.log('');

// Check lessons
const { data, error } = await supabaseAdmin.from('lessons').select('id, ref_id, name, chapter_id, display_order');
if (error) {
  console.error('Error:', error);
} else {
  console.log('Total lessons in Supabase:', data.length);
  console.log('\nRecords:');
  data.forEach(r => console.log(JSON.stringify(r, null, 2)));
}
