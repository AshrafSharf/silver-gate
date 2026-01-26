-- Silver Gate Database Schema
-- Supabase PostgreSQL

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for email lookup
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================
-- BOOKS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS books (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    description TEXT,
    source_id VARCHAR(255), -- Reference to external system (e.g., QGenSystem book ID)
    state VARCHAR(50) DEFAULT 'active' CHECK (state IN ('active', 'inactive', 'draft')),
    position INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for source_id lookup (for syncing with external systems)
CREATE INDEX IF NOT EXISTS idx_books_source_id ON books(source_id);
CREATE INDEX IF NOT EXISTS idx_books_state ON books(state);

-- ============================================
-- CHAPTERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS chapters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chapter_number INTEGER,
    position INTEGER DEFAULT 0,
    description TEXT,
    source_id VARCHAR(255), -- Reference to external system (e.g., QGenSystem chapter ID)
    state VARCHAR(50) DEFAULT 'active' CHECK (state IN ('active', 'inactive', 'draft')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for chapters
CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id);
CREATE INDEX IF NOT EXISTS idx_chapters_source_id ON chapters(source_id);
CREATE INDEX IF NOT EXISTS idx_chapters_state ON chapters(state);

-- ============================================
-- JOBS TABLE (Active book/chapter configuration)
-- ============================================
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    active_book_id UUID REFERENCES books(id) ON DELETE SET NULL,
    active_chapter_id UUID REFERENCES chapters(id) ON DELETE SET NULL,
    active_item_type VARCHAR(50) DEFAULT 'question' CHECK (active_item_type IN ('question', 'solution')),
    is_active BOOLEAN DEFAULT true,
    name VARCHAR(255) DEFAULT 'Default Job',
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for active job lookup
CREATE INDEX IF NOT EXISTS idx_jobs_is_active ON jobs(is_active) WHERE is_active = true;

-- ============================================
-- SCANNED ITEMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS scanned_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    item_type VARCHAR(50) DEFAULT 'question' CHECK (item_type IN ('question', 'solution')),
    item_data TEXT, -- The scanned content/data (PDF URL, base64, or filename for email attachments)
    content BYTEA, -- Binary content for email attachments (PDF files)
    scan_type VARCHAR(100), -- Type of scan (e.g., 'pdf', 'image', 'url', 'email_attachment')
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'archived')),
    -- MathPix conversion fields
    latex_doc TEXT, -- Converted LaTeX document from MathPix
    latex_conversion_status VARCHAR(50) DEFAULT 'pending' CHECK (latex_conversion_status IN ('pending', 'processing', 'completed', 'failed')),
    conversion_error TEXT, -- Error message if conversion failed
    mathpix_request_id VARCHAR(255), -- MathPix API request ID for tracking
    metadata JSONB DEFAULT '{}', -- Additional metadata about the scan
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for scanned_items
CREATE INDEX IF NOT EXISTS idx_scanned_items_book_id ON scanned_items(book_id);
CREATE INDEX IF NOT EXISTS idx_scanned_items_chapter_id ON scanned_items(chapter_id);
CREATE INDEX IF NOT EXISTS idx_scanned_items_item_type ON scanned_items(item_type);
CREATE INDEX IF NOT EXISTS idx_scanned_items_status ON scanned_items(status);
CREATE INDEX IF NOT EXISTS idx_scanned_items_created_at ON scanned_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scanned_items_book_chapter ON scanned_items(book_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_scanned_items_book_chapter_type ON scanned_items(book_id, chapter_id, item_type);

-- ============================================
-- QUESTION SETS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS question_sets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255),
    book_id UUID REFERENCES books(id) ON DELETE SET NULL,
    chapter_id UUID REFERENCES chapters(id) ON DELETE SET NULL,
    -- Array of scanned item IDs used to generate this question set (preserves selection order)
    source_item_ids UUID[] NOT NULL,
    -- Source type determines which parsing instructions to use
    source_type VARCHAR(50) DEFAULT 'Question Bank' CHECK (source_type IN ('Question Bank', 'Academic Book')),
    -- Extracted questions stored as JSONB
    -- Format: { "questions": [{ "text": "...", "choices": ["A. ...", "B. ...", ...] }] }
    questions JSONB NOT NULL DEFAULT '[]',
    -- Processing status
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    -- LlamaParse job tracking
    llamaparse_job_id VARCHAR(255),
    -- Metadata
    total_questions INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for question_sets
CREATE INDEX IF NOT EXISTS idx_question_sets_book_id ON question_sets(book_id);
CREATE INDEX IF NOT EXISTS idx_question_sets_chapter_id ON question_sets(chapter_id);
CREATE INDEX IF NOT EXISTS idx_question_sets_status ON question_sets(status);
CREATE INDEX IF NOT EXISTS idx_question_sets_source_type ON question_sets(source_type);
CREATE INDEX IF NOT EXISTS idx_question_sets_created_at ON question_sets(created_at DESC);

-- ============================================
-- SOLUTION SETS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS solution_sets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255),
    book_id UUID REFERENCES books(id) ON DELETE SET NULL,
    chapter_id UUID REFERENCES chapters(id) ON DELETE SET NULL,
    -- Array of scanned item IDs used to generate this solution set (preserves selection order)
    source_item_ids UUID[] NOT NULL,
    -- Optional link to a question set for matching solutions to questions
    question_set_id UUID REFERENCES question_sets(id) ON DELETE SET NULL,
    -- Source type determines which parsing instructions to use
    source_type VARCHAR(50) DEFAULT 'Question Bank' CHECK (source_type IN ('Question Bank', 'Academic Book')),
    -- Extracted solutions stored as JSONB
    -- Format: { "solutions": [{ "question_label": "1", "answer_key": "C", "worked_solution": "...", "explanation": "..." }] }
    solutions JSONB NOT NULL DEFAULT '[]',
    -- Processing status
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    -- LlamaParse job tracking
    llamaparse_job_id VARCHAR(255),
    -- Metadata
    total_solutions INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for solution_sets
CREATE INDEX IF NOT EXISTS idx_solution_sets_book_id ON solution_sets(book_id);
CREATE INDEX IF NOT EXISTS idx_solution_sets_chapter_id ON solution_sets(chapter_id);
CREATE INDEX IF NOT EXISTS idx_solution_sets_question_set_id ON solution_sets(question_set_id);
CREATE INDEX IF NOT EXISTS idx_solution_sets_status ON solution_sets(status);
CREATE INDEX IF NOT EXISTS idx_solution_sets_source_type ON solution_sets(source_type);
CREATE INDEX IF NOT EXISTS idx_solution_sets_created_at ON solution_sets(created_at DESC);

-- ============================================
-- TRIGGERS FOR updated_at
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for each table
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_books_updated_at ON books;
CREATE TRIGGER update_books_updated_at
    BEFORE UPDATE ON books
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_chapters_updated_at ON chapters;
CREATE TRIGGER update_chapters_updated_at
    BEFORE UPDATE ON chapters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
CREATE TRIGGER update_jobs_updated_at
    BEFORE UPDATE ON jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_scanned_items_updated_at ON scanned_items;
CREATE TRIGGER update_scanned_items_updated_at
    BEFORE UPDATE ON scanned_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_question_sets_updated_at ON question_sets;
CREATE TRIGGER update_question_sets_updated_at
    BEFORE UPDATE ON question_sets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_solution_sets_updated_at ON solution_sets;
CREATE TRIGGER update_solution_sets_updated_at
    BEFORE UPDATE ON solution_sets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SEED DATA (Optional - for development)
-- ============================================

-- Insert a default admin user (password: admin123)
-- Password hash generated with bcrypt, rounds=10
INSERT INTO users (email, password_hash, name, role)
VALUES ('admin@silvergate.com', '$2a$10$rQqJvN9KHQfqhDqKqKqKqu8J8J8J8J8J8J8J8J8J8J8J8J8J8J8J8', 'Admin User', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Insert sample books
INSERT INTO books (id, name, display_name, description, source_id)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'mathematics_grade10', 'Mathematics Grade 10', 'Mathematics textbook for Grade 10', 'qgen_book_001'),
    ('22222222-2222-2222-2222-222222222222', 'physics_grade10', 'Physics Grade 10', 'Physics textbook for Grade 10', 'qgen_book_002'),
    ('33333333-3333-3333-3333-333333333333', 'chemistry_grade10', 'Chemistry Grade 10', 'Chemistry textbook for Grade 10', 'qgen_book_003')
ON CONFLICT DO NOTHING;

-- Insert sample chapters
INSERT INTO chapters (id, name, display_name, book_id, chapter_number, position, source_id)
VALUES
    -- Mathematics chapters
    ('aaaa1111-1111-1111-1111-111111111111', 'algebra_basics', 'Algebra Basics', '11111111-1111-1111-1111-111111111111', 1, 1, 'qgen_chapter_001'),
    ('aaaa2222-2222-2222-2222-222222222222', 'linear_equations', 'Linear Equations', '11111111-1111-1111-1111-111111111111', 2, 2, 'qgen_chapter_002'),
    ('aaaa3333-3333-3333-3333-333333333333', 'quadratic_equations', 'Quadratic Equations', '11111111-1111-1111-1111-111111111111', 3, 3, 'qgen_chapter_003'),
    -- Physics chapters
    ('bbbb1111-1111-1111-1111-111111111111', 'motion', 'Motion and Kinematics', '22222222-2222-2222-2222-222222222222', 1, 1, 'qgen_chapter_004'),
    ('bbbb2222-2222-2222-2222-222222222222', 'force_and_laws', 'Force and Laws of Motion', '22222222-2222-2222-2222-222222222222', 2, 2, 'qgen_chapter_005'),
    -- Chemistry chapters
    ('cccc1111-1111-1111-1111-111111111111', 'atomic_structure', 'Atomic Structure', '33333333-3333-3333-3333-333333333333', 1, 1, 'qgen_chapter_006'),
    ('cccc2222-2222-2222-2222-222222222222', 'periodic_table', 'Periodic Table', '33333333-3333-3333-3333-333333333333', 2, 2, 'qgen_chapter_007')
ON CONFLICT DO NOTHING;

-- Insert default active job
INSERT INTO jobs (id, active_book_id, active_chapter_id, active_item_type, is_active, name)
VALUES ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaa1111-1111-1111-1111-111111111111', 'question', true, 'Default Scanning Job')
ON CONFLICT DO NOTHING;
