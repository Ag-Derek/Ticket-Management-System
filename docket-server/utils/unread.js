// Unread-message tracking, WhatsApp style: each participant has a "read up
// to comment id N" marker per ticket (ticket_reads), and anything newer that
// someone else wrote is unread. Used by the notification poll (badges), the
// chat page (marking read), and the email reminders.
//
// Only the two sides of a conversation are tracked: the customer who owns
// the ticket and the agent assigned to it. Admins see every ticket, so a
// per-admin unread count would just be "every message ever" — they keep the
// existing pop-ups instead.

const db = require('../db/connection');

const ROLE_TO_READER_TYPE = { user: 'customer', agent: 'agent', admin: 'admin' };

// Comments at or below this id predate unread tracking and count as read
// (see app_settings in db/schema.sql). It never changes once set, so it's
// cached after the first read.
let baselineCache = null;
async function unreadBaseline() {
  if (baselineCache !== null) return baselineCache;
  const result = await db.query(`SELECT value FROM app_settings WHERE key = 'unread_tracking_after_comment_id'`);
  baselineCache = result.rows[0] ? Number(result.rows[0].value) : 0;
  return baselineCache;
}

// Moves the reader's marker forward to upToId (or to the newest comment on
// the ticket when upToId is omitted). Never moves it backwards, and never
// past the ticket's newest comment, whatever the client sends.
async function markRead(ticketId, readerType, readerId, upToId, client) {
  const requested = Number.isInteger(upToId) && upToId > 0 ? upToId : null;
  await (client || db).query(
    `INSERT INTO ticket_reads (ticket_id, reader_type, reader_id, last_read_comment_id, last_read_at)
     SELECT $1, $2, $3,
            LEAST(COALESCE($4::int, MAX(c.id), 0), COALESCE(MAX(c.id), 0)),
            now()
     FROM ticket_comments c WHERE c.ticket_id = $1
     ON CONFLICT (ticket_id, reader_type, reader_id) DO UPDATE
       SET last_read_comment_id = GREATEST(ticket_reads.last_read_comment_id, EXCLUDED.last_read_comment_id),
           last_read_at = now()`,
    [ticketId, readerType, readerId, requested]
  );
}

// { total, tickets: { [ticketId]: count } } for req.actor. Customers count
// public messages on their own tickets; agents count everything (including
// internal notes) on tickets assigned to them. A message never counts as
// unread for whoever wrote it.
async function unreadCounts(actor) {
  if (actor.role !== 'user' && actor.role !== 'agent') return { total: 0, tickets: {} };
  const readerType = ROLE_TO_READER_TYPE[actor.role];
  const baseline = await unreadBaseline();

  const scope = actor.role === 'user'
    ? `t.user_id = $1 AND c.visibility = 'public'`
    : 't.assigned_agent_id = $1';

  const result = await db.query(
    `SELECT c.ticket_id, COUNT(*)::int AS n
     FROM ticket_comments c
     JOIN tickets t ON t.id = c.ticket_id
     LEFT JOIN ticket_reads r
       ON r.ticket_id = c.ticket_id AND r.reader_type = $2 AND r.reader_id = $1
     WHERE ${scope}
       AND c.id > GREATEST(COALESCE(r.last_read_comment_id, 0), $3)
       AND COALESCE(c.author_id, '') <> $1
       AND NOT (c.author_id IS NULL AND c.author_type = $2)
     GROUP BY c.ticket_id`,
    [actor.id, readerType, baseline]
  );

  const tickets = {};
  let total = 0;
  for (const row of result.rows) {
    tickets[row.ticket_id] = row.n;
    total += row.n;
  }
  return { total, tickets };
}

module.exports = { ROLE_TO_READER_TYPE, unreadBaseline, markRead, unreadCounts };
