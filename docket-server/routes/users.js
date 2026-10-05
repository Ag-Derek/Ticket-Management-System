const express = require('express');
const db = require('../db/connection');
const { recordAuditLog } = require('../utils/audit');
const { requireAuth } = require('../middleware/authenticate');
const { createChallenge, MfaError, sendMfaError } = require('../utils/mfa');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/users
// Sign-in / sign-up for customers, who have no password: the emailed MFA
// code is the credential. Either way (new or returning email) this only
// starts a challenge and responds { mfaRequired, challengeId } — the token
// and the user record come from POST /api/auth/mfa/verify. A new user's
// row isn't created until then, so nobody can register someone else's
// email.
router.post('/', async (req, res) => {
  const { full_name, email, phone, department, organization } = req.body || {};

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'full_name is required' });
  }
  if (!email || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'a valid email is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // lower() on the column too, so a row stored with capitals before emails
    // were normalized still matches (same as routes/auth.js).
    const existingResult = await db.query('SELECT * FROM users WHERE lower(email) = $1', [normalizedEmail]);
    const existing = existingResult.rows[0];

    const challenge = existing
      ? await createChallenge({ ownerType: 'user', ownerId: existing.id, email: normalizedEmail, fullName: existing.full_name })
      : await createChallenge({
          ownerType: 'user',
          email: normalizedEmail,
          fullName: full_name.trim(),
          context: {
            pending: {
              full_name: full_name.trim(),
              phone: phone || null,
              department: department || null,
              organization: organization || null
            }
          }
        });

    recordAuditLog({
      actorType: 'user',
      actorId: existing ? existing.id : null,
      actorName: existing ? existing.full_name : full_name.trim(),
      action: 'auth.mfa_sent',
      details: { email: normalizedEmail, new_account: !existing }
    });

    res.json(challenge);
  } catch (err) {
    if (err instanceof MfaError) return sendMfaError(res, err);
    console.error('POST /api/users error:', err);
    res.status(500).json({ error: 'failed to save profile' });
  }
});

// POST /api/users/sign-in  { email }
// Returning customers (login.html): email only, no profile fields. An
// unknown email gets a 404 pointing at sign-up rather than a code — this
// does reveal whether an account exists, a deliberate UX trade-off (the
// per-IP rate limit in server.js keeps it from being used to bulk-check
// addresses).
router.post('/sign-in', async (req, res) => {
  const email = typeof (req.body || {}).email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'a valid email is required' });
  }

  try {
    const result = await db.query('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const existing = result.rows[0];
    if (!existing) {
      return res.status(404).json({
        error: "We couldn't find an account with that email. Check for typos, or try another address you may have used.",
        signup: true
      });
    }

    const challenge = await createChallenge({ ownerType: 'user', ownerId: existing.id, email, fullName: existing.full_name });

    recordAuditLog({
      actorType: 'user',
      actorId: existing.id,
      actorName: existing.full_name,
      action: 'auth.mfa_sent',
      details: { email, new_account: false }
    });

    res.json(challenge);
  } catch (err) {
    if (err instanceof MfaError) return sendMfaError(res, err);
    console.error('POST /api/users/sign-in error:', err);
    res.status(500).json({ error: 'failed to sign in' });
  }
});

// The GET routes below return customers' contact details, so they're
// admin-only. A customer's own record comes back from POST
// /api/auth/mfa/verify at sign-in; the client never reads these.

// GET /api/users/by-email/:email
router.get('/by-email/:email', requireAuth(['admin']), async (req, res) => {
  const email = req.params.email.trim().toLowerCase();
  try {
    const result = await db.query('SELECT * FROM users WHERE lower(email) = $1', [email]);
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/users/by-email error:', err);
    res.status(500).json({ error: 'failed to load user' });
  }
});

// GET /api/users/:id
router.get('/:id', requireAuth(['admin']), async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/users/:id error:', err);
    res.status(500).json({ error: 'failed to load user' });
  }
});

// GET /api/users
router.get('/', requireAuth(['admin']), async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/users error:', err);
    res.status(500).json({ error: 'failed to load users' });
  }
});

module.exports = router;
