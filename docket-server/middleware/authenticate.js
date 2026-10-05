// Minimal stateless session tokens, built on Node's built-in crypto rather
// than pulling in jsonwebtoken — swap this out for a real JWT lib later if
// the project already depends on one; the shape (signToken / requireAuth)
// won't need to change at the call sites in routes/auth.js or elsewhere.
//
// Token = base64url(payload) + '.' + base64url(HMAC-SHA256(payload, secret))
// Payload = { ownerType, ownerId, tv, iat, exp }
//
// The signature alone can't be taken back once issued, so every request
// also checks `tv` against the owner's current token_version (see
// db/schema.sql). Bumping that column — revokeSessions() below — signs the
// account out everywhere, and a deleted account has no row left to match,
// so its tokens stop working immediately too.
//
// AUTH_TOKEN_SECRET must be set; the server refuses to start without it.

require('dotenv').config();

const crypto = require('crypto');
const db = require('../db/connection');

const SECRET = process.env.AUTH_TOKEN_SECRET;

if (!SECRET) {
  throw new Error('AUTH_TOKEN_SECRET is not set');
}

const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours

const OWNER_TABLES = { user: 'users', agent: 'agents', admin: 'admins' };

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

// tokenVersion is the owner row's token_version at sign-in.
function signToken({ ownerType, ownerId, tokenVersion }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { ownerType, ownerId, tv: tokenVersion || 0, iat: now, exp: now + TOKEN_TTL_SECONDS };
  const payloadB64 = base64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

// Signature + expiry only — no database. Use authenticateToken() to decide
// whether a request is actually signed in.
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, signature] = token.split('.');
  const expected = sign(payloadB64);

  // Constant-time comparison to avoid a timing side-channel on the signature check.
  const a = Buffer.from(signature || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null; // expired
  return payload; // { ownerType, ownerId, tv, iat, exp }
}

// Full check: valid signature, not expired, the account still exists, and
// it hasn't been signed out everywhere since this token was issued. Tokens
// minted before token_version existed have no `tv` and count as version 0,
// so they keep working until the account's first revocation.
// Returns the payload, or null. Throws only on a database failure.
async function authenticateToken(token) {
  const payload = verifyToken(token);
  if (!payload) return null;
  const table = OWNER_TABLES[payload.ownerType];
  if (!table) return null;

  const result = await db.query(`SELECT token_version FROM ${table} WHERE id = $1`, [payload.ownerId]);
  const row = result.rows[0];
  if (!row || row.token_version !== (payload.tv || 0)) return null;
  return payload;
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Signs an account out of every device. Pass `client` to run inside an
// existing db.withTransaction().
async function revokeSessions(ownerType, ownerId, client) {
  const table = OWNER_TABLES[ownerType];
  if (!table) throw new Error(`unknown owner type: ${ownerType}`);
  await (client || db).query(`UPDATE ${table} SET token_version = token_version + 1 WHERE id = $1`, [ownerId]);
}

// Authentication only — confirms who the caller is. Pass allowedRoles to
// additionally authorize ("who's allowed here"), e.g.
// requireAuth(['admin']) vs requireAuth(['admin', 'agent']) vs requireAuth()
// for "any logged-in actor". Keeping these as separate arguments (not two
// separate middlewares) mirrors the point made earlier: one login/auth
// mechanism, with authorization layered on top per-route.
function requireAuth(allowedRoles = []) {
  return async (req, res, next) => {
    let payload;
    try {
      payload = await authenticateToken(bearerToken(req));
    } catch (err) {
      // An async middleware that throws would be an unhandled rejection —
      // answer like any other DB failure instead.
      console.error('requireAuth: failed to check session', err);
      return res.status(500).json({ error: 'failed to check session' });
    }

    if (!payload) {
      return res.status(401).json({ error: 'Missing or invalid authorization token' });
    }
    if (allowedRoles.length && !allowedRoles.includes(payload.ownerType)) {
      return res.status(403).json({ error: 'Not authorized for this action' });
    }

    req.actor = { role: payload.ownerType, id: payload.ownerId };
    next();
  };
}

module.exports = { signToken, verifyToken, authenticateToken, bearerToken, revokeSessions, requireAuth };
