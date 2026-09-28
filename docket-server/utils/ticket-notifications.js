// Ticket emails:
//   - notifyTicketCreated:  confirmation right after POST /api/tickets
//   - notifyTicketResolved: the agent marked it Resolved — the customer is
//     asked to confirm the fix or reopen from the portal
//   - notifyTicketAssigned: tells an agent a ticket was assigned to them
//
// All are fire-and-forget: the ticket change is already committed by the
// time they run, so a Resend outage is logged, never turned into a failed
// request (the customer would retry and create a duplicate ticket).

const db = require('../db/connection');
const { sendEmail, escapeHtml, appLink, greetingFor } = require('./email');

async function loadTicketWithRequester(ticketId) {
  const result = await db.query(
    `SELECT t.*, u.email AS requester_email, u.full_name AS requester_name
     FROM tickets t LEFT JOIN users u ON u.id = t.user_id
     WHERE t.id = $1`,
    [ticketId]
  );
  return result.rows[0] || null;
}

function portalLinkHtml(label) {
  const url = appLink('portal.html');
  return url ? `<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>` : '';
}

function portalLinkText(label) {
  const url = appLink('portal.html');
  return url ? `\n\n${label}: ${url}` : '';
}

function detailRowsHtml(rows) {
  return (
    '<table style="border-collapse:collapse;margin:16px 0">' +
    rows
      .map(([label, value]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#6B6A61">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0">${escapeHtml(value)}</td></tr>`)
      .join('') +
    '</table>'
  );
}

async function sendTicketCreated(ticketId) {
  const t = await loadTicketWithRequester(ticketId);
  if (!t || !t.requester_email) return;

  const rows = [
    ['Ticket', t.id],
    ['Subject', t.subject],
    ['Priority', t.priority],
    ['Team', t.assigned_team || '—'],
    ['Target', t.sla_summary || '—']
  ];

  await sendEmail({
    to: t.requester_email,
    subject: `[${t.id}] We've received your request: ${t.subject}`,
    text:
      `${greetingFor(t.requester_name)}\n\n` +
      `Thanks — we've logged your request and it's in the queue for the ${t.assigned_team || 'support'} team.\n\n` +
      rows.map(([label, value]) => `${label}: ${value}`).join('\n') +
      `\n\nWe'll email you again once it's resolved.` +
      portalLinkText('Track it in your portal'),
    html:
      `<p>${escapeHtml(greetingFor(t.requester_name))}</p>` +
      `<p>Thanks — we've logged your request and it's in the queue for the ${escapeHtml(t.assigned_team || 'support')} team.</p>` +
      detailRowsHtml(rows) +
      `<p>We'll email you again once it's resolved.</p>` +
      portalLinkHtml('Track it in your portal')
  });
}

async function sendTicketResolved(ticketId) {
  const t = await loadTicketWithRequester(ticketId);
  if (!t || !t.requester_email) return;

  const summary = t.resolution_summary || '';

  await sendEmail({
    to: t.requester_email,
    subject: `[${t.id}] Resolved: ${t.subject}`,
    text:
      `${greetingFor(t.requester_name)}\n\n` +
      `Your ticket ${t.id} ("${t.subject}") has been marked resolved.\n\n` +
      `Resolution:\n${summary}\n\n` +
      `If that fixed it, please confirm in your portal so we can close the ticket. ` +
      `If not, you can reopen it from the same page.` +
      portalLinkText('Open your portal'),
    html:
      `<p>${escapeHtml(greetingFor(t.requester_name))}</p>` +
      `<p>Your ticket <strong>${escapeHtml(t.id)}</strong> (“${escapeHtml(t.subject)}”) has been marked resolved.</p>` +
      `<p style="color:#6B6A61;margin-bottom:4px">Resolution</p>` +
      `<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #D9D6CC;white-space:pre-wrap">${escapeHtml(summary)}</blockquote>` +
      `<p>If that fixed it, please confirm in your portal so we can close the ticket. If not, you can reopen it from the same page.</p>` +
      portalLinkHtml('Open your portal')
  });
}

// Agent-facing: sent to whoever a ticket was just assigned to (PATCH
// /api/tickets/:id/assign). Reads the agent off the ticket row itself, so
// it always goes to the current assignee even if two assignments race.
async function sendTicketAssigned(ticketId) {
  const t = await loadTicketWithRequester(ticketId);
  if (!t || !t.assigned_agent_id) return;

  const agentResult = await db.query('SELECT full_name, email FROM agents WHERE id = $1', [t.assigned_agent_id]);
  const agent = agentResult.rows[0];
  if (!agent || !agent.email) return;

  const rows = [
    ['Ticket', t.id],
    ['Subject', t.subject],
    ['Priority', t.priority],
    ['Category', t.category],
    ['Requester', t.requester_email || '—'],
    ['Target', t.sla_summary || '—']
  ];
  const description = t.description || '';
  const url = appLink('agent-dashboard.html');

  await sendEmail({
    to: agent.email,
    subject: `[${t.id}] Assigned to you (${t.priority}): ${t.subject}`,
    text:
      `${greetingFor(agent.full_name)}\n\n` +
      `A ticket has been assigned to you.\n\n` +
      rows.map(([label, value]) => `${label}: ${value}`).join('\n') +
      `\n\nDescription:\n${description}` +
      (url ? `\n\nOpen your agent console: ${url}` : ''),
    html:
      `<p>${escapeHtml(greetingFor(agent.full_name))}</p>` +
      `<p>A ticket has been assigned to you.</p>` +
      detailRowsHtml(rows) +
      `<p style="color:#6B6A61;margin-bottom:4px">Description</p>` +
      `<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #D9D6CC;white-space:pre-wrap">${escapeHtml(description)}</blockquote>` +
      (url ? `<p><a href="${escapeHtml(url)}">Open your agent console</a></p>` : '')
  });
}

function fireAndForget(label, fn, ticketId) {
  fn(ticketId).catch((err) => {
    console.error(`[notifications] ${label} email for ${ticketId} failed:`, err);
  });
}

module.exports = {
  notifyTicketCreated: (ticketId) => fireAndForget('ticket-created', sendTicketCreated, ticketId),
  notifyTicketResolved: (ticketId) => fireAndForget('ticket-resolved', sendTicketResolved, ticketId),
  notifyTicketAssigned: (ticketId) => fireAndForget('ticket-assigned', sendTicketAssigned, ticketId)
};
