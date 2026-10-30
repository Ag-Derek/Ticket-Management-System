// Backup and restore, run by hand or from Windows Task Scheduler — never by
// the web server. See docs/recovery.md for setup and the recovery steps.
//
//   node scripts/backup.js keygen --out <folder>
//   node scripts/backup.js create
//   node scripts/backup.js check <file> --key <private key file>
//   node scripts/backup.js restore <file> --key <private key file> --confirm <user@database host> [--skip-attachments]
//
// Modules that need the database or Storage are required inside each command,
// so `keygen` and `check` work with neither configured.

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { generateBackupKeys, writeArchive, readArchive } = require('../utils/backup-archive');

const DEFAULT_RETENTION_DAYS = 30;
const BACKUP_FILE_RE = /^docket-.*\.backup$/;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function keygen({ out }) {
  if (!out) throw new Error('keygen needs --out <folder>');
  fs.mkdirSync(out, { recursive: true });
  const { publicKey, privateKey } = generateBackupKeys();
  // wx: never overwrite a key, because that would orphan every backup made
  // with the old one.
  fs.writeFileSync(path.join(out, 'docket-backup-public.pem'), publicKey, { flag: 'wx' });
  fs.writeFileSync(path.join(out, 'docket-backup-private.pem'), privateKey, { flag: 'wx' });
  console.log(`Wrote both keys to ${out}.`);
  console.log('Save the private key in your password manager, then delete it from this PC.');
}

// One attachment entry per stored file, then the closing 'end' entry. A row
// whose file is gone from Storage is recorded rather than fatal, because it
// would otherwise fail every backup from then on; any other download error
// throws, because that means this backup would be incomplete.
async function* backupEntries(dump, stats) {
  const { fetchAttachmentForBackup } = require('../utils/attachment-storage');
  yield { type: 'database', ...dump };

  const storedPaths = new Set(dump.tables.ticket_attachments.map((a) => a.stored_path).filter(Boolean));
  for (const storedPath of storedPaths) {
    const buffer = await fetchAttachmentForBackup(storedPath);
    if (!buffer) {
      console.warn(`Attachment missing from Storage: ${storedPath}`);
      stats.missing.push(storedPath);
      continue;
    }
    stats.attachments += 1;
    yield { type: 'attachment', path: storedPath, contentBase64: buffer.toString('base64') };
  }
  yield { type: 'end', attachments: stats.attachments, missing: stats.missing };
}

function pruneOldBackups(dir, keepName, retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(dir)) {
    if (!BACKUP_FILE_RE.test(name) || name === keepName) continue;
    const file = path.join(dir, name);
    if (fs.statSync(file).mtimeMs < cutoff) {
      fs.unlinkSync(file);
      console.log(`Removed expired backup ${file}`);
    }
  }
}

// Only called after everything else worked: the heartbeat monitor emails us
// when these pings stop, so a failed backup must not send one.
async function sendHeartbeat() {
  const url = process.env.BACKUP_HEARTBEAT_URL;
  if (!url) {
    console.warn('BACKUP_HEARTBEAT_URL not set — nothing will alert if backups stop.');
    return;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) console.warn(`Heartbeat ping failed: ${response.status}`);
  } catch (err) {
    console.warn('Heartbeat ping failed:', err.message);
  }
}

async function create() {
  const publicKey = fs.readFileSync(requireEnv('BACKUP_PUBLIC_KEY_FILE'), 'utf8');
  const backupDir = requireEnv('BACKUP_DIR');
  const copyDir = requireEnv('BACKUP_COPY_DIR');
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
  if (!(retentionDays > 0)) throw new Error('BACKUP_RETENTION_DAYS must be a positive number');

  const db = require('../db/connection');
  const { snapshotDatabase, rowCounts } = require('../utils/db-backup');
  const { recordAuditLog } = require('../utils/audit');

  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(copyDir, { recursive: true });

  const name = `docket-${new Date().toISOString().replace(/[:.]/g, '-')}.backup`;
  const finalPath = path.join(backupDir, name);
  // Written under another name so an interrupted run never leaves something
  // that looks like a finished backup.
  const partialPath = `${finalPath}.partial`;

  try {
    const dump = await snapshotDatabase();
    const stats = { attachments: 0, missing: [] };
    await writeArchive(partialPath, publicKey, backupEntries(dump, stats));
    fs.renameSync(partialPath, finalPath);
    fs.copyFileSync(finalPath, path.join(copyDir, name));

    pruneOldBackups(backupDir, name, retentionDays);
    pruneOldBackups(copyDir, name, retentionDays);

    const counts = rowCounts(dump);
    const sizeBytes = fs.statSync(finalPath).size;
    await recordAuditLog({
      actorType: 'system',
      action: 'backup.created',
      entityType: 'backup',
      entityId: name,
      details: { sizeBytes, rowCounts: counts, attachments: stats.attachments, missing: stats.missing.length }
    });
    console.log(`Backup ${name}: ${sizeBytes} bytes, ${stats.attachments} attachments, ${stats.missing.length} missing`);
    console.log(counts);
    await sendHeartbeat();
  } finally {
    fs.rmSync(partialPath, { force: true });
    await db.end();
  }
}

// One full pass over the file. A failure here (wrong key, altered or
// truncated file) happens before restore has touched anything.
async function readBackup(file, keyFile) {
  if (file.endsWith('.json')) {
    // Older plain dumps from the removed POST /api/backup.
    return { dump: JSON.parse(fs.readFileSync(file, 'utf8')), end: { attachments: 0, missing: [] } };
  }
  if (!keyFile) throw new Error('needs --key <private key file>');
  const privateKey = fs.readFileSync(keyFile, 'utf8');
  let dump = null;
  let end = null;
  let attachments = 0;
  await readArchive(file, privateKey, (entry) => {
    if (entry.type === 'database') dump = entry;
    if (entry.type === 'attachment') attachments += 1;
    if (entry.type === 'end') end = entry;
  });
  if (!dump || !end || attachments !== end.attachments) {
    throw new Error('backup is incomplete');
  }
  return { dump, end, privateKey };
}

function describe({ dump, end }) {
  const counts = Object.fromEntries(Object.entries(dump.tables).map(([t, rows]) => [t, rows.length]));
  console.log(`Backup taken ${dump.createdAt}: ${end.attachments} attachments, ${end.missing.length} missing`);
  console.log(counts);
}

async function check(file, { key }) {
  if (!file) throw new Error('check needs a backup file');
  describe(await readBackup(file, key));
  console.log('Backup is intact.');
}

async function restore(file, { key, confirm, 'skip-attachments': skipAttachments }) {
  if (!file) throw new Error('restore needs a backup file');
  // Restore wipes the tables it replaces, so the target must be typed out.
  // A Supabase pooler host is shared between projects, so it's the username,
  // which carries the project ref, that identifies the database.
  const { username, hostname } = new URL(requireEnv('DATABASE_URL'));
  const target = `${username}@${hostname}`;
  if (confirm !== target) {
    throw new Error(`This replaces all data in the database ${target}. To go ahead, pass --confirm ${target}`);
  }

  const backup = await readBackup(file, key);
  describe(backup);

  const db = require('../db/connection');
  const { restoreDump } = require('../utils/db-backup');
  const { recordAuditLog } = require('../utils/audit');
  try {
    await db.ensureSchema();
    await restoreDump(backup.dump);
    console.log('Database restored.');

    let restored = 0;
    if (backup.end.attachments && !skipAttachments) {
      const { restoreAttachmentFile } = require('../utils/attachment-storage');
      await readArchive(file, backup.privateKey, async (entry) => {
        if (entry.type !== 'attachment') return;
        await restoreAttachmentFile(entry.path, Buffer.from(entry.contentBase64, 'base64'));
        restored += 1;
      });
      console.log(`Restored ${restored} attachments.`);
    }
    await recordAuditLog({
      actorType: 'system',
      action: 'backup.restored',
      entityType: 'backup',
      entityId: path.basename(file),
      details: { attachments: restored }
    });
  } finally {
    await db.end();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      key: { type: 'string' },
      confirm: { type: 'string' },
      'skip-attachments': { type: 'boolean' }
    }
  });
  const [command, file] = positionals;

  if (command === 'keygen') return keygen(values);
  if (command === 'create') return create();
  if (command === 'check') return check(file, values);
  if (command === 'restore') return restore(file, values);
  throw new Error('usage: backup.js keygen | create | check <file> | restore <file>');
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exitCode = 1;
});
