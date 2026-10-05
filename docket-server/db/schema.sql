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

-- One row per emailed sign-in code (email MFA, required for every actor
-- type). Only an HMAC of the 6-digit code is stored, never the code
-- itself. owner_id is null for a first-time user/agent sign-in: the
-- profile they submitted waits in context.pending and the users/agents row
-- is only created once they prove they own the email, so nobody can
-- register someone else's address.
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id            TEXT PRIMARY KEY,            -- random UUID, handed to the client
  owner_type    TEXT NOT NULL,               -- user | agent | admin
  owner_id      TEXT,                        -- null until a pending account is created
  email         TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  context       JSONB NOT NULL DEFAULT '{}',
  attempts      INTEGER NOT NULL DEFAULT 0,
  send_count    INTEGER NOT NULL DEFAULT 1,
  last_sent_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (owner_type IN ('user', 'agent', 'admin'))
);

-- One row per emailed password-reset link. Only a SHA-256 of the link's
-- token is stored — the token is 256 random bits, so (unlike the 6-digit
-- MFA code) it needs no HMAC secret or attempt counter to be unguessable.
-- Only accounts with local credentials (a password) can have one.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_type    TEXT NOT NULL,               -- user | agent | admin
  owner_id      TEXT NOT NULL,
  token_hash    TEXT UNIQUE NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (owner_type IN ('user', 'agent', 'admin'))
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

-- When the ticket was (most recently) marked Resolved, and when the customer
-- closed it. Reports measure resolution time from these rather than
-- updated_at, which also moves on every comment, reassignment and CSAT
-- rating. resolved_at is cleared on Reopened and set again on the next
-- Resolved, so it always describes the resolution that actually stuck.
-- Existing tickets are backfilled at the bottom of this file.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- SLA clock (rules in utils/sla.js). Due times are absolute, set from the
-- priority's targets at creation. first_responded_at is the first public
-- agent/admin reply (or the first resolve). sla_paused_at is set while the
-- resolution clock is paused (Waiting / Resolved); resuming pushes
-- resolution_due_at back by the paused time. Existing tickets are
-- backfilled at the bottom of this file.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_response_due_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_responded_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_paused_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ticket_comments (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id     TEXT NOT NULL REFERENCES tickets(id),
  author_type   TEXT NOT NULL,               -- customer | agent | admin
  author_name   TEXT NOT NULL,
  visibility    TEXT NOT NULL DEFAULT 'public', -- public | internal
  body          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The author's users/agents/admins id, so message notifications can skip
-- the author's own messages. Null on comments posted before it existed.
ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS author_id TEXT;

-- How far each participant has read each ticket's conversation — powers the
-- unread badges and the "you have unread messages" email reminder (see
-- utils/message-reminders.js). reader_type uses the comments' naming
-- (customer | agent | admin). Comment ids only grow, so "read up to id N"
-- is all that's needed. last_reminded_comment_id stops the same unread
-- batch from being emailed twice.
CREATE TABLE IF NOT EXISTS ticket_reads (
  ticket_id                 TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  reader_type               TEXT NOT NULL,
  reader_id                 TEXT NOT NULL,
  last_read_comment_id      INTEGER NOT NULL DEFAULT 0,
  last_read_at              TIMESTAMPTZ,
  last_reminded_comment_id  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ticket_id, reader_type, reader_id),
  CHECK (reader_type IN ('customer', 'agent', 'admin'))
);

-- Small key/value store for one-off app state.
CREATE TABLE IF NOT EXISTS app_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Everything posted before unread tracking existed counts as already read,
-- so the first deploy doesn't light up every old conversation or email
-- reminders about months-old messages. Set once; never moves after that.
INSERT INTO app_settings (key, value)
SELECT 'unread_tracking_after_comment_id', COALESCE(MAX(id), 0)::text FROM ticket_comments
ON CONFLICT (key) DO NOTHING;

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

-- Records who did what, when, across the app — used to back the admin
-- console's Audit Logs / Reports screens (QA needs a trail of ticket
-- status/assignment changes and logins, not just the tickets table's
-- silently-overwritten current state). actor_id/actor_name are denormalized
-- (not a strict FK into users/agents/admins) because the actor can be
-- unauthenticated (a failed login attempt) or from a table-less concept
-- (e.g. self-signup before an agent row exists yet).
CREATE TABLE IF NOT EXISTS audit_logs (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type    TEXT,                  -- user | agent | admin | unknown
  actor_id      TEXT,
  actor_name    TEXT,
  action        TEXT NOT NULL,         -- e.g. ticket.created, ticket.status_changed, auth.login_failed
  entity_type   TEXT,                  -- ticket | agent | user | admin
  entity_id     TEXT,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Can't remember which email I used" requests from login.html. Public
-- and unauthenticated, so nothing here is trusted: it's what the visitor
-- typed, kept for an admin to match against the users table by hand and
-- follow up at contact_email. The submitter is never told whether an
-- account matched — see routes/account-help.js.
CREATE TABLE IF NOT EXISTS account_help_requests (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name         TEXT NOT NULL,
  contact_email     TEXT NOT NULL,
  phone             TEXT,
  organization      TEXT,
  details           TEXT,
  status            TEXT NOT NULL DEFAULT 'open',  -- open | resolved
  resolution_note   TEXT,
  resolved_by_id    TEXT,                          -- admins(id)
  resolved_by_name  TEXT,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('open', 'resolved'))
);

-- Session revocation. Every token carries the owner's token_version from
-- when it was issued, and requireAuth rejects it once the stored value has
-- moved on — so bumping this (password reset, "sign out everywhere") kills
-- every outstanding session for that account at once. Lives on the owner
-- tables, not auth_credentials, because customers and agents have no
-- credentials row (they sign in by emailed code alone).
ALTER TABLE users  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_agent ON tickets(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_reads_reader ON ticket_reads(reader_type, reader_id);
CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attachments_comment ON ticket_attachments(comment_id);
CREATE INDEX IF NOT EXISTS idx_auth_owner ON auth_credentials(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_email ON mfa_challenges(owner_type, email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_resets_owner ON password_reset_tokens(owner_type, owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_account_help_status ON account_help_requests(status, created_at DESC);

-- Backfill resolved_at/closed_at for tickets that were already Resolved or
-- Closed before those columns existed: the time of the last matching status
-- change in the audit log, or updated_at for tickets older than the audit
-- log (the best estimate available). Only touches rows still NULL, so after
-- the first boot this matches nothing.
UPDATE tickets t
SET resolved_at = COALESCE(
  (SELECT MAX(a.created_at) FROM audit_logs a
   WHERE a.entity_type = 'ticket' AND a.entity_id = t.id
     AND a.action = 'ticket.status_changed' AND a.details->>'to_status' = 'Resolved'),
  t.updated_at)
WHERE t.resolved_at IS NULL AND t.status IN ('Resolved', 'Closed');

UPDATE tickets t
SET closed_at = COALESCE(
  (SELECT MAX(a.created_at) FROM audit_logs a
   WHERE a.entity_type = 'ticket' AND a.entity_id = t.id
     AND a.action = 'ticket.status_changed' AND a.details->>'to_status' = 'Closed'),
  t.updated_at)
WHERE t.closed_at IS NULL AND t.status = 'Closed';

-- Backfill the SLA clock for tickets created before it existed. Minute
-- values mirror SLA_BY_PRIORITY in utils/sla.js. First response is the
-- earlier of the first public agent/admin reply and the resolve time
-- (LEAST skips NULLs). Tickets sitting
-- in Waiting/Resolved right now start paused from their last update (or
-- resolve time); earlier pauses aren't recoverable, so those tickets get no
-- credit for them. Only touches rows with no due time yet, so after the
-- first boot this matches nothing.
UPDATE tickets t
SET first_response_due_at = t.created_at + make_interval(mins => CASE t.priority
      WHEN 'Critical' THEN 15 WHEN 'High' THEN 30 WHEN 'Low' THEN 1440 ELSE 240 END),
    resolution_due_at = t.created_at + make_interval(mins => CASE t.priority
      WHEN 'Critical' THEN 240 WHEN 'High' THEN 480 WHEN 'Low' THEN 7200 ELSE 2880 END),
    first_responded_at = LEAST(
      (SELECT MIN(c.created_at) FROM ticket_comments c
       WHERE c.ticket_id = t.id AND c.visibility = 'public' AND c.author_type IN ('agent', 'admin')),
      t.resolved_at),
    sla_paused_at = CASE
      WHEN t.status = 'Waiting' THEN t.updated_at
      WHEN t.status = 'Resolved' THEN COALESCE(t.resolved_at, t.updated_at)
      ELSE NULL END
WHERE t.resolution_due_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_resolution_due ON tickets(resolution_due_at);
