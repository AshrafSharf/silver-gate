-- Migration: Add index column to lesson_items table
-- Description: Adds an 'index' column to store the sequential ID from toc_question_items JSON
-- Date: 2026-01-28

-- Add index column to lesson_items table
ALTER TABLE lesson_items
ADD COLUMN IF NOT EXISTS index TEXT;

-- Backfill existing records: set index based on position (position is 0-indexed, index should be 1-indexed string)
UPDATE lesson_items
SET index = (position + 1)::TEXT
WHERE index IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN lesson_items.index IS 'Sequential ID from toc_question_items JSON (1, 2, 3, ...). Maps to exercise_item.index in MongoDB.';
