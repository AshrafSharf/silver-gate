#!/usr/bin/env node
import 'dotenv/config';
import reverseSyncService from '../src/services/reverse-sync/index.js';

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     SilverGate → MongoDB Reverse Sync            ║');
  console.log('║     lessons → exercise                           ║');
  console.log('║     lesson_items → exercise_item                 ║');
  console.log('╚══════════════════════════════════════════════════╝');
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
      console.log(`  Total:    ${results.lessons.total}`);
      console.log(`  Inserted: ${results.lessons.inserted}`);
      console.log(`  Updated:  ${results.lessons.updated}`);
      console.log(`  Skipped:  ${results.lessons.skipped}`);
      console.log(`  Errors:   ${results.lessons.errors}`);
      console.log(`  Duration: ${results.lessons.duration}`);
      console.log('');
    }

    if (results.lessonItems) {
      console.log('Lesson Items → Exercise Items:');
      console.log(`  Total:    ${results.lessonItems.total}`);
      console.log(`  Inserted: ${results.lessonItems.inserted}`);
      console.log(`  Updated:  ${results.lessonItems.updated}`);
      console.log(`  Skipped:  ${results.lessonItems.skipped}`);
      console.log(`  Errors:   ${results.lessonItems.errors}`);
      console.log(`  Duration: ${results.lessonItems.duration}`);
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
