const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Persistent disk root for attachment files — same volume the SQLite file
// itself lives on (see db/connection.js), so files survive restarts and
// redeploys the same way the database already does. Override with the
// ATTACHMENTS_DIR env var if your disk is mounted somewhere other than
// /data.
const ATTACHMENTS_ROOT = process.env.ATTACHMENTS_DIR || '/data/attachments';

// Matches app.js's own cap in readFileAsAttachment — kept in sync manually
// since the client and server run in different processes.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// Strips path separators and ".." so a crafted filename (e.g.
// "../../etc/passwd") can't escape the ticket's attachment folder. Only
// used to build the on-disk name — the original filename the user chose
// is preserved as-is in the `filename` column for display/download.
function sanitizeFilename(name) {
  return String(name).replace(/[/\\]/g, '_').replace(/\.\./g, '_').trim() || 'file';
}

// Decodes base64, enforces the size cap, and writes the file to
// /data/attachments/<ticketId>/<random>-<filename>. The random prefix
// avoids collisions between attachments that share a filename on the same
// ticket, without needing a database round trip first to learn the row's
// id. Returns { storedPath, sizeBytes }; throws if the decoded file is
// over the cap.
function saveAttachmentFile(ticketId, filename, contentBase64) {
  const buffer = Buffer.from(contentBase64, 'base64');
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`"${filename}" is larger than 5MB — attachments are capped at 5MB each.`);
  }

  const dir = path.join(ATTACHMENTS_ROOT, String(ticketId));
  fs.mkdirSync(dir, { recursive: true });

  const diskName = crypto.randomBytes(6).toString('hex') + '-' + sanitizeFilename(filename);
  const storedPath = path.join(dir, diskName);
  fs.writeFileSync(storedPath, buffer);

  return { storedPath, sizeBytes: buffer.length };
}

module.exports = { saveAttachmentFile, sanitizeFilename, MAX_ATTACHMENT_BYTES, ATTACHMENTS_ROOT };
