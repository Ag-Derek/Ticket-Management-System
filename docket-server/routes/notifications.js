const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/authenticate');
const { asyncHandler } = require('../utils/async-handler');
const { unreadCounts } = require('../utils/unread');

const router = express.Router();

const ROLE_TO_AUTHOR_TYPE = { user: 'customer', agent: 'agent', admin: 'admin' };
const MAX_MESSAGES = 20;

// GET /api/notifications/messages?after_id=N
// New chat messages on tickets the caller can see, written by someone else —
// polled by the client to pop up "new message" toasts. ticket_comments ids
// are an identity column, so the client keeps the last id it has seen as a
// cursor (no clock-skew issues with timestamps).
//
// With no after_id this returns no messages, only the current latest_id:
// the first poll on a page sets the cursor instead of replaying history.
//
// Every response also carries `unread` ({ total, tickets: { id: n } }, see
// utils/unread.js) so the same poll drives the unread badges — no second
// request per page.
//
// Visibility follows the same rules as the chat itself: a customer sees
// public messages on their own tickets, an agent sees everything on tickets
// assigned to them, an admin sees everything.
router.get('/messages', requireAuth(), asyncHandler(async (req, res) => {
  const { role, id } = req.actor;
  const afterId = Number(req.query.after_id);

  if (!Number.isInteger(afterId) || afterId < 0) {
    const latest = await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM ticket_comments');
    return res.json({ latest_id: Number(latest.rows[0].id), messages: [], unread: await unreadCounts(req.actor) });
  }

  // Read the ceiling first and only look up to it, so a message posted
  // between the two queries is left for the next poll rather than skipped.
  const latestResult = await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM ticket_comments');
  const ceiling = Number(latestResult.rows[0].id);

  const params = [afterId, id, ROLE_TO_AUTHOR_TYPE[role], ceiling];
  let sql =
    `SELECT c.id, c.ticket_id, c.author_type, c.author_name, c.visibility, c.body, c.created_at,
            t.subject,
            (SELECT COUNT(*) FROM ticket_attachments ta WHERE ta.comment_id = c.id) AS file_count
     FROM ticket_comments c
     JOIN tickets t ON t.id = c.ticket_id
     WHERE c.id > $1 AND c.id <= $4
       AND COALESCE(c.author_id, '') <> $2
       AND NOT (c.author_id IS NULL AND c.author_type = $3)`;

  if (role === 'user') {
    sql += ` AND t.user_id = $2 AND c.visibility = 'public'`;
  } else if (role === 'agent') {
    sql += ' AND t.assigned_agent_id = $2';
  }
  sql += ` ORDER BY c.id ASC LIMIT ${MAX_MESSAGES}`;

  const messagesResult = await db.query(sql, params);

  const messages = messagesResult.rows.map((m) => ({ ...m, file_count: Number(m.file_count) }));
  // More than one page of messages: advance only as far as what was
  // returned, so the next poll picks up the rest.
  const latestId = messages.length === MAX_MESSAGES
    ? messages[messages.length - 1].id
    : Math.max(afterId, ceiling);

  res.json({ latest_id: latestId, messages, unread: await unreadCounts(req.actor) });
}));

module.exports = router;
