-- Add toc_output_json column to lessons table
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS toc_output_json jsonb;
