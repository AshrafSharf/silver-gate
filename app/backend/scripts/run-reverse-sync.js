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

    const printBreakdown = (label, bucket, labels = {}) => {
      const entries = Object.entries(bucket || {}).sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) return;
      console.log(`  ${label}:`);
      // Width the label column to the longest label we'll print.
      const labelWidth = Math.max(0, ...entries.map(([k]) => (labels[k] || '').length));
      for (const [key, count] of entries) {
        const lbl = (labels[key] || '').padEnd(labelWidth);
        const sep = labelWidth > 0 ? '  ' : '';
        console.log(`    ${lbl}${sep}${key.padEnd(38)} ${count}`);
      }
    };

    if (results.lessons) {
      console.log('Lessons → Exercises:');
      console.log(`  Total:             ${results.lessons.total}`);
      console.log(`  Inserted (new):    ${results.lessons.inserted}`);
      console.log(`  Skipped (exists):  ${results.lessons.skipped}`);
      console.log(`  Errors:            ${results.lessons.errors}`);
      console.log(`  Duration:          ${results.lessons.duration}`);
      printBreakdown('Inserted by chapter_id', results.lessons.byGroup?.inserted, results.lessons.byGroup?.labels);
      printBreakdown('Skipped by chapter_id', results.lessons.byGroup?.skipped, results.lessons.byGroup?.labels);
      console.log('');
    }

    if (results.lessonItems) {
      console.log('Lesson Items → Exercise Items:');
      console.log(`  Total:             ${results.lessonItems.total}`);
      console.log(`  Inserted (new):    ${results.lessonItems.inserted}`);
      console.log(`  Skipped (exists):  ${results.lessonItems.skipped}`);
      console.log(`  Errors:            ${results.lessonItems.errors}`);
      console.log(`  Duration:          ${results.lessonItems.duration}`);
      printBreakdown('Inserted by exercise_id', results.lessonItems.byGroup?.inserted, results.lessonItems.byGroup?.labels);
      printBreakdown('Skipped by exercise_id', results.lessonItems.byGroup?.skipped, results.lessonItems.byGroup?.labels);
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
