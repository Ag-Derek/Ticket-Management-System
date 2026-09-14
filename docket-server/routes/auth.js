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

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { signToken } = require('../middleware/authenticate');

const router = express.Router();

// (table, owner_type) pairs to search for the email. Order doesn't imply
// priority — an email existing in more than one table is treated as a
// data problem (see below), not resolved by "first match wins".
const OWNER_TABLES = [
  { table: 'users', ownerType: 'user' },
  { table: 'agents', ownerType: 'agent' },
  { table: 'admins', ownerType: 'admin' }
];

function findOwnerByEmail(email, roleHint) {
  const candidates = OWNER_TABLES
    .filter((t) => !roleHint || t.ownerType === roleHint)
    .map(({ table, ownerType }) => {
      const row = db.prepare(`SELECT id, email, full_name FROM ${table} WHERE email = ?`).get(email);
      return row ? { ownerType, ...row } : null;
    })
    .filter(Boolean);
  return candidates;
}

router.post('/login', (req, res) => {
  const { email, password, role } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  if (role && !OWNER_TABLES.some((t) => t.ownerType === role)) {
    return res.status(400).json({ error: `role must be one of: ${OWNER_TABLES.map((t) => t.ownerType).join(', ')}` });
  }

  const matches = findOwnerByEmail(email, role);

  if (matches.length === 0) {
    // Same response as a wrong password — don't reveal whether the email
    // exists at all.
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (matches.length > 1) {
    // The same email exists as e.g. both a user and an agent. That's a
    // data-integrity issue, not something the login route should silently
    // guess its way through — ask the caller to disambiguate.
    console.error(`Login: email ${email} matches multiple owner types: ${matches.map((m) => m.ownerType).join(', ')}`);
    return res.status(409).json({
      error: 'This email is associated with more than one account type. Specify which one to log in as.',
      roles: matches.map((m) => m.ownerType)
    });
  }

  const owner = matches[0];
  const cred = db.prepare(
    'SELECT * FROM auth_credentials WHERE owner_type = ? AND owner_id = ?'
  ).get(owner.ownerType, owner.id);

  if (!cred || cred.auth_provider !== 'local' || !cred.password_hash) {
    // No credentials row at all (never set a password), or an SSO-only
    // account trying to use password login.
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const ok = bcrypt.compareSync(password, cred.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  db.prepare(
    `UPDATE auth_credentials SET last_login_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`
  ).run(cred.id);

  const token = signToken({ ownerType: owner.ownerType, ownerId: owner.id });

  res.json({
    token,
    actor: {
      id: owner.id,
      email: owner.email,
      full_name: owner.full_name,
      role: owner.ownerType
    }
  });
});

module.exports = router;
