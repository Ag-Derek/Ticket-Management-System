// Seeds the same starting data app.js used to bootstrap into localStorage,
// so tickets/records created against the old front end still resolve to a
// real admin once it's pointed at this API.
//
// Agents are no longer seeded. The five demo agents this used to insert —
// Maya Owusu, Kwame Boateng, Ama Serwaa, Yaw Mensah, Efia Asante — have
// been dropped; agents now come from the admin "Add an agent" form or
// self-sign-in on the agent login page instead. If those five are still
// sitting in an already-seeded database, see remove-seeded-agents.js —
// removing them here only stops them from coming back on a *fresh* DB.
//
// Safe to re-run: the admin insert is "OR IGNORE" against the unique
// email, so running `npm run seed` twice does not create duplicates.

const bcrypt = require('bcryptjs');
const db = require('./connection');

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
  seedAdmin();

  console.log('Seed complete. Database file: ./docket.db');
}

if (require.main === module) {
  seed();
}

module.exports = { seed };
