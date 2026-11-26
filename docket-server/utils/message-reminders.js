// "You have an unread message" emails. Once a minute, finds public chat
// messages that have sat unread for longer than MESSAGE_REMINDER_MINUTES
// and emails the person they were meant for:
//   - a reply from support (agent or admin) -> the ticket's customer
//   - a message from the customer           -> the ticket's assigned agent
//
// One email per unread batch: after a reminder goes out, nothing more is
// sent for that conversation until a newer message arrives that also goes
// unread for the full wait. Opening the chat (or replying) marks the
// messages read, which cancels the reminder (see utils/unread.js).
//
// Internal notes never trigger an email, and neither does anything posted
// before unread tracking existed.
//
// MESSAGE_REMINDER_MINUTES — wait before emailing, default 10. Set it to 0
//                            to switch reminders off.
//
// Runs inside the API process, with no transaction open while emails send,
// so chat reads and replies never wait on a pass. Each reminder is claimed
// with one atomic update before its email goes out, so two passes running
// at once (or several server instances) still send one email per batch.
// A failed send releases the claim and is retried on the next pass.

const db = require('../db/connection');
const { sendEmail, escapeHtml, appLink, greetingFor, buttonHtml, quoteHtml, MUTED } = require('./email');
const { unreadBaseline } = require('./unread');

const REMINDER_MINUTES = process.env.MESSAGE_REMINDER_MINUTES === undefined
  ? 10
  : Number(process.env.MESSAGE_REMINDER_MINUTES);
const CHECK_INTERVAL_MS = 60 * 1000;
const MAX_PER_RUN = 50;

// Every (ticket, recipient) with public messages that are unread, not yet
// reminded about, and old enough. `n` counts the unread messages so the
// email can say "3 new messages"; `reminded_id` is the current
// last_reminded_comment_id, so a failed send can put it back.
async function findDueReminders(baseline) {
  const result = await db.query(
    `WITH pending AS (
       SELECT c.id, c.ticket_id, c.created_at,
              CASE WHEN c.author_type = 'customer' THEN 'agent' ELSE 'customer' END AS reader_type,
              CASE WHEN c.author_type = 'customer' THEN t.assigned_agent_id ELSE t.user_id END AS reader_id
       FROM ticket_comments c
       JOIN tickets t ON t.id = c.ticket_id
       WHERE c.visibility = 'public' AND c.id > $1
     )
     SELECT p.ticket_id, p.reader_type, p.reader_id,
            MAX(p.id) AS latest_id, COUNT(*)::int AS n, MIN(p.created_at) AS oldest,
            COALESCE(MAX(r.last_reminded_comment_id), 0) AS reminded_id
     FROM pending p
     LEFT JOIN ticket_reads r
       ON r.ticket_id = p.ticket_id AND r.reader_type = p.reader_type AND r.reader_id = p.reader_id
     WHERE p.reader_id IS NOT NULL
       AND p.id > COALESCE(r.last_read_comment_id, 0)
       AND p.id > COALESCE(r.last_reminded_comment_id, 0)
     GROUP BY p.ticket_id, p.reader_type, p.reader_id
     HAVING MIN(p.created_at) < now() - make_interval(mins => $2)
     ORDER BY MIN(p.created_at)
     LIMIT $3`,
    [baseline, REMINDER_MINUTES, MAX_PER_RUN]
  );
  return result.rows;
}

async function sendReminder(due) {
  const table = due.reader_type === 'customer' ? 'users' : 'agents';
  const [recipientResult, ticketResult, latestResult] = await Promise.all([
    db.query(`SELECT full_name, email FROM ${table} WHERE id = $1`, [due.reader_id]),
    db.query('SELECT id, subject FROM tickets WHERE id = $1', [due.ticket_id]),
    db.query(
      `SELECT c.author_name, c.body,
              (SELECT COUNT(*) FROM ticket_attachments ta WHERE ta.comment_id = c.id)::int AS file_count
       FROM ticket_comments c WHERE c.id = $1`,
      [due.latest_id]
    )
  ]);
  const recipient = recipientResult.rows[0];
  const ticket = ticketResult.rows[0];
  const latest = latestResult.rows[0];
  if (!recipient || !recipient.email || !ticket || !latest) return false;

  const forCustomer = due.reader_type === 'customer';
  const count = due.n === 1 ? 'a new message' : `${due.n} new messages`;
  let preview = latest.body || (latest.file_count ? `📎 ${latest.file_count} attachment${latest.file_count === 1 ? '' : 's'}` : '');
  if (preview.length > 300) preview = preview.slice(0, 300) + '…';
  const link = appLink(`ticket-chat.html?ticket=${encodeURIComponent(ticket.id)}&role=${forCustomer ? 'customer' : 'agent'}`);

  const subject = forCustomer
    ? `[${ticket.id}] You have ${count} from support: ${ticket.subject}`
    : `[${ticket.id}] Customer is waiting on a reply: ${ticket.subject}`;
  const lead = forCustomer
    ? `You have ${count} from our support team on ticket ${ticket.id} ("${ticket.subject}") that you haven't read yet.`
    : `The customer sent ${count} on ticket ${ticket.id} ("${ticket.subject}") that hasn't been read yet.`;

  await sendEmail({
    to: recipient.email,
    subject,
    text:
      `${greetingFor(recipient.full_name)}\n\n${lead}\n\n` +
      `${latest.author_name}: ${preview}` +
      (link ? `\n\nOpen the conversation: ${link}` : ''),
    html:
      `<p>${escapeHtml(greetingFor(recipient.full_name))}</p>` +
      `<p>${escapeHtml(lead)}</p>` +
      `<p style="color:${MUTED};margin-bottom:4px">${escapeHtml(latest.author_name)} wrote:</p>` +
      quoteHtml(preview) +
      (link ? buttonHtml(link, 'Open the conversation') : '')
  });
  return true;
}

// Marks the batch as reminded, unless another pass already has (or the
// recipient read it in the meantime). Returns true when this pass owns it.
async function claimReminder(due) {
  const result = await db.query(
    `INSERT INTO ticket_reads (ticket_id, reader_type, reader_id, last_reminded_comment_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (ticket_id, reader_type, reader_id) DO UPDATE
       SET last_reminded_comment_id = EXCLUDED.last_reminded_comment_id
       WHERE ticket_reads.last_reminded_comment_id < EXCLUDED.last_reminded_comment_id
         AND ticket_reads.last_read_comment_id < EXCLUDED.last_reminded_comment_id
     RETURNING 1`,
    [due.ticket_id, due.reader_type, due.reader_id, due.latest_id]
  );
  return result.rowCount > 0;
}

// Undoes claimReminder after a failed send, so the next pass retries it.
// Only if the value is still ours: a newer batch may have been claimed since.
async function releaseReminder(due) {
  await db.query(
    `UPDATE ticket_reads SET last_reminded_comment_id = $5
     WHERE ticket_id = $1 AND reader_type = $2 AND reader_id = $3
       AND last_reminded_comment_id = $4`,
    [due.ticket_id, due.reader_type, due.reader_id, due.latest_id, due.reminded_id]
  );
}

// One pass. Exported so it can be run by hand or from a test.
async function runReminderPass() {
  if (!(REMINDER_MINUTES > 0)) return { skipped: 'disabled', sent: 0 };
  const baseline = await unreadBaseline();

  let sent = 0;
  for (const due of await findDueReminders(baseline)) {
    // Claimed before sending. The claim stays even when sendReminder finds
    // no address to send to, so a recipient with no email isn't re-checked
    // every minute forever.
    if (!(await claimReminder(due))) continue;
    try {
      await sendReminder(due);
    } catch (err) {
      console.error(`[reminders] email for ${due.ticket_id} -> ${due.reader_type} ${due.reader_id} failed:`, err);
      await releaseReminder(due).catch((releaseErr) =>
        console.error(`[reminders] couldn't release ${due.ticket_id} -> ${due.reader_type} ${due.reader_id} for retry:`, releaseErr));
      continue;
    }
    sent++;
  }
  return { sent };
}

function startMessageReminders() {
  if (!(REMINDER_MINUTES > 0)) {
    console.log('Message reminder emails are off (MESSAGE_REMINDER_MINUTES=0).');
    return;
  }
  console.log(`Message reminder emails on: unread messages are emailed after ${REMINDER_MINUTES} min.`);
  const tick = () => runReminderPass().catch((err) => console.error('[reminders] pass failed:', err));
  setInterval(tick, CHECK_INTERVAL_MS).unref();
}

module.exports = { startMessageReminders, runReminderPass, REMINDER_MINUTES };
