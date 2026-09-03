-- Docket schema
-- IDs are kept as human-readable strings (TKT-2026-000001 etc.) to match
-- the format already used across the front end, rather than switching to
-- surrogate integer keys.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,          -- USR-2026-000001
  full_name       TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  phone           TEXT,
  department      TEXT,
  organization    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agents (
  id              TEXT PRIMARY KEY,          -- AGT-2026-000001
  full_name       TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  created_by      TEXT NOT NULL DEFAULT 'self-signup', -- seed | self-signup | admin
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id              TEXT PRIMARY KEY,          -- ADM-2026-000001
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  full_name       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id                  TEXT PRIMARY KEY,      -- TKT-2026-000001
  user_id             TEXT NOT NULL REFERENCES users(id),
  subject             TEXT NOT NULL,
  description         TEXT NOT NULL,
  category            TEXT NOT NULL,         -- Network | Application | Hardware | Access & Identity
  priority            TEXT NOT NULL,         -- Low | Medium | High | Critical
  status              TEXT NOT NULL DEFAULT 'Created',
                      -- Created | Assigned | In Progress | Waiting | Escalated
                      -- | Resolved | Reopened | Closed
  affected_service    TEXT,
  assigned_team       TEXT,                  -- derived from category at creation
  sla_summary         TEXT,                  -- e.g. "15 min response / 4 hrs resolution"
  assigned_agent_id   TEXT REFERENCES agents(id),
  resolution_summary  TEXT,
  csat_rating         INTEGER,               -- 1-5, null until rated
  csat_comment        TEXT,
  escalated_to        TEXT,
  escalation_reason   TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id     TEXT NOT NULL REFERENCES tickets(id),
  author_type   TEXT NOT NULL,               -- customer | agent | admin
  author_name   TEXT NOT NULL,
  visibility    TEXT NOT NULL DEFAULT 'public', -- public | internal
  body          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- filename only for now: real file storage isn't wired up yet, so
-- stored_path stays nullable until an upload endpoint exists.
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id     TEXT REFERENCES tickets(id),
  comment_id    INTEGER REFERENCES ticket_comments(id),
  filename      TEXT NOT NULL,
  stored_path   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_agent ON tickets(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON ticket_attachments(ticket_id);
