-- ============================================================================
-- Queue System — Full Relational Schema for Supabase
-- ============================================================================
-- Run once in: https://supabase.com/dashboard/project/_/sql/new
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT)
-- ============================================================================

-- App-level state (single row for misc state)
CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY,
  next_ticket_number INTEGER DEFAULT 1,
  active_branch TEXT DEFAULT 'main',
  license TEXT DEFAULT '',
  roles JSONB DEFAULT '{"adminPassword":"","operatorPassword":"","viewerPassword":""}'::jsonb,
  settings JSONB DEFAULT '{}'::jsonb,
  data JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Categories (services like Consultation, Eye Exam, etc.)
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT DEFAULT '',
  name_ur TEXT DEFAULT '',
  name_fr TEXT DEFAULT '',
  color TEXT DEFAULT '#4f8ff7',
  prefix TEXT DEFAULT '',
  stages JSONB DEFAULT '[]'::jsonb,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Counters (Reception 1, Doctor D1, etc.)
CREATE TABLE IF NOT EXISTS counters (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  operator_name TEXT DEFAULT '',
  current_ticket INTEGER,
  status TEXT DEFAULT 'open',
  category_ids JSONB DEFAULT '[]'::jsonb,
  stage_id TEXT,
  last_active_at BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tickets (each issued ticket)
CREATE TABLE IF NOT EXISTS tickets (
  number INTEGER PRIMARY KEY,
  display_number TEXT,
  category_id TEXT,
  current_stage INTEGER DEFAULT 0,
  stage_history JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'waiting',
  counter_id INTEGER,
  created_at BIGINT,
  called_at BIGINT,
  completed_at BIGINT,
  notes TEXT DEFAULT '',
  transfer_history JSONB DEFAULT '[]'::jsonb,
  held_at BIGINT,
  held_by_counter_id INTEGER,
  forced_counter_id INTEGER
);

-- Backfill column for older deployments
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS forced_counter_id INTEGER;

CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status);
CREATE INDEX IF NOT EXISTS tickets_category_idx ON tickets(category_id);
CREATE INDEX IF NOT EXISTS tickets_counter_idx ON tickets(counter_id);
CREATE INDEX IF NOT EXISTS tickets_created_idx ON tickets(created_at DESC);

-- Audit log (every action)
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT DEFAULT '',
  details TEXT DEFAULT '',
  ts BIGINT
);

CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON audit_log(ts DESC);

-- Shifts (operator clock-in/out)
CREATE TABLE IF NOT EXISTS shifts (
  id BIGSERIAL PRIMARY KEY,
  operator_name TEXT NOT NULL,
  counter_id INTEGER,
  clock_in BIGINT,
  clock_out BIGINT
);

CREATE INDEX IF NOT EXISTS shifts_op_idx ON shifts(operator_name);

-- Announcements (text shown on display screen)
CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Branches (locations)
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT DEFAULT ''
);

INSERT INTO branches (id, name, name_ar) VALUES ('main', 'Main Branch', 'الفرع الرئيسي')
ON CONFLICT DO NOTHING;

-- Webhooks (external notification URLs)
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events JSONB DEFAULT '["*"]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (service role bypasses it)
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
