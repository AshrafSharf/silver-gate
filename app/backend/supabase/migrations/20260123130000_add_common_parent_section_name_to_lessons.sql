-- Migration: Add common_parent_section_name column to lessons table
-- Created at: 2026-01-23

-- Add common_parent_section_name column (similar to name field)
ALTER TABLE lessons
ADD COLUMN IF NOT EXISTS common_parent_section_name VARCHAR(255);
