// POST /api/auth/login
//
// Deliberately generic: this route knows nothing about "admin login" vs
// "agent login" vs "user login" — it just authenticates an (email,
// password) pair against whichever row in users/agents/admins owns that
// email, using auth_credentials for the actual credential check.
// Authorization (what an admin vs agent vs user is *allowed to do* once
// logged in) is a separate concern, handled by requireAuth(role) in
// middleware/authenticate.js on individual routes — not by having three
// separate login endpoints.
//
// A correct password doesn't log you in by itself: it starts an email MFA
// challenge (see utils/mfa.js) and the token is issued by POST /mfa/verify.

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { signToken, requireAuth, revokeSessions } = require('../middleware/authenticate');
const { recordAuditLog, resolveActorName } = require('../utils/audit');
const { nextId } = require('../utils/ids');
const { createChallenge, verifyChallenge, resendChallenge, MfaError, sendMfaError } = require('../utils/mfa');
const { requestReset, completeReset, sendPasswordChangedEmail, PasswordResetError } = require('../utils/password-reset');
const { appLink } = require('../utils/email');

const router = express.Router();

// (table, owner_type) pairs to search for the email. Order doesn't imply
// priority — login requires a role so it only ever checks one table, and a
// password reset without a role sends nothing when the email is on more
// than one, rather than resolving it by "first match wins".
const OWNER_TABLES = [
  { table: 'users', ownerType: 'user' },
  { table: 'agents', ownerType: 'agent' },
  { table: 'admins', ownerType: 'admin' }
];

async function findOwnerByEmail(email, roleHint) {
  const candidates = [];
  for (const { table, ownerType } of OWNER_TABLES) {
    if (roleHint && ownerType !== roleHint) continue;
    // lower() on the column too, so a row stored with capitals before emails
    // were normalized still matches.
    const result = await db.query(`SELECT id, email, full_name FROM ${table} WHERE lower(email) = $1`, [email]);
    if (result.rows[0]) candidates.push({ ownerType, ...result.rows[0] });
  }
  return candidates;
}

// A bcrypt hash (same cost as real ones, see db/seed.js) of a password
// nobody uses. Failures that have no real hash to check still compare
// against this, so an unknown email takes as long to reject as a wrong
// password and the response time doesn't reveal which emails have accounts.
const DUMMY_PASSWORD_HASH = '$2a$10$CWwGGA5C9P8zL5l5CXaNkeNHzsomWqNyCZsWFOme1venfB/8fmrm.';

router.post('/login', async (req, res) => {
  const { password, role } = req.body || {};
  // Same normalization as POST /api/users and /api/agents, so " Admin@X.com"
  // isn't reported as a wrong password.
  const email = typeof (req.body || {}).email === 'string' ? req.body.email.trim().toLowerCase() : '';

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  // role is required, so the lookup checks exactly one table and can match
  // at most one account. Without it, an email on more than one account type
  // would need its own response, which would reveal those account types.
  if (!OWNER_TABLES.some((t) => t.ownerType === role)) {
    return res.status(400).json({ error: `role is required and must be one of: ${OWNER_TABLES.map((t) => t.ownerType).join(', ')}` });
  }

  try {
    const [owner] = await findOwnerByEmail(email, role);

    if (!owner) {
      await bcrypt.compare(String(password), DUMMY_PASSWORD_HASH);
      recordAuditLog({
        actorType: role,
        action: 'auth.login_failed',
        details: { email, reason: 'no such account' }
      });
      // Same response (and roughly the same time) as a wrong password —
      // don't reveal whether the email exists at all.
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const credResult = await db.query(
      'SELECT * FROM auth_credentials WHERE owner_type = $1 AND owner_id = $2',
      [owner.ownerType, owner.id]
    );
    const cred = credResult.rows[0];

    if (!cred || cred.auth_provider !== 'local' || !cred.password_hash) {
      await bcrypt.compare(String(password), DUMMY_PASSWORD_HASH);
      recordAuditLog({
        actorType: owner.ownerType,
        actorId: owner.id,
        actorName: owner.full_name,
        action: 'auth.login_failed',
        details: { email, reason: 'no local credentials' }
      });
      // No credentials row at all (never set a password), or an SSO-only
      // account trying to use password login.
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await bcrypt.compare(String(password), cred.password_hash);
    if (!ok) {
      recordAuditLog({
        actorType: owner.ownerType,
        actorId: owner.id,
        actorName: owner.full_name,
        action: 'auth.login_failed',
        details: { email, reason: 'wrong password' }
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Password is right — but no token yet. The token only comes out of
    // POST /mfa/verify once the emailed code is entered.
    const challenge = await createChallenge({
      ownerType: owner.ownerType,
      ownerId: owner.id,
      email: owner.email,
      fullName: owner.full_name
    });

    recordAuditLog({
      actorType: owner.ownerType,
      actorId: owner.id,
      actorName: owner.full_name,
      action: 'auth.mfa_sent',
      details: { email }
    });

    res.json(challenge);
  } catch (err) {
    if (err instanceof MfaError) return sendMfaError(res, err);
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: 'failed to sign in' });
  }
});

const PROFILE_FIELDS = ['full_name', 'phone', 'department', 'organization'];

// A returning customer who submitted the profile form (POST /api/users)
// carries their new details in context.pending. Apply them here, after the
// code is verified, so nobody can change an account they don't control.
// COALESCE keeps the current value for any field left blank (null).
// Email-only sign-in (POST /api/users/sign-in) has no pending, so never
// reaches this.
async function applyProfileUpdate(current, pending) {
  const values = PROFILE_FIELDS.map((f) => pending[f] || null);
  const changed = PROFILE_FIELDS.filter((f, i) => values[i] !== null && values[i] !== current[f]);
  if (!changed.length) return current;

  const result = await db.query(
    `UPDATE users SET
       full_name    = COALESCE($2, full_name),
       phone        = COALESCE($3, phone),
       department   = COALESCE($4, department),
       organization = COALESCE($5, organization)
     WHERE id = $1 RETURNING *`,
    [current.id, ...values]
  );
  const updated = result.rows[0] || current;

  const changes = {};
  for (const f of changed) changes[f] = { from: current[f], to: updated[f] };
  recordAuditLog({
    actorType: 'user',
    actorId: updated.id,
    actorName: updated.full_name,
    action: 'user.profile_updated',
    entityType: 'user',
    entityId: updated.id,
    details: { changes }
  });

  return updated;
}

// Finds the account a verified challenge belongs to — or, for a first-time
// customer sign-up, creates it now that the email is proven. Agents and
// admins are never created here: agents are invite-only (an admin adds
// them), so their challenges always carry an owner_id. Returns
// { record, created }.
async function resolveChallengeOwner(challenge) {
  const table = OWNER_TABLES.find((t) => t.ownerType === challenge.owner_type).table;

  const pending = challenge.context.pending;

  if (challenge.owner_id) {
    const result = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [challenge.owner_id]);
    const current = result.rows[0];
    if (!current || !pending || table !== 'users') return { record: current, created: false };
    return { record: await applyProfileUpdate(current, pending), created: false };
  }

  if (!pending || table !== 'users') return { record: null, created: false };

  // Two sign-ups for the same new email can both reach here; the second one
  // just picks up the row the first created.
  const existing = await db.query('SELECT * FROM users WHERE email = $1', [challenge.email]);
  if (existing.rows[0]) return { record: existing.rows[0], created: false };

  const id = await nextId(db, 'users', 'USR');
  const inserted = await db.query(
    `INSERT INTO users (id, full_name, email, phone, department, organization)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING RETURNING *`,
    [id, pending.full_name, challenge.email, pending.phone || null, pending.department || null, pending.organization || null]
  );

  if (inserted.rows[0]) return { record: inserted.rows[0], created: true };
  const raced = await db.query('SELECT * FROM users WHERE email = $1', [challenge.email]);
  return { record: raced.rows[0], created: false };
}

// POST /api/auth/mfa/verify  { challengeId, code }
// The only route that issues a session token. Response:
//   { token, actor: { id, email, full_name, role }, record, returning }
// where `record` is the full users/agents/admins row.
router.post('/mfa/verify', async (req, res) => {
  const { challengeId, code } = req.body || {};

  try {
    const challenge = await verifyChallenge(challengeId, code);
    const { record, created } = await resolveChallengeOwner(challenge);

    if (!record) {
      // The account was deleted between login and verify.
      return res.status(401).json({ error: 'This account no longer exists.', restart: true });
    }

    await db.query(
      `UPDATE auth_credentials SET last_login_at = now(), updated_at = now()
       WHERE owner_type = $1 AND owner_id = $2`,
      [challenge.owner_type, record.id]
    );

    const token = signToken({ ownerType: challenge.owner_type, ownerId: record.id, tokenVersion: record.token_version });

    recordAuditLog({
      actorType: challenge.owner_type,
      actorId: record.id,
      actorName: record.full_name,
      action: 'auth.login_success',
      details: { email: record.email, mfa: 'email' }
    });

    res.json({
      token,
      actor: {
        id: record.id,
        email: record.email,
        full_name: record.full_name,
        role: challenge.owner_type
      },
      record,
      returning: !created
    });
  } catch (err) {
    if (err instanceof MfaError) {
      const challenge = err.extra.challenge;
      recordAuditLog({
        actorType: challenge ? challenge.owner_type : 'unknown',
        actorId: challenge ? challenge.owner_id : null,
        action: 'auth.mfa_failed',
        details: { email: challenge ? challenge.email : null, reason: err.message }
      });
      return sendMfaError(res, err);
    }
    console.error('POST /api/auth/mfa/verify error:', err);
    res.status(500).json({ error: 'failed to verify code' });
  }
});

// POST /api/auth/mfa/resend  { challengeId }
router.post('/mfa/resend', async (req, res) => {
  try {
    res.json(await resendChallenge((req.body || {}).challengeId));
  } catch (err) {
    if (err instanceof MfaError) return sendMfaError(res, err);
    console.error('POST /api/auth/mfa/resend error:', err);
    res.status(500).json({ error: 'failed to resend code' });
  }
});

// POST /api/auth/sign-out-everywhere
// Ends every session for the caller's account, on every device — including
// the one making this request, so the client should send the person back to
// sign-in afterwards.
router.post('/sign-out-everywhere', requireAuth(), async (req, res) => {
  try {
    await revokeSessions(req.actor.role, req.actor.id);
    recordAuditLog({
      actorType: req.actor.role,
      actorId: req.actor.id,
      actorName: await resolveActorName(req.actor),
      action: 'auth.sessions_revoked',
      details: { reason: 'sign out everywhere' }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/sign-out-everywhere error:', err);
    res.status(500).json({ error: 'failed to sign out' });
  }
});

// POST /api/auth/password-reset/request  { email, role? }
// Always answers the same way whether or not the email has an account (or
// a password, or has hit the request limit), and does the lookup + send
// after responding, so neither the body nor the response time reveals
// which emails are registered.
const RESET_REQUESTED_MESSAGE =
  "If that email belongs to an account with a password, we've sent a link to reset it. Check your inbox.";

router.post('/password-reset/request', (req, res) => {
  const { role } = req.body || {};
  const email = typeof (req.body || {}).email === 'string' ? req.body.email.trim().toLowerCase() : '';

  if (!email) return res.status(400).json({ error: 'email is required' });
  if (role && !OWNER_TABLES.some((t) => t.ownerType === role)) {
    return res.status(400).json({ error: `role must be one of: ${OWNER_TABLES.map((t) => t.ownerType).join(', ')}` });
  }
  if (!appLink('')) {
    console.error('Password reset requested but APP_URL is not set — cannot build a reset link.');
    return res.status(503).json({ error: 'Password reset is not available right now. Contact your administrator.' });
  }

  res.json({ ok: true, message: RESET_REQUESTED_MESSAGE });

  (async () => {
    const matches = await findOwnerByEmail(email, role);
    // Ambiguous (same email on two account types) or unknown: send nothing.
    if (matches.length !== 1) return;
    const owner = matches[0];
    const sent = await requestReset({ ownerType: owner.ownerType, id: owner.id, email: owner.email, full_name: owner.full_name });
    recordAuditLog({
      actorType: owner.ownerType,
      actorId: owner.id,
      actorName: owner.full_name,
      action: 'auth.password_reset_requested',
      details: { email, sent }
    });
  })().catch((err) => console.error('POST /api/auth/password-reset/request error:', err));
});

// POST /api/auth/password-reset/confirm  { token, password }
// Doesn't sign the person in — they go back to the login page and sign in
// (with MFA) using the new password. Every existing session for the account
// is ended as part of the reset (see completeReset), so whoever prompted
// the reset can't stay signed in on the old password.
router.post('/password-reset/confirm', async (req, res) => {
  const { token, password } = req.body || {};
  try {
    const owner = await completeReset(token, password);

    recordAuditLog({
      actorType: owner.ownerType,
      actorId: owner.id,
      actorName: owner.full_name,
      action: 'auth.password_reset_completed',
      details: { email: owner.email }
    });

    if (owner.email) {
      sendPasswordChangedEmail(owner).catch((err) => console.error('Password reset: failed to send confirmation email:', err));
    }

    res.json({ ok: true, role: owner.ownerType });
  } catch (err) {
    if (err instanceof PasswordResetError) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/auth/password-reset/confirm error:', err);
    res.status(500).json({ error: 'failed to reset password' });
  }
});

module.exports = router;
