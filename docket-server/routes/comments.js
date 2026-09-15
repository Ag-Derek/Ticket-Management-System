const express = require('express');
const db = require('../db/connection');
const { saveAttachmentFile } = require('../utils/attachment-storage');
const { requireAuth } = require('../middleware/authenticate');
const { requireTicketAccess } = require('../middleware/authorize');
const { asyncHandler } = require('../utils/async-handler');

// mergeParams so this router can read :ticketId from the parent
// tickets router it's mounted under (see server.js).
const router = express.Router({ mergeParams: true });

// Every ticket-access route below allows the same three actors: the
// customer who owns the ticket, the agent currently assigned to it, or
// any admin. Internal-visibility gating (agents/admins only) is handled
// separately inside each handler, since it depends on more than "does
// this actor have access to the ticket at all".
const TICKET_ACCESS = { allowCustomer: true, allowAssignedAgent: true, allowAdmin: true };

// The auth layer's role names ('user'/'agent'/'admin') predate and differ
// slightly from the ticket_comments schema's author_type naming
// ('customer'/'agent'/'admin') — this is the single place that maps
// between them, instead of scattering the mapping across handlers.
const ROLE_TO_AUTHOR_TYPE = { user: 'customer', agent: 'agent', admin: 'admin' };

// Looks up a display name for author_name from the actor's own account
// record — never from anything the client sent. Falls back to a generic
// label rather than erroring if the row is somehow missing, since a
// missing display name shouldn't block posting a comment.
async function lookupActorName(actor) {
  const table = { user: 'users', agent: 'agents', admin: 'admins' }[actor.role];
  if (!table) return { user: 'Customer', agent: 'Agent', admin: 'Admin' }[actor.role];
  const result = await db.query(`SELECT full_name FROM ${table} WHERE id = $1`, [actor.id]);
  return result.rows[0] ? result.rows[0].full_name : { user: 'Customer', agent: 'Agent', admin: 'Admin' }[actor.role];
}

// GET /api/tickets/:ticketId/comments?visibility=public|internal
// requireTicketAccess already 401s (no/invalid token), 404s (no such
// ticket), and 403s (wrong actor for this ticket) before this handler
// ever runs, so it only has to worry about visibility filtering.
router.get('/', requireAuth(), requireTicketAccess(TICKET_ACCESS), asyncHandler(async (req, res) => {
  const { visibility } = req.query;
  const canSeeInternal = req.actor.role === 'agent' || req.actor.role === 'admin';

  // A customer explicitly requesting ?visibility=internal gets an empty
  // list, not a 403 — same shape as "there happen to be no internal
  // comments", so it doesn't confirm or deny their existence.
  if (visibility === 'internal' && !canSeeInternal) {
    return res.json([]);
  }

  let sql = 'SELECT * FROM ticket_comments WHERE ticket_id = $1';
  const params = [req.params.ticketId];

  if (visibility) {
    params.push(visibility);
    sql += ` AND visibility = $${params.length}`;
  } else if (!canSeeInternal) {
    // No filter requested: a customer's unfiltered view still never
    // includes internal notes.
    sql += " AND visibility = 'public'";
  }
  sql += ' ORDER BY created_at ASC';

  const commentsResult = await db.query(sql, params);
  // Files carry an id (so the client can build a download link) and
  // filename only — stored_path never goes to the client.
  const withFiles = await Promise.all(commentsResult.rows.map(async (c) => {
    const filesResult = await db.query('SELECT id, filename FROM ticket_attachments WHERE comment_id = $1', [c.id]);
    return { ...c, files: filesResult.rows };
  }));
  res.json(withFiles);
}));

// Validates one incoming attachment payload and — if it carries content —
// uploads it immediately. Same contract as tickets.js's
// normalizeIncomingAttachment (kept as a separate copy here since these
// two routers don't currently share a utils file for the validation
// shape, only for the actual upload logic in attachment-storage.js).
async function normalizeIncomingAttachment(ticketId, a) {
  if (!a) return null;
  if (typeof a === 'string') {
    const filename = a.trim();
    return filename ? { filename, mime_type: null, size_bytes: null, stored_path: null } : null;
  }
  const filename = a.filename && String(a.filename).trim();
  if (!filename) return null;
  if (!a.content_base64) {
    return { filename, mime_type: a.mime_type || null, size_bytes: null, stored_path: null };
  }
  const { storedPath, sizeBytes } = await saveAttachmentFile(ticketId, filename, a.content_base64);
  return { filename, mime_type: a.mime_type || null, size_bytes: sizeBytes, stored_path: storedPath };
}

// POST /api/tickets/:ticketId/comments
// { visibility?: 'public'|'internal', body, files?: [{ filename, content_base64, mime_type? }, ...] }
// author_type and author_name are NOT read from the body — they come
// entirely from req.actor, set by requireAuth() from the verified token.
// A message needs text or at least one file — matches the chat composer,
// which blocks sending an empty message with no attachment.
router.post('/', requireAuth(), requireTicketAccess(TICKET_ACCESS), asyncHandler(async (req, res) => {
  const { visibility, body, files } = req.body || {};
  const authorType = ROLE_TO_AUTHOR_TYPE[req.actor.role];
  const authorName = await lookupActorName(req.actor);

  // requireTicketAccess has already confirmed the ticket exists and this
  // actor may act on it, so attachment writes below only ever happen for
  // an authorized caller.
  let normalizedFiles;
  try {
    normalizedFiles = Array.isArray(files)
      ? (await Promise.all(files.map((f) => normalizeIncomingAttachment(req.params.ticketId, f)))).filter(Boolean)
      : [];
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if ((!body || !body.trim()) && !normalizedFiles.length) {
    return res.status(400).json({ error: 'a message needs body text or at least one file' });
  }
  const vis = visibility || 'public';
  if (!['public', 'internal'].includes(vis)) {
    return res.status(400).json({ error: "visibility must be 'public' or 'internal'" });
  }
  // Only agents/admins can post internal notes — checked against the
  // authenticated role, so a customer can no longer get an internal note
  // recorded just by sending author_type: 'agent' in the body.
  if (authorType === 'customer' && vis === 'internal') {
    return res.status(400).json({ error: 'customer comments cannot be marked internal' });
  }

  let commentId;
  try {
    commentId = await db.withTransaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO ticket_comments (ticket_id, author_type, author_name, visibility, body)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [req.params.ticketId, authorType, authorName, vis, (body || '').trim()]
      );
      const newCommentId = insertResult.rows[0].id;

      // comment_id only, ticket_id left null — ticket_attachments' CHECK
      // constraint requires exactly one of the two (see schema.sql). The
      // owning ticket is reached through comment_id -> ticket_comments.ticket_id.
      for (const f of normalizedFiles) {
        await client.query(
          `INSERT INTO ticket_attachments (comment_id, filename, mime_type, size_bytes, stored_path)
           VALUES ($1, $2, $3, $4, $5)`,
          [newCommentId, f.filename, f.mime_type, f.size_bytes, f.stored_path]
        );
      }

      await client.query(`UPDATE tickets SET updated_at = now() WHERE id = $1`, [req.params.ticketId]);
      return newCommentId;
    });
  } catch (err) {
    console.error('POST /api/tickets/:ticketId/comments: failed to persist comment', err);
    return res.status(500).json({ error: 'failed to post comment' });
  }

  const createdResult = await db.query('SELECT * FROM ticket_comments WHERE id = $1', [commentId]);
  const createdFilesResult = await db.query('SELECT id, filename FROM ticket_attachments WHERE comment_id = $1', [commentId]);
  res.status(201).json({ ...createdResult.rows[0], files: createdFilesResult.rows });
}));

module.exports = router;
