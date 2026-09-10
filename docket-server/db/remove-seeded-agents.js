// One-off cleanup for a database that was already seeded before
// seed.js stopped inserting the five demo agents (Maya Owusu, Kwame
// Boateng, Ama Serwaa, Yaw Mensah, Efia Asante). Editing seed.js only
// stops them coming back on a *fresh* database — this actually removes
// them from one that's already running.
//
// Matched by email rather than the deterministic AGT-2026-00000N ids,
// in case an admin has since created/removed other agents and shifted
// what those ids point to.
//
// Safe by default: an agent with tickets still assigned to them is
// SKIPPED, not deleted (tickets.assigned_agent_id references agents(id),
// and schema.sql turns on foreign key enforcement, so a hard delete would
// fail anyway — this just explains why up front instead of throwing).
// Pass --force to unassign those tickets first (bumping them back to
// Created, same as the "Unassigned" case in PATCH /:id/assign — unless
// they're already Resolved/Closed, which stays put) and then delete.
//
// Run once against your live DB:
//   node db/remove-seeded-agents.js            (report / remove only the unassigned ones)
//   node db/remove-seeded-agents.js --force     (also unassign + remove the rest)

const db = require('./connection');

const SEEDED_AGENT_EMAILS = [
  'maya.owusu@docket.com',
  'kwame.boateng@docket.com',
  'ama.serwaa@docket.com',
  'yaw.mensah@docket.com',
  'efia.asante@docket.com'
];

function removeSeededAgents({ force = false } = {}) {
  const findAgent = db.prepare('SELECT id, full_name FROM agents WHERE email = ?');
  const findAssigned = db.prepare('SELECT id, status FROM tickets WHERE assigned_agent_id = ?');
  const unassignTicket = db.prepare(
    `UPDATE tickets
     SET assigned_agent_id = NULL,
         status = CASE WHEN status IN ('Resolved', 'Closed') THEN status ELSE 'Created' END,
         updated_at = datetime('now')
     WHERE id = ?`
  );
  const deleteAgent = db.prepare('DELETE FROM agents WHERE id = ?');

  SEEDED_AGENT_EMAILS.forEach((email) => {
    const agent = findAgent.get(email);
    if (!agent) {
      console.log(`- ${email}: not found (already removed, or never seeded).`);
      return;
    }

    const assigned = findAssigned.all(agent.id);
    if (assigned.length && !force) {
      console.log(
        `- ${agent.full_name} (${agent.id}): SKIPPED — still assigned to ${assigned.length} ` +
        `ticket(s) (${assigned.map((t) => t.id).join(', ')}). Reassign them in the admin console, ` +
        `or re-run with --force to unassign and delete.`
      );
      return;
    }

    const run = db.transaction(() => {
      assigned.forEach((t) => unassignTicket.run(t.id));
      deleteAgent.run(agent.id);
    });
    run();

    console.log(
      `- ${agent.full_name} (${agent.id}): removed` +
      (assigned.length ? ` (unassigned from ${assigned.length} ticket(s) first).` : '.')
    );
  });
}

if (require.main === module) {
  removeSeededAgents({ force: process.argv.includes('--force') });
}

module.exports = { removeSeededAgents };
