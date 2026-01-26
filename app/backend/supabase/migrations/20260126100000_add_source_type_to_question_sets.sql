-- Add source_type column to question_sets table
-- This column indicates the type of source material (Question Bank, Academic Book)
-- which determines which parsing instructions to use during extraction

ALTER TABLE question_sets
ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) DEFAULT 'Question Bank'
CHECK (source_type IN ('Question Bank', 'Academic Book'));

-- Add index for source_type
CREATE INDEX IF NOT EXISTS idx_question_sets_source_type ON question_sets(source_type);
