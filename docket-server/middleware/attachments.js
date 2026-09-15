const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/authenticate');
const { getTicket, canAccessTicket } = require('../middleware/authorize');
const { fetchAttachmentFile } = require('../utils/attachment-storage');
const { asyncHandler } = require('../utils/async-handler');

const router = express.Router();

// Same three actors as everywhere else: the ticket's own customer, its
// currently assigned agent, or any admin.
const TICKET_ACCESS = { allowCustomer: true, allowAssignedAgent: true, allowAdmin: true };

// Resolves an attachment row to the ticket it belongs to and the
// visibility that gates it. Per the schema's CHECK constraint, an
// attachment has exactly one parent:
//  - ticket_id set directly -> a creation-time attachment, filed by the
//    customer when the ticket was opened. There's no visibility concept
//    at that point, so it's treated like a public comment's attachment.
//  - comment_id set -> a reply attachment, which inherits its parent
//    comment's visibility (public/internal).
async function resolveAttachment(attachmentId) {
  const attachmentResult = await db.query('SELECT * FROM ticket_attachments WHERE id = $1', [attachmentId]);
  const attachment = attachmentResult.rows[0];
  if (!attachment) return null;

  if (attachment.ticket_id) {
    return { attachment, ticketId: attachment.ticket_id, visibility: 'public' };
  }

  const commentResult = await db.query(
    'SELECT ticket_id, visibility FROM ticket_comments WHERE id = $1',
    [attachment.comment_id]
  );
  const comment = commentResult.rows[0];
  // Not reachable given the FK + CHECK constraint, but a comment-less
  // attachment has nothing to authorize against.
  if (!comment) return null;

  return { attachment, ticketId: comment.ticket_id, visibility: comment.visibility };
}

// GET /api/attachments/:id — proxies the file back from Supabase Storage
// (stored_path) under its original filename, but only after confirming
// the requester has access to the ticket (and, for a reply attachment,
// the visibility) it belongs to.
//
// Every rejection below returns the same 404 "attachment not found",
// whether the attachment doesn't exist, the ticket doesn't exist, the
// actor isn't authorized for it, or it's an internal-only attachment a
// customer is asking for. A 403 or a different message would confirm to
// an unauthorized caller that a given attachment id is real — the same
// reasoning as the visibility=internal case in comments.js.
router.get('/:id', requireAuth(), asyncHandler(async (req, res) => {
  const resolved = await resolveAttachment(req.params.id);
  if (!resolved) {
    return res.status(404).json({ error: 'attachment not found' });
  }

  const ticket = await getTicket(resolved.ticketId);
  if (!ticket || !canAccessTicket(req.actor, ticket, TICKET_ACCESS)) {
    return res.status(404).json({ error: 'attachment not found' });
  }

  const canSeeInternal = req.actor.role === 'agent' || req.actor.role === 'admin';
  if (resolved.visibility === 'internal' && !canSeeInternal) {
    return res.status(404).json({ error: 'attachment not found' });
  }

  if (!resolved.attachment.stored_path) {
    return res.status(404).json({ error: 'attachment not found' });
  }

  // Every check above is identical whether the metadata lives in SQLite
  // or Postgres. Only the last step ever touched a different store:
  // fetch the bytes from Supabase Storage and write them to the response
  // ourselves. The client still only ever talks to our server — it never
  // sees a Supabase URL or the storedPath key.
  const buffer = await fetchAttachmentFile(resolved.attachment.stored_path);
  if (!buffer) {
    return res.status(404).json({ error: 'attachment file is missing in storage' });
  }

  const safeName = String(resolved.attachment.filename).replace(/"/g, "'");
  res.setHeader('Content-Type', resolved.attachment.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.send(buffer);
}));

module.exports = router;
