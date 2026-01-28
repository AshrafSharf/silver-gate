#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config({ override: true });
import reverseSyncService from '../src/services/reverse-sync/index.js';

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     SilverGate → MongoDB Reverse Sync            ║');
  console.log('║     lessons → exercise                           ║');
  console.log('║     lesson_items → exercise_item                 ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log('Supabase URL:', process.env.SUPABASE_URL);
  console.log('MongoDB URI: ', process.env.MONGODB_URI);
  console.log('');

  try {
    const results = await reverseSyncService.syncAll();

    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('                    SYNC SUMMARY                    ');
    console.log('═══════════════════════════════════════════════════');
    console.log('');

    if (results.lessons) {
      console.log('Lessons → Exercises:');
      console.log(`  Total:             ${results.lessons.total}`);
      console.log(`  Inserted (new):    ${results.lessons.inserted}`);
      console.log(`  Skipped (exists):  ${results.lessons.skipped}`);
      console.log(`  Errors:            ${results.lessons.errors}`);
      console.log(`  Duration:          ${results.lessons.duration}`);
      console.log('');
    }

    if (results.lessonItems) {
      console.log('Lesson Items → Exercise Items:');
      console.log(`  Total:             ${results.lessonItems.total}`);
      console.log(`  Inserted (new):    ${results.lessonItems.inserted}`);
      console.log(`  Skipped (exists):  ${results.lessonItems.skipped}`);
      console.log(`  Errors:            ${results.lessonItems.errors}`);
      console.log(`  Duration:          ${results.lessonItems.duration}`);
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('Sync failed:', error.message);
    console.error('');
    process.exit(1);
  }
}

main();
