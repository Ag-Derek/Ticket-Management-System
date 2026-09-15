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

module.exports = { saveAttachmentFile, fetchAttachmentFile, sanitizeFilename, MAX_ATTACHMENT_BYTES, BUCKET };
