// Generates the next sequential ID for a given prefix/table, e.g.
//   await nextId(db, 'users', 'USR')  ->  'USR-2026-000001', then '...000002', ...
//
// Looks at what's actually in the table rather than keeping an in-memory
// counter, so it's correct across restarts/redeploys.

async function nextId(db, table, prefix) {
  const year = new Date().getFullYear();
  const likePattern = `${prefix}-${year}-%`;

  const result = await db.query(
    `SELECT id FROM ${table} WHERE id LIKE $1 ORDER BY id DESC LIMIT 1`,
    [likePattern]
  );

  let n = 1;
  const row = result.rows[0];
  if (row) {
    const parts = row.id.split('-');
    const lastN = parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(lastN)) n = lastN + 1;
  }

  return `${prefix}-${year}-${String(n).padStart(6, '0')}`;
}

module.exports = { nextId };
