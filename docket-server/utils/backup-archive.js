// The encrypted backup file format. No database or Storage in here, so a
// backup can be checked with neither available.
//
// Encryption is hybrid: each file gets a random AES-256-GCM key, and that key
// is stored in the file wrapped with an RSA public key. The machine taking
// backups only ever needs the public key, so it can't read the backups it
// writes; only the private key, kept off that machine, can.
//
// File layout: magic | wrapped key length (uint16) | wrapped key | iv |
// ciphertext | auth tag. The plaintext is gzipped newline-delimited JSON, one
// entry per line, so attachments are streamed rather than held in memory:
//   { type: 'database', createdAt, tables }
//   { type: 'attachment', path, contentBase64 }   (one per file)
//   { type: 'end', attachments, missing }
// A file without its 'end' entry was cut short and isn't a complete backup.

const crypto = require('crypto');
const fs = require('fs');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const zlib = require('zlib');

const MAGIC = Buffer.from('DOCKETBK1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const NEWLINE = 0x0a;

const OAEP = { padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };

function generateBackupKeys() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

async function* toLines(entries) {
  for await (const entry of entries) {
    yield Buffer.from(JSON.stringify(entry) + '\n', 'utf8');
  }
}

// Writes `entries` (any iterable, sync or async) to filePath.
async function writeArchive(filePath, publicKeyPem, entries) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(IV_BYTES);
  const wrappedKey = crypto.publicEncrypt({ key: publicKeyPem, ...OAEP }, key);

  const keyLength = Buffer.alloc(2);
  keyLength.writeUInt16BE(wrappedKey.length);
  const header = Buffer.concat([MAGIC, keyLength, wrappedKey, iv]);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);

  await pipeline(
    Readable.from(toLines(entries)),
    zlib.createGzip(),
    cipher,
    async function* (ciphertext) {
      yield header;
      yield* ciphertext;
      yield cipher.getAuthTag();
    },
    fs.createWriteStream(filePath)
  );
}

function readHeader(fd) {
  const fixed = Buffer.alloc(MAGIC.length + 2);
  fs.readSync(fd, fixed, 0, fixed.length, 0);
  if (!fixed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('not a Docket backup file');
  }
  const rest = Buffer.alloc(fixed.readUInt16BE(MAGIC.length) + IV_BYTES);
  fs.readSync(fd, rest, 0, rest.length, fixed.length);
  return Buffer.concat([fixed, rest]);
}

// Calls onEntry (awaited) for each entry, in order. Rejects if the file was
// altered or the key is wrong — but only once the whole file has been read,
// because the auth tag sits at the end. Anything destructive must therefore
// wait for a complete first pass (see readBackup in scripts/backup.js).
async function readArchive(filePath, privateKeyPem, onEntry) {
  const fd = fs.openSync(filePath, 'r');
  let header, tag, cipherStart, cipherEnd;
  try {
    const { size } = fs.fstatSync(fd);
    header = readHeader(fd);
    tag = Buffer.alloc(TAG_BYTES);
    fs.readSync(fd, tag, 0, TAG_BYTES, size - TAG_BYTES);
    cipherStart = header.length;
    cipherEnd = size - TAG_BYTES - 1;
  } finally {
    fs.closeSync(fd);
  }

  const wrappedLength = header.readUInt16BE(MAGIC.length);
  const wrappedKey = header.subarray(MAGIC.length + 2, MAGIC.length + 2 + wrappedLength);
  const iv = header.subarray(header.length - IV_BYTES);
  const key = crypto.privateDecrypt({ key: privateKeyPem, ...OAEP }, wrappedKey);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);

  await pipeline(
    fs.createReadStream(filePath, { start: cipherStart, end: cipherEnd }),
    decipher,
    zlib.createGunzip(),
    async (plaintext) => {
      let pending = [];
      for await (const chunk of plaintext) {
        let start = 0;
        let newline;
        while ((newline = chunk.indexOf(NEWLINE, start)) !== -1) {
          pending.push(chunk.subarray(start, newline));
          await onEntry(JSON.parse(Buffer.concat(pending).toString('utf8')));
          pending = [];
          start = newline + 1;
        }
        pending.push(chunk.subarray(start));
      }
    }
  );
}

module.exports = { generateBackupKeys, writeArchive, readArchive };
