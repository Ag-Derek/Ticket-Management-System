-- Docket schema (PostgreSQL / Supabase)
-- IDs are kept as human-readable strings (TKT-2026-000001 etc.) to match
-- the format already used across the front end, rather than switching to
-- surrogate integer keys.

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,          -- USR-2026-000001
  full_name       TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  phone           TEXT,
  department      TEXT,
  organization    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id              TEXT PRIMARY KEY,          -- AGT-2026-000001
  full_name       TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  created_by      TEXT NOT NULL DEFAULT 'self-signup', -- seed | self-signup | admin
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admins (
  id              TEXT PRIMARY KEY,          -- ADM-2026-000001
  email           TEXT UNIQUE NOT NULL,
  full_name       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auth is centralized here instead of living inline on whichever table
-- needed a login first. Every loginable actor (user, agent, admin) gets
-- at most one row here, keyed by (owner_type, owner_id). This is what
-- makes SSO/Entra ID a later addition to ONE table rather than a redesign
-- of three, and lets a user/agent/admin exist without being able to log
-- in yet (e.g. a customer record created from a ticket, before they ever
-- set a password).
CREATE TABLE IF NOT EXISTS auth_credentials (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_type        TEXT NOT NULL,           -- user | agent | admin
  owner_id          TEXT NOT NULL,           -- users(id) / agents(id) / admins(id), depending on owner_type
  auth_provider     TEXT NOT NULL DEFAULT 'local', -- local | sso
  provider_subject  TEXT,                    -- external id from the SSO provider; null for 'local'
  password_hash     TEXT,                    -- null when auth_provider = 'sso'
  mfa_enabled       BOOLEAN NOT NULL DEFAULT false,
  mfa_secret        TEXT,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id),
  CHECK (owner_type IN ('user', 'agent', 'admin')),
  CHECK (auth_provider IN ('local', 'sso')),
  CHECK (
    (auth_provider = 'local' AND password_hash IS NOT NULL) OR
    (auth_provider = 'sso'   AND password_hash IS NULL)
  )
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
  -- Set when an agent escalates a ticket and recommends who should pick it
  -- up next. Informational only — an agent still cannot assign/reassign a
  -- ticket themselves (see PATCH /:id/assign, admin-only); this just gives
  -- the admin console a one-click default instead of a blank dropdown.
  -- Cleared whenever the ticket is actually (re)assigned.
  suggested_agent_id TEXT REFERENCES agents(id),
  resolution_summary  TEXT,
  csat_rating         INTEGER,               -- 1-5, null until rated
  csat_comment        TEXT,
  escalated_to        TEXT,
  escalation_reason   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CREATE TABLE IF NOT EXISTS is a no-op against a tickets table that
-- already exists without this column — add it separately, idempotently.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS suggested_agent_id TEXT REFERENCES agents(id);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id     TEXT NOT NULL REFERENCES tickets(id),
  author_type   TEXT NOT NULL,               -- customer | agent | admin
  author_name   TEXT NOT NULL,
  visibility    TEXT NOT NULL DEFAULT 'public', -- public | internal
  body          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- An attachment belongs to exactly one of: a ticket (attached directly,
-- e.g. at creation) or a comment (attached to a specific reply). It can
-- never belong to neither, and never to both — the CHECK below enforces
-- that instead of leaving it to application code to get right every time.
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id     TEXT REFERENCES tickets(id),
  comment_id    INTEGER REFERENCES ticket_comments(id),
  filename      TEXT NOT NULL,
  stored_path   TEXT,
  mime_type     TEXT,
  size_bytes    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (ticket_id IS NOT NULL AND comment_id IS NULL) OR
    (ticket_id IS NULL AND comment_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_agent ON tickets(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attachments_comment ON ticket_attachments(comment_id);
CREATE INDEX IF NOT EXISTS idx_auth_owner ON auth_credentials(owner_type, owner_id);
