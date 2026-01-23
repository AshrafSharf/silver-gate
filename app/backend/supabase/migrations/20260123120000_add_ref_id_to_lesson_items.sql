-- Migration: Add ref_id column to lesson_items for MongoDB sync
-- Created at: 2026-01-23

-- Add ref_id column (24-character hex string for MongoDB ObjectId compatibility)
-- Nullable in DB to allow existing rows, but required for new items via application code
ALTER TABLE lesson_items
ADD COLUMN IF NOT EXISTS ref_id VARCHAR(24);

-- Create unique index on ref_id (partial index excludes NULL values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_lesson_items_ref_id ON lesson_items(ref_id) WHERE ref_id IS NOT NULL;
