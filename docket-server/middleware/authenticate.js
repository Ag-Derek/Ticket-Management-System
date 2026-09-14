// Minimal stateless session tokens, built on Node's built-in crypto rather
// than pulling in jsonwebtoken — swap this out for a real JWT lib later if
// the project already depends on one; the shape (signToken / requireAuth)
// won't need to change at the call sites in routes/auth.js or elsewhere.
//
// Token = base64url(payload) + '.' + base64url(HMAC-SHA256(payload, secret))
// Payload = { ownerType, ownerId, iat, exp }
//
// AUTH_TOKEN_SECRET must be set in production. The fallback below is only
// so local dev doesn't crash on a missing .env — it deliberately logs a
// warning every time it's used so it can't go unnoticed.

const crypto = require('crypto');

const SECRET = process.env.AUTH_TOKEN_SECRET || (() => {
  console.warn(
    'WARNING: AUTH_TOKEN_SECRET is not set — using an insecure default. ' +
    'Set AUTH_TOKEN_SECRET in your environment before deploying.'
  );
  return 'dev-only-insecure-secret';
})();

const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

function signToken({ ownerType, ownerId }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { ownerType, ownerId, iat: now, exp: now + TOKEN_TTL_SECONDS };
  const payloadB64 = base64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

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
  return payload; // { ownerType, ownerId, iat, exp }
}

// Authentication only — confirms who the caller is. Pass allowedRoles to
// additionally authorize ("who's allowed here"), e.g.
// requireAuth(['admin']) vs requireAuth(['admin', 'agent']) vs requireAuth()
// for "any logged-in actor". Keeping these as separate arguments (not two
// separate middlewares) mirrors the point made earlier: one login/auth
// mechanism, with authorization layered on top per-route.
function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = verifyToken(token);

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

module.exports = { signToken, verifyToken, requireAuth };
