-- Migration: Add lesson_items table
-- Created at: 2026-01-23

CREATE TABLE IF NOT EXISTS lesson_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    question_label VARCHAR(50),
    problem_statement TEXT,
    solution_context TEXT,
    question_solution_item_json JSONB NOT NULL DEFAULT '{}',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lesson_items_lesson_id ON lesson_items(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_items_question_label ON lesson_items(question_label);
CREATE INDEX IF NOT EXISTS idx_lesson_items_position ON lesson_items(lesson_id, position);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_lesson_items_updated_at ON lesson_items;
CREATE TRIGGER update_lesson_items_updated_at
    BEFORE UPDATE ON lesson_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
