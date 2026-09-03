// Generates the next sequential ID for a given prefix/table, e.g.
//   nextId(db, 'users', 'USR')  ->  'USR-2026-000001', then '...000002', ...
//
// Looks at what's actually in the table rather than keeping an in-memory
// counter, so it's correct even across restarts and safe under the
// synchronous, single-connection model better-sqlite3 uses here.

function nextId(db, table, prefix) {
  const year = new Date().getFullYear();
  const likePattern = `${prefix}-${year}-%`;

  const row = db
    .prepare(`SELECT id FROM ${table} WHERE id LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(likePattern);

  let n = 1;
  if (row) {
    const parts = row.id.split('-');
    const lastN = parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(lastN)) n = lastN + 1;
  }

  return `${prefix}-${year}-${String(n).padStart(6, '0')}`;
}

module.exports = { nextId };
