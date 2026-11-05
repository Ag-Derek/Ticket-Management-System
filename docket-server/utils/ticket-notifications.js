// Ticket emails:
//   - notifyTicketCreated:  confirmation right after POST /api/tickets
//   - notifyTicketResolved: the agent marked it Resolved — the customer is
//     asked to confirm the fix or reopen from the portal
//   - notifyTicketAssigned: tells an agent a ticket was assigned to them,
//     and tells the customer their ticket now has an agent on it
//
// All are fire-and-forget: the ticket change is already committed by the
// time they run, so a Resend outage is logged, never turned into a failed
// request (the customer would retry and create a duplicate ticket).

const db = require('../db/connection');
const { sendEmail, escapeHtml, appLink, greetingFor, buttonHtml, detailRowsHtml, quoteHtml, MUTED } = require('./email');

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
  return url ? buttonHtml(url, label) : '';
}

function portalLinkText(label) {
  const url = appLink('portal.html');
  return url ? `\n\n${label}: ${url}` : '';
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
      `\n\nWe'll email you when an agent is assigned to it, and again once it's resolved.` +
      portalLinkText('Track it in your portal'),
    html:
      `<p>${escapeHtml(greetingFor(t.requester_name))}</p>` +
      `<p>Thanks — we've logged your request and it's in the queue for the ${escapeHtml(t.assigned_team || 'support')} team.</p>` +
      detailRowsHtml(rows) +
      `<p>We'll email you when an agent is assigned to it, and again once it's resolved.</p>` +
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
      `<p style="color:${MUTED};margin-bottom:4px">Resolution</p>` +
      quoteHtml(summary) +
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
      `<p style="color:${MUTED};margin-bottom:4px">Description</p>` +
      quoteHtml(description) +
      (url ? buttonHtml(url, 'Open your agent console') : '')
  });
}

// Customer-facing counterpart of sendTicketAssigned: lets the requester know
// a named agent now owns their ticket. Agent names are already visible to
// customers in the portal (GET /api/agents), so naming them here is no leak.
async function sendTicketAssignedToRequester(ticketId) {
  const t = await loadTicketWithRequester(ticketId);
  if (!t || !t.requester_email || !t.assigned_agent_id) return;

  const agentResult = await db.query('SELECT full_name FROM agents WHERE id = $1', [t.assigned_agent_id]);
  const agentName = (agentResult.rows[0] && agentResult.rows[0].full_name) || 'One of our agents';

  const rows = [
    ['Ticket', t.id],
    ['Subject', t.subject],
    ['Assigned to', agentName],
    ['Status', t.status],
    ['Target', t.sla_summary || '—']
  ];

  await sendEmail({
    to: t.requester_email,
    subject: `[${t.id}] Assigned to an agent: ${t.subject}`,
    text:
      `${greetingFor(t.requester_name)}\n\n` +
      `Good news — your ticket ${t.id} ("${t.subject}") has been assigned to ${agentName}, who will be working on it.\n\n` +
      rows.map(([label, value]) => `${label}: ${value}`).join('\n') +
      `\n\nWe'll email you again once it's resolved.` +
      portalLinkText('Track it in your portal'),
    html:
      `<p>${escapeHtml(greetingFor(t.requester_name))}</p>` +
      `<p>Good news — your ticket <strong>${escapeHtml(t.id)}</strong> (“${escapeHtml(t.subject)}”) has been assigned to ${escapeHtml(agentName)}, who will be working on it.</p>` +
      detailRowsHtml(rows) +
      `<p>We'll email you again once it's resolved.</p>` +
      portalLinkHtml('Track it in your portal')
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
  // Two separate sends so a failure on one side doesn't stop the other.
  notifyTicketAssigned: (ticketId) => {
    fireAndForget('ticket-assigned', sendTicketAssigned, ticketId);
    fireAndForget('ticket-assigned-requester', sendTicketAssignedToRequester, ticketId);
  }
};
