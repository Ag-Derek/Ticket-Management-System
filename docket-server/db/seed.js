// Seeds the starting admin account.
//
// Agents are not seeded — they come from the admin "Add an agent" form or
// self-sign-in on the agent login page instead.
//
// Safe to re-run: the admin insert is ON CONFLICT DO NOTHING against the
// unique email, so running this twice does not create duplicates.

const bcrypt = require('bcryptjs');
const db = require('./connection');

async function seedAdmin() {
  // The old front end checked this password in plaintext client-side JS,
  // which only ever worked as a demo. Here it's hashed at rest and
  // verified with a real bcrypt.compare() in the login route.
  const passwordHash = bcrypt.hashSync('Admin2026!', 10);
  const adminId = 'ADM-2026-000001';

  await db.query(
    'INSERT INTO admins (id, email, full_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
    [adminId, 'admin@docket.com', 'System Administrator']
  );

  // Credentials live in auth_credentials, not on admins directly — see
  // db/schema.sql. ON CONFLICT against the (owner_type, owner_id) unique
  // constraint keeps this safe to re-run.
  await db.query(
    `INSERT INTO auth_credentials (owner_type, owner_id, auth_provider, password_hash)
     VALUES ('admin', $1, 'local', $2)
     ON CONFLICT (owner_type, owner_id) DO NOTHING`,
    [adminId, passwordHash]
  );

  console.log('Seeded admin account admin@docket.com (or confirmed it already exists).');
}

async function seed() {
  await db.ensureSchema();
  await seedAdmin();
  console.log('Seed complete.');
}

if (require.main === module) {
  seed().catch((err) => { console.error('Seed failed:', err); process.exit(1); });
}

module.exports = { seed };
