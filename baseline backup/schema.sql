-- ============================================================================
-- PERSONAL SUPERVISOR & CROSS-COMPANY WORK MANAGEMENT — CORE SCHEMA (v1)
-- Engine: SQLite (identical schema on Desktop via better-sqlite3/Tauri-SQL
--         and Android via @capacitor-community/sqlite)
--
-- DESIGN RULES (apply to every table):
--   1. id            : TEXT UUIDv4 — safe for offline generation on any device.
--   2. version       : INTEGER monotonic per-row counter — drives Last-Write-Wins
--                      merge during Sync/Import. Bumped by repository layer only.
--   3. updated_at    : ISO-8601 UTC — LWW tiebreaker when versions are equal.
--   4. device_id     : which device produced the last write (conflict forensics).
--   5. deleted_at    : soft-delete tombstone. Rows are NEVER hard-deleted, so a
--                      deletion on Device A reliably propagates to Device B.
--   6. Append-only tables (transitions, reflections, sync_log) are immutable
--      by trigger — the audit trail can never be rewritten.
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ----------------------------------------------------------------------------
-- META — schema version + identity of this local database instance
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Seeded by migration runner: ('schema_version','1'), ('device_id','<uuid>')

-- ----------------------------------------------------------------------------
-- COMPANIES — multi-tenant root entity. theme_json carries the per-company
-- gradient palette consumed later by the UI layer (data-only here).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  industry    TEXT,
  location    TEXT,
  theme_json  TEXT NOT NULL DEFAULT '{}',   -- {"primary":"#7C3AED","glow":"#22D3EE",...}
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

-- ----------------------------------------------------------------------------
-- PHASE TEMPLATES — reusable "Standard Operational Phases" per company
-- (e.g. Shree Jagdamba: Design → Procurement → Fabrication → CNC/PLC → Assembly)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phase_templates (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

-- ----------------------------------------------------------------------------
-- TEAM MEMBERS — a GLOBAL cross-company resource pool (Raj, Niranjan, CNC
-- operator, external Laser Cutting Vendor). Company affiliation is many-to-many
-- via member_company_links because one associate serves multiple businesses.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_members (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  roles_json     TEXT NOT NULL DEFAULT '[]', -- ["CNC Machining","Fabrication"]
  notes          TEXT,
  is_external    INTEGER NOT NULL DEFAULT 0, -- 1 = vendor / outside dependency
  is_default_delegate INTEGER NOT NULL DEFAULT 0, -- Raj: default handoff target
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL,
  device_id      TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE TABLE IF NOT EXISTS member_company_links (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES team_members(id),
  company_id  TEXT NOT NULL REFERENCES companies(id),
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT,
  UNIQUE (member_id, company_id)
);

-- ----------------------------------------------------------------------------
-- PROJECTS
--   type 'zero_to_one' → sand stack starts at 0%
--   type 'ongoing'     → sand stack initializes at baseline_percent
--   IMMUTABILITY: once deadline / baseline are locked (locked_at set), triggers
--   below reject any UPDATE that changes them. This is enforced at the DB layer
--   so no code path — present or future — can bypass it.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id),
  name             TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('zero_to_one','ongoing')),
  baseline_percent REAL NOT NULL DEFAULT 0 CHECK (baseline_percent BETWEEN 0 AND 100),
  deadline         TEXT,                    -- ISO date; NULL until committed
  locked_at        TEXT,                    -- set once → deadline+baseline frozen
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','completed','archived')),
  version          INTEGER NOT NULL DEFAULT 1,
  updated_at       TEXT NOT NULL,
  device_id        TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  deleted_at       TEXT
);

-- Project phases are instantiated from phase_templates at project creation.
CREATE TABLE IF NOT EXISTS project_phases (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

-- ----------------------------------------------------------------------------
-- TASKS — the atomic unit driving the Sand Stack.
-- STATE COLUMN is owned exclusively by the state machine (taskStateMachine.ts).
-- Repositories refuse direct writes to `state`; every change flows through
-- transition() which also appends to task_transitions (audit log).
--
-- States:
--   pending        → created, not started
--   in_progress    → actively being worked
--   retry_pending  → an attempt failed (vendor didn't pick up) — MUST be
--                    reassigned (handoff) or rescheduled; never dismissible
--   overdue        → deadline passed without completion → sand-stack degradation
--   completed      → done (completed_late=1 if it was overdue when completed;
--                    completing restores the stack's premium gradient)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  phase_id        TEXT REFERENCES project_phases(id),
  parent_task_id  TEXT REFERENCES tasks(id),  -- follow-up chains from handoffs
  title           TEXT NOT NULL,
  description     TEXT,
  assignee_id     TEXT REFERENCES team_members(id),
  state           TEXT NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending','in_progress','retry_pending',
                                   'overdue','completed')),
  weight          REAL NOT NULL DEFAULT 1,    -- sand grains this task contributes
  deadline        TEXT,
  photo_required  INTEGER NOT NULL DEFAULT 0, -- mandatory image before COMPLETE
  retry_count     INTEGER NOT NULL DEFAULT 0,
  completed_at    TEXT,
  completed_late  INTEGER NOT NULL DEFAULT 0,
  version         INTEGER NOT NULL DEFAULT 1,
  updated_at      TEXT NOT NULL,
  device_id       TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_project  ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_state    ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);

-- Append-only audit trail of every state transition. Immutable by trigger.
CREATE TABLE IF NOT EXISTS task_transitions (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  from_state  TEXT NOT NULL,
  to_state    TEXT NOT NULL,
  event       TEXT NOT NULL,     -- START | COMPLETE | FAIL_ATTEMPT | REASSIGN...
  note        TEXT,
  device_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- HANDOFFS — the Handoff/Retry loop. Created when a task in retry_pending is
-- reassigned; tracked until 'completed'. Powers "Has Raj completed the follow-up?"
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS handoffs (
  id                 TEXT PRIMARY KEY,
  task_id            TEXT NOT NULL REFERENCES tasks(id),
  from_assignee_id   TEXT REFERENCES team_members(id),
  to_assignee_id     TEXT NOT NULL REFERENCES team_members(id),
  reason             TEXT NOT NULL,          -- "Vendor missed call ×2"
  follow_up_deadline TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','completed','escalated')),
  version            INTEGER NOT NULL DEFAULT 1,
  updated_at         TEXT NOT NULL,
  device_id          TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  deleted_at         TEXT
);

-- ----------------------------------------------------------------------------
-- REFLECTIONS — Strict Supervisor module. All three answers mandatory (CHECKs).
-- Permanently logged: UPDATE/DELETE blocked by trigger. Compiled into the final
-- project report.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reflections (
  id                 TEXT PRIMARY KEY,
  task_id            TEXT NOT NULL REFERENCES tasks(id),
  project_id         TEXT NOT NULL REFERENCES projects(id),
  what_went_wrong    TEXT NOT NULL CHECK (length(trim(what_went_wrong)) > 0),
  root_bottleneck    TEXT NOT NULL CHECK (length(trim(root_bottleneck)) > 0),
  corrective_action  TEXT NOT NULL CHECK (length(trim(corrective_action)) > 0),
  device_id          TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- ATTACHMENTS — photo verification. Binary lives on the filesystem; DB stores
-- path + sha256 so Import/Export can verify integrity across devices.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  file_path   TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

-- ----------------------------------------------------------------------------
-- DAILY NOTES / WORK SESSIONS / CALENDAR — feed the Monthly Productivity Report
-- and "Productivity Interruption/Loss" computation.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_notes (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  note_date   TEXT NOT NULL,                 -- YYYY-MM-DD
  body        TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS work_sessions (
  id         TEXT PRIMARY KEY,
  login_at   TEXT NOT NULL,
  logout_at  TEXT,                           -- NULL = session still open
  device_id  TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS calendar_exceptions (
  id         TEXT PRIMARY KEY,
  ex_date    TEXT NOT NULL,                  -- YYYY-MM-DD
  ex_type    TEXT NOT NULL CHECK (ex_type IN ('holiday','travel')),
  label      TEXT,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

-- ----------------------------------------------------------------------------
-- SYNC LOG — every export/import is recorded with the file hash so any device
-- can prove exactly which snapshot it has seen.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_log (
  id          TEXT PRIMARY KEY,
  direction   TEXT NOT NULL CHECK (direction IN ('export','import')),
  file_hash   TEXT NOT NULL,
  row_count   INTEGER NOT NULL,
  conflicts   INTEGER NOT NULL DEFAULT 0,
  device_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- ============================================================================
-- TRIGGERS — hard business-rule enforcement at the database layer
-- ============================================================================

-- (1) PROJECT IMMUTABILITY: once locked, deadline & baseline can never change.
CREATE TRIGGER IF NOT EXISTS trg_projects_lock
BEFORE UPDATE OF deadline, baseline_percent, locked_at ON projects
FOR EACH ROW
WHEN OLD.locked_at IS NOT NULL
     AND (NEW.deadline IS NOT OLD.deadline
          OR NEW.baseline_percent IS NOT OLD.baseline_percent
          OR NEW.locked_at IS NOT OLD.locked_at)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: project deadline/baseline is locked and cannot be edited or extended');
END;

-- (2) REFLECTIONS are permanent.
CREATE TRIGGER IF NOT EXISTS trg_reflections_no_update
BEFORE UPDATE ON reflections BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: reflections are permanently logged');
END;
CREATE TRIGGER IF NOT EXISTS trg_reflections_no_delete
BEFORE DELETE ON reflections BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: reflections are permanently logged');
END;

-- (3) TRANSITION LOG is append-only.
CREATE TRIGGER IF NOT EXISTS trg_transitions_no_update
BEFORE UPDATE ON task_transitions BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: transition log is append-only');
END;
CREATE TRIGGER IF NOT EXISTS trg_transitions_no_delete
BEFORE DELETE ON task_transitions BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: transition log is append-only');
END;

-- (4) TASKS ARE NEVER DISMISSED: block hard deletes; deleted_at may only be set
--     on tasks that are completed (archival of finished work is allowed).
CREATE TRIGGER IF NOT EXISTS trg_tasks_no_hard_delete
BEFORE DELETE ON tasks BEGIN
  SELECT RAISE(ABORT, 'FORBIDDEN: tasks cannot be hard-deleted; use the state machine');
END;
CREATE TRIGGER IF NOT EXISTS trg_tasks_no_dismiss
BEFORE UPDATE OF deleted_at ON tasks
FOR EACH ROW
WHEN NEW.deleted_at IS NOT NULL AND OLD.state != 'completed'
BEGIN
  SELECT RAISE(ABORT, 'FORBIDDEN: an incomplete task cannot be dismissed — reassign or reschedule it');
END;
