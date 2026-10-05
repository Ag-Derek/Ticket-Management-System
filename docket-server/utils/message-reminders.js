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
// MESSAGE_REMINDER_MINUTES — wait before emailing, default 30. Set it to 0
//                            to switch reminders off.
//
// Runs inside the API process. A Postgres advisory lock means only one
// server instance sends at a time, so scaling out never double-emails.

const db = require('../db/connection');
const { sendEmail, escapeHtml, appLink, greetingFor } = require('./email');
const { unreadBaseline } = require('./unread');

const REMINDER_MINUTES = process.env.MESSAGE_REMINDER_MINUTES === undefined
  ? 30
  : Number(process.env.MESSAGE_REMINDER_MINUTES);
const CHECK_INTERVAL_MS = 60 * 1000;
const MAX_PER_RUN = 50;
const LOCK_KEY = 'docket-message-reminders';

// Every (ticket, recipient) with public messages that are unread, not yet
// reminded about, and old enough. `n` counts the unread messages so the
// email can say "3 new messages".
async function findDueReminders(client, baseline) {
  const result = await client.query(
    `WITH pending AS (
       SELECT c.id, c.ticket_id, c.created_at,
              CASE WHEN c.author_type = 'customer' THEN 'agent' ELSE 'customer' END AS reader_type,
              CASE WHEN c.author_type = 'customer' THEN t.assigned_agent_id ELSE t.user_id END AS reader_id
       FROM ticket_comments c
       JOIN tickets t ON t.id = c.ticket_id
       WHERE c.visibility = 'public' AND c.id > $1
     )
     SELECT p.ticket_id, p.reader_type, p.reader_id,
            MAX(p.id) AS latest_id, COUNT(*)::int AS n, MIN(p.created_at) AS oldest
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

async function sendReminder(client, due) {
  const table = due.reader_type === 'customer' ? 'users' : 'agents';
  const [recipientResult, ticketResult, latestResult] = await Promise.all([
    client.query(`SELECT full_name, email FROM ${table} WHERE id = $1`, [due.reader_id]),
    client.query('SELECT id, subject FROM tickets WHERE id = $1', [due.ticket_id]),
    client.query(
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
      `<p style="color:#6B6A61;margin-bottom:4px">${escapeHtml(latest.author_name)} wrote:</p>` +
      `<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #D9D6CC;white-space:pre-wrap">${escapeHtml(preview)}</blockquote>` +
      (link ? `<p><a href="${escapeHtml(link)}">Open the conversation</a></p>` : '')
  });
  return true;
}

// One pass. Exported so it can be run by hand or from a test.
async function runReminderPass() {
  if (!(REMINDER_MINUTES > 0)) return { skipped: 'disabled', sent: 0 };
  const baseline = await unreadBaseline();

  return db.withTransaction(async (client) => {
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok', [LOCK_KEY]);
    if (!lock.rows[0].ok) return { skipped: 'locked', sent: 0 };

    let sent = 0;
    for (const due of await findDueReminders(client, baseline)) {
      try {
        await sendReminder(client, due);
      } catch (err) {
        // Not recorded, so it's retried on the next pass.
        console.error(`[reminders] email for ${due.ticket_id} -> ${due.reader_type} ${due.reader_id} failed:`, err);
        continue;
      }
      // Recorded even when sendReminder found no address to send to, so a
      // recipient with no email isn't re-checked every minute forever.
      await client.query(
        `INSERT INTO ticket_reads (ticket_id, reader_type, reader_id, last_reminded_comment_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (ticket_id, reader_type, reader_id) DO UPDATE
           SET last_reminded_comment_id = GREATEST(ticket_reads.last_reminded_comment_id, EXCLUDED.last_reminded_comment_id)`,
        [due.ticket_id, due.reader_type, due.reader_id, due.latest_id]
      );
      sent++;
    }
    return { sent };
  });
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
