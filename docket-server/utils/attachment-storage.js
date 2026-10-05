const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'attachments';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}

// Service-role client — bypasses RLS, since Docket's own server is the
// security boundary (auth + ticket-access checks happen in
// attachments.js/comments.js/tickets.js before this module is ever
// called). This key must never reach the frontend.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Matches app.js's own cap in readFileAsAttachment — kept in sync manually
// since the client and server run in different processes.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// Strips path separators and ".." so a crafted filename (e.g.
// "../../etc/passwd") can't escape the ticket's attachment folder. Only
// used to build the storage key — the original filename the user chose
// is preserved as-is in the `filename` column for display/download.
function sanitizeFilename(name) {
  return String(name).replace(/[/\\]/g, '_').replace(/\.\./g, '_').trim() || 'file';
}

// Decodes base64, enforces the size cap, and uploads the file to
// <ticketId>/<random>-<filename> in the Supabase Storage bucket. The
// random prefix avoids collisions between attachments that share a
// filename on the same ticket, without needing a database round trip
// first to learn the row's id. Returns { storedPath, sizeBytes }; throws
// if the decoded file is over the cap or the upload fails. storedPath is
// now a bucket-relative key rather than a filesystem path, but it's still
// just an opaque string to everything downstream.
async function saveAttachmentFile(ticketId, filename, contentBase64) {
  const buffer = Buffer.from(contentBase64, 'base64');
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`"${filename}" is larger than 5MB — attachments are capped at 5MB each.`);
  }

  const diskName = crypto.randomBytes(6).toString('hex') + '-' + sanitizeFilename(filename);
  const storedPath = `${ticketId}/${diskName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(storedPath, buffer, { upsert: false });
  if (error) {
    throw new Error(`failed to upload "${filename}" to storage: ${error.message}`);
  }

  return { storedPath, sizeBytes: buffer.length };
}

// Fetches a file's bytes back out of Storage so attachments.js can proxy
// them to the client. Returns a Buffer, or null if the object is missing
// (deleted from the bucket out-of-band, storedPath is stale, etc.).
async function fetchAttachmentFile(storedPath) {
  const { data, error } = await supabase.storage.from(BUCKET).download(storedPath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

// Best-effort removal of stored files when their ticket is deleted. The DB
// rows are already gone by the time this runs, so a failure here only
// leaves an orphaned object in the bucket — logged, never thrown.
async function removeAttachmentFiles(storedPaths) {
  const paths = storedPaths.filter(Boolean);
  if (!paths.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) console.error('removeAttachmentFiles: failed to remove from storage', error);
}

// Uploads every item with `upload` (which resolves to an attachment record
// with a stored_path, or null to skip). All or nothing: if any one fails —
// say the third file is over the size cap — the ones that already made it
// to Storage are removed again before the error is rethrown, instead of
// being left orphaned in the bucket.
async function uploadAllOrNone(items, upload) {
  const results = await Promise.allSettled(items.map(upload));
  const failure = results.find((r) => r.status === 'rejected');
  if (failure) {
    const uploaded = results.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value.stored_path);
    await removeAttachmentFiles(uploaded).catch((err) => console.error('uploadAllOrNone: cleanup failed', err));
    throw failure.reason;
  }
  return results.map((r) => r.value).filter(Boolean);
}

// Validates one incoming attachment payload and — if it carries content —
// uploads it immediately, before any DB row exists for it. Accepts the
// { filename, content_base64, mime_type? } shape the client sends; also
// tolerates a bare filename string or an object with no content_base64
// (nothing to upload, so stored_path stays null).
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

// The request body's attachment list (ticket attachments or chat files),
// validated and uploaded all-or-nothing. Anything that isn't an array is
// treated as no attachments. Throws a user-facing error (e.g. over the size
// cap) for the route to return as a 400.
async function uploadIncomingAttachments(ticketId, items) {
  if (!Array.isArray(items)) return [];
  return uploadAllOrNone(items, (a) => normalizeIncomingAttachment(ticketId, a));
}

// Inserts the rows for already-uploaded attachments, inside the caller's
// transaction. `parent` is exactly one of { ticketId } or { commentId } —
// ticket_attachments' CHECK constraint requires one and only one (see
// schema.sql); a comment's attachment reaches its ticket through
// comment_id -> ticket_comments.ticket_id.
async function insertAttachmentRows(client, parent, attachments) {
  for (const a of attachments) {
    await client.query(
      `INSERT INTO ticket_attachments (ticket_id, comment_id, filename, mime_type, size_bytes, stored_path)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [parent.ticketId || null, parent.commentId || null, a.filename, a.mime_type, a.size_bytes, a.stored_path]
    );
  }
}

module.exports = {
  saveAttachmentFile,
  fetchAttachmentFile,
  removeAttachmentFiles,
  uploadAllOrNone,
  uploadIncomingAttachments,
  insertAttachmentRows,
  sanitizeFilename,
  MAX_ATTACHMENT_BYTES,
  BUCKET
};
