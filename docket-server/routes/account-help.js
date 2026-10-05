// "Can't remember which email I used" — account help requests.
//
// POST is public (login.html's "Find my account" form) and deliberately
// answers the same way whatever was submitted: it never says whether an
// account matched, or the form becomes a way to probe who has an account.
// Admins work the requests from the admin console's Account Help tab, where
// each one comes with possible matching customers to check by hand.

const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/authenticate');
const { asyncHandler } = require('../utils/async-handler');
const { recordAuditLog, resolveActorName } = require('../utils/audit');
const { sendEmail, escapeHtml, appLink, greetingFor } = require('../utils/email');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUSES = ['open', 'resolved'];

const ACCEPTED_MESSAGE =
  "Thanks — we've received your request. Our team will contact you at the email you gave us, usually within one business day.";

// Trims a body field and caps its length; '' becomes null.
function cleanField(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

// POST /api/account-help  { full_name, contact_email, phone?, organization?, details?, website? }
// `website` is a honeypot: hidden on the real form, so only bots fill it.
router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const fullName = cleanField(body.full_name, 120);
  const contactEmail = (cleanField(body.contact_email, 254) || '').toLowerCase();

  if (!fullName) return res.status(400).json({ error: 'Enter your full name.' });
  if (!EMAIL_RE.test(contactEmail)) return res.status(400).json({ error: 'Enter an email address we can reach you at.' });

  if (body.website) return res.status(202).json({ message: ACCEPTED_MESSAGE });

  // One open request per contact email per day is plenty — a resubmit just
  // gets the same answer instead of piling duplicates into the admin queue.
  const recent = await db.query(
    `SELECT 1 FROM account_help_requests
     WHERE contact_email = $1 AND status = 'open' AND created_at > now() - interval '24 hours'
     LIMIT 1`,
    [contactEmail]
  );
  if (recent.rows.length) return res.status(202).json({ message: ACCEPTED_MESSAGE });

  const inserted = await db.query(
    `INSERT INTO account_help_requests (full_name, contact_email, phone, organization, details)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [fullName, contactEmail, cleanField(body.phone, 40), cleanField(body.organization, 120), cleanField(body.details, 1000)]
  );

  recordAuditLog({
    actorType: 'unknown',
    actorName: fullName,
    action: 'account_help.requested',
    entityType: 'account_help',
    entityId: String(inserted.rows[0].id),
    details: { contact_email: contactEmail }
  });

  res.status(202).json({ message: ACCEPTED_MESSAGE });
}));

// GET /api/account-help?status=open|resolved|all
// Each request carries up to 5 possible_matches: customers sharing its
// email, name, or phone number (digits only, so "+233 24-123" matches
// "23324123"). Suggestions only — the admin decides.
router.get('/', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const status = req.query.status || 'open';
  if (status !== 'all' && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}, all` });
  }

  const params = [];
  let where = '';
  if (status !== 'all') { params.push(status); where = 'WHERE r.status = $1'; }

  const [result, openCount] = await Promise.all([
    db.query(
      `SELECT r.*, COALESCE(m.matches, '[]'::json) AS possible_matches
       FROM account_help_requests r
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
                  'id', u.id,
                  'full_name', u.full_name,
                  'email', u.email,
                  'phone', u.phone,
                  'organization', u.organization,
                  'ticket_count', (SELECT COUNT(*) FROM tickets t WHERE t.user_id = u.id)
                ) ORDER BY u.created_at) AS matches
         FROM (
           SELECT * FROM users u
           WHERE lower(u.email) = r.contact_email
              OR lower(trim(u.full_name)) = lower(r.full_name)
              OR (length(regexp_replace(COALESCE(r.phone, ''), '\\D', '', 'g')) >= 7
                  AND regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') = regexp_replace(r.phone, '\\D', '', 'g'))
           LIMIT 5
         ) u
       ) m ON true
       ${where}
       ORDER BY r.created_at DESC
       LIMIT 200`,
      params
    ),
    db.query(`SELECT COUNT(*) AS n FROM account_help_requests WHERE status = 'open'`)
  ]);

  res.json({ rows: result.rows, open_count: Number(openCount.rows[0].n) });
}));

// PATCH /api/account-help/:id  { status: 'open'|'resolved', note? }
router.patch('/:id', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'not found' });

  const { status } = req.body || {};
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
  }
  const note = cleanField((req.body || {}).note, 1000);
  const adminName = await resolveActorName(req.actor);

  const result = status === 'resolved'
    ? await db.query(
        `UPDATE account_help_requests
         SET status = 'resolved', resolution_note = $2, resolved_by_id = $3, resolved_by_name = $4, resolved_at = now()
         WHERE id = $1 RETURNING *`,
        [id, note, req.actor.id, adminName]
      )
    : await db.query(
        `UPDATE account_help_requests
         SET status = 'open', resolution_note = NULL, resolved_by_id = NULL, resolved_by_name = NULL, resolved_at = NULL
         WHERE id = $1 RETURNING *`,
        [id]
      );
  if (!result.rows[0]) return res.status(404).json({ error: 'not found' });

  recordAuditLog({
    actorType: 'admin',
    actorId: req.actor.id,
    actorName: adminName,
    action: status === 'resolved' ? 'account_help.resolved' : 'account_help.reopened',
    entityType: 'account_help',
    entityId: String(id),
    details: note ? { note } : null
  });

  res.json(result.rows[0]);
}));

// "jane.doe@example.com" -> "j•••@example.com". What the requester's
// contact address is told: enough to recognise the inbox, not enough to
// hand an impostor the full account email.
function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  return `${local.slice(0, 1)}•••@${domain || ''}`;
}

const BUTTON_STYLE = 'display:inline-block;padding:10px 18px;background:#E8A33D;color:#1B1A17;font-weight:600;text-decoration:none;border-radius:6px';

// The full reminder goes to the account's own inbox, which is safe whoever
// asked: if it wasn't the owner, the owner just gets a harmless notice.
async function sendAccountReminder(user) {
  const greeting = greetingFor(user.full_name);
  const link = appLink('login.html');
  await sendEmail({
    to: user.email,
    subject: 'The email on your Docket account',
    text:
      `${greeting}\n\nYou asked us to help you find your Docket account. This is the email address it's under — ` +
      `use it to sign in and we'll send you a sign-in code here.\n\n` +
      (link ? `Sign in: ${link}\n\n` : '') +
      `If you didn't ask for this, you can ignore this email. Nothing about your account has changed.`,
    html:
      `<p>${escapeHtml(greeting)}</p>` +
      `<p>You asked us to help you find your Docket account. <strong>This email address (${escapeHtml(user.email)}) is the one it's under</strong> — use it to sign in and we'll send you a sign-in code here.</p>` +
      (link ? `<p><a href="${escapeHtml(link)}" style="${BUTTON_STYLE}">Sign in</a></p>` : '') +
      `<p style="color:#6B6A61">If you didn't ask for this, you can ignore this email. Nothing about your account has changed.</p>`
  });
}

// The address the requester typed into the form is unverified, so it only
// gets a masked pointer to the inbox the reminder went to.
async function sendContactPointer(request, user) {
  const greeting = greetingFor(request.full_name);
  const masked = maskEmail(user.email);
  await sendEmail({
    to: request.contact_email,
    subject: 'We found your Docket account',
    text:
      `${greeting}\n\nThanks for your request — we found your Docket account. We've sent the sign-in details ` +
      `to the email address on the account, ${masked}. Check that inbox (and its spam folder).\n\n` +
      `If you no longer have access to that inbox, reply to let us know and we'll help you further.`,
    html:
      `<p>${escapeHtml(greeting)}</p>` +
      `<p>Thanks for your request — we found your Docket account. We've sent the sign-in details to the email address on the account, <strong>${escapeHtml(masked)}</strong>. Check that inbox (and its spam folder).</p>` +
      `<p style="color:#6B6A61">If you no longer have access to that inbox, reply to let us know and we'll help you further.</p>`
  });
}

// POST /api/account-help/:id/notify  { user_id }
// The admin has picked which customer the request belongs to: email that
// account its sign-in reminder, point the contact address at it, and mark
// the request resolved. Nothing is marked resolved if the reminder fails.
router.post('/:id/notify', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'not found' });

  const userId = (req.body || {}).user_id;
  if (typeof userId !== 'string' || !userId) return res.status(400).json({ error: 'user_id is required' });

  const [requestResult, userResult] = await Promise.all([
    db.query('SELECT * FROM account_help_requests WHERE id = $1', [id]),
    db.query('SELECT id, full_name, email FROM users WHERE id = $1', [userId])
  ]);
  const request = requestResult.rows[0];
  const user = userResult.rows[0];
  if (!request) return res.status(404).json({ error: 'not found' });
  if (!user) return res.status(404).json({ error: 'That customer no longer exists.' });

  try {
    await sendAccountReminder(user);
  } catch (err) {
    console.error('Account help: failed to send account reminder:', err);
    return res.status(502).json({ error: "Couldn't send the email. Nothing was changed. Try again in a moment." });
  }

  // Best-effort: the reminder (the part that matters) already went out.
  let pointerSent = false;
  if (request.contact_email !== user.email.toLowerCase()) {
    try {
      await sendContactPointer(request, user);
      pointerSent = true;
    } catch (err) {
      console.error('Account help: failed to send contact pointer:', err);
    }
  }

  const adminName = await resolveActorName(req.actor);
  const note = `Sent sign-in reminder to ${user.id} (${maskEmail(user.email)})` +
    (pointerSent ? ` and a pointer to ${request.contact_email}.` : '.');

  const updated = await db.query(
    `UPDATE account_help_requests
     SET status = 'resolved', resolution_note = $2, resolved_by_id = $3, resolved_by_name = $4, resolved_at = now()
     WHERE id = $1 RETURNING *`,
    [id, note, req.actor.id, adminName]
  );

  recordAuditLog({
    actorType: 'admin',
    actorId: req.actor.id,
    actorName: adminName,
    action: 'account_help.reminder_sent',
    entityType: 'account_help',
    entityId: String(id),
    details: { user_id: user.id, contact_email: request.contact_email, pointer_sent: pointerSent }
  });

  res.json(updated.rows[0]);
}));

module.exports = router;
