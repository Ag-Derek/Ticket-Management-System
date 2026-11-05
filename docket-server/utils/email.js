// Transactional email via Resend's REST API (https://resend.com/docs/api-reference/emails/send-email).
// Called with Node's built-in fetch rather than the `resend` SDK — it's one
// POST, not worth a dependency.
//
// RESEND_API_KEY   — required in production.
// EMAIL_FROM       — verified sender, e.g. "Docket <no-reply@yourdomain.com>".
//                    Falls back to Resend's shared test sender, which can only
//                    deliver to the email address that owns the Resend account.
//
// APP_URL          — where the client/ pages are served, e.g.
//                    "https://docket.example.com". Used to build links in
//                    emails (password reset, portal). Deliberately config,
//                    not the request's Origin/Host header, which a caller
//                    controls and could point a reset link at their own site.
//
// With no RESEND_API_KEY outside production, emails are printed to the
// console instead of sent, so local dev works without a Resend account —
// with a loud warning so it can't go unnoticed.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Docket <onboarding@resend.dev>';
const APP_URL = (process.env.APP_URL || '').trim().replace(/\/+$/, '') || null;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (!RESEND_API_KEY && IS_PRODUCTION) {
  throw new Error('RESEND_API_KEY is not set');
}

// Every html body is wrapped in the same branded card: black header bar,
// white body, sign-off and a small footer. Tables and inline styles only,
// since that's all most mail clients (Outlook especially) render reliably.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const ACCENT = '#1A73E8';
const MUTED = '#6B7280';

function layoutHtml(bodyHtml) {
  return (
    '<!doctype html><html><body style="margin:0;padding:0;background:#F4F5F7">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7">' +
    '<tr><td align="center" style="padding:24px 12px">' +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;font-family:${FONT};font-size:15px;line-height:1.6;color:#1B1A17">` +
    `<tr><td style="background:#000000;padding:20px 28px;font-size:18px;font-weight:700;color:#FFFFFF">Docket</td></tr>` +
    `<tr><td style="padding:24px 28px">${bodyHtml}<p style="margin:24px 0 0">Docket</p></td></tr>` +
    `<tr><td style="padding:16px 28px;border-top:1px solid #ECEDEF;font-size:12px;color:${MUTED}">This is an automated message from Docket.</td></tr>` +
    '</table></td></tr></table></body></html>'
  );
}

async function sendEmail({ to, subject, text, html }) {
  if (html) html = layoutHtml(html);
  if (!RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY not set — NOT sending. To: ${to} | Subject: ${subject}\n${text}`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text, html })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend send failed (${response.status}): ${body}`);
  }
}

// Anything user-supplied (ticket subjects, resolution notes, names) goes
// through this before landing in an email's html.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Absolute link to a client page, or null when APP_URL isn't configured.
function appLink(pathAndQuery) {
  return APP_URL ? `${APP_URL}/${pathAndQuery.replace(/^\/+/, '')}` : null;
}

function greetingFor(fullName) {
  return fullName ? `Hello ${String(fullName).trim().split(' ')[0]},` : 'Hello,';
}

// Call-to-action link styled as a solid button.
function buttonHtml(url, label) {
  return (
    `<p style="margin:24px 0"><a href="${escapeHtml(url)}" ` +
    `style="display:inline-block;padding:12px 22px;background:${ACCENT};color:#FFFFFF;font-weight:600;text-decoration:none;border-radius:8px">` +
    `${escapeHtml(label)}</a></p>`
  );
}

// Label/value pairs in a light grey rounded box.
function detailRowsHtml(rows) {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="border-collapse:separate;margin:16px 0;background:#F7F8FA;border:1px solid #E6E8EC;border-radius:8px">' +
    rows
      .map(([label, value]) =>
        `<tr><td style="padding:10px 16px;width:35%;font-size:13px;color:${MUTED}">${escapeHtml(label)}</td>` +
        `<td style="padding:10px 16px;font-weight:600">${escapeHtml(value)}</td></tr>`)
      .join('') +
    '</table>'
  );
}

// Quoted user text (resolution notes, ticket descriptions, chat messages).
function quoteHtml(text) {
  return `<blockquote style="margin:0 0 16px;padding:10px 14px;background:#F7F8FA;border-left:3px solid ${ACCENT};border-radius:4px;white-space:pre-wrap">${escapeHtml(text)}</blockquote>`;
}

module.exports = { sendEmail, escapeHtml, appLink, greetingFor, buttonHtml, detailRowsHtml, quoteHtml, MUTED };
