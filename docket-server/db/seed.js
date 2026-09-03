// Seeds the same starting data app.js used to bootstrap into localStorage,
// so tickets/records created against the old front end still resolve to a
// real agent/admin once it's pointed at this API.
//
// Safe to re-run: every insert is "OR IGNORE" against the unique email, so
// running `npm run seed` twice does not create duplicates.

const bcrypt = require('bcryptjs');
const db = require('./connection');

const AGENT_SEED_NAMES = ['Maya Owusu', 'Kwame Boateng', 'Ama Serwaa', 'Yaw Mensah', 'Efia Asante'];

function slugAgentEmail(name) {
  return name.trim().toLowerCase().replace(/[^a-z\s]/g, '').trim().replace(/\s+/g, '.') + '@docket.com';
}

function genId(prefix, n) {
  return prefix + '-2026-' + String(n).padStart(6, '0');
}

function seedAgents() {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO agents (id, full_name, email, created_by, created_at) VALUES (?, ?, ?, 'seed', datetime('now'))"
  );
  const seedAll = db.transaction((names) => {
    names.forEach((name, i) => {
      insert.run(genId('AGT', i + 1), name, slugAgentEmail(name));
    });
  });
  seedAll(AGENT_SEED_NAMES);
  console.log(`Seeded ${AGENT_SEED_NAMES.length} agents (or confirmed they already exist).`);
}

function seedAdmin() {
  // The old front end checked this password in plaintext client-side JS,
  // which only ever worked as a demo. Here it's hashed at rest and will
  // need a real bcrypt.compare() check in the login route.
  const passwordHash = bcrypt.hashSync('Admin2026!', 10);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO admins (id, email, password_hash, full_name, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
  );
  insert.run('ADM-2026-000001', 'admin@docket.com', passwordHash, 'System Administrator');
  console.log('Seeded admin account admin@docket.com (or confirmed it already exists).');
}

function seed() {
  seedAgents();
  seedAdmin();

  console.log('Seed complete. Database file: ./docket.db');
}

if (require.main === module) {
  seed();
}

module.exports = { seed };
