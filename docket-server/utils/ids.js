// Generates the next sequential ID for a given prefix/table, e.g.
//   await nextId(db, 'users', 'USR')  ->  'USR-2026-000001', then '...000002', ...
//
// The number comes from a Postgres sequence, one per table per year
// (tickets_id_2026_seq, ...), so two requests at the same moment can never
// be handed the same ID — reading MAX(id) and adding one could, and the
// loser's INSERT then failed. A new year gets a new sequence, so numbering
// restarts at 000001 just as it always has.
//
// A sequence number is used up even if the INSERT that took it later fails,
// so an occasional gap (000042 then 000044) is expected and harmless.

const connection = require('../db/connection');

// Sequences this process already knows exist, so the setup below runs at
// most once per table per year per process.
const readySequences = new Set();

// Creates the year's sequence if it doesn't exist yet, starting it just
// past the highest ID already in the table — so existing rows (made before
// sequences, or restored from a backup) are never reused. The advisory lock
// makes concurrent first calls, even across server instances, wait for one
// another instead of racing on CREATE SEQUENCE.
async function ensureSequence(table, prefix, year, seqName) {
  if (readySequences.has(seqName)) return;

  await connection.withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [seqName]);

    const exists = await client.query('SELECT to_regclass($1) AS oid', [seqName]);
    if (exists.rows[0].oid) return;

    await client.query(`CREATE SEQUENCE ${seqName} MINVALUE 1`);

    const max = await client.query(
      `SELECT COALESCE(MAX(CAST(split_part(id, '-', 3) AS BIGINT)), 0) AS n
       FROM ${table} WHERE id ~ $1`,
      [`^${prefix}-${year}-[0-9]+$`]
    );
    const highest = Number(max.rows[0].n);
    // An empty year needs nothing: a fresh sequence's first nextval() is 1.
    if (highest > 0) {
      await client.query('SELECT setval($1, $2, true)', [seqName, highest]);
    }
  });

  readySequences.add(seqName);
}

// `db` is kept as the first argument so existing call sites don't change.
async function nextId(db, table, prefix) {
  if (!/^[a-z_]+$/.test(table) || !/^[A-Z]+$/.test(prefix)) {
    throw new Error(`nextId: invalid table/prefix ${table}/${prefix}`);
  }
  const year = new Date().getFullYear();
  const seqName = `${table}_id_${year}_seq`;

  await ensureSequence(table, prefix, year, seqName);
  const result = await db.query('SELECT nextval($1) AS n', [seqName]);

  return `${prefix}-${year}-${String(result.rows[0].n).padStart(6, '0')}`;
}

module.exports = { nextId };
