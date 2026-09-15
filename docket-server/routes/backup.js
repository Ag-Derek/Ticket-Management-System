const express = require('express');
const { requireAuth } = require('../middleware/authenticate');
const { backupDatabase, listBackups, fetchBackup } = require('../utils/db-backup');

const router = express.Router();

// Only a single segment (no "/", no "..") — listBackups() is the only
// thing that ever produces a real name, but this still guards against a
// crafted :name reaching into another prefix in the same bucket.
const SAFE_NAME_RE = /^[A-Za-z0-9._-]+$/;

// POST /api/backup — admin-only, snapshots the live database and uploads
// it to Supabase Storage. Meant to be triggered by hand before a risky
// change (a schema migration, a big redeploy), not on a schedule.
router.post('/', requireAuth(['admin']), async (req, res) => {
  try {
    const result = await backupDatabase();
    res.status(201).json(result);
  } catch (err) {
    console.error('DB backup error:', err);
    res.status(500).json({ error: 'failed to create backup' });
  }
});

// GET /api/backup — admin-only, lists existing backups newest-first.
router.get('/', requireAuth(['admin']), async (req, res) => {
  try {
    const backups = await listBackups();
    res.json(backups);
  } catch (err) {
    console.error('DB backup list error:', err);
    res.status(500).json({ error: 'failed to list backups' });
  }
});

// GET /api/backup/:name — admin-only, downloads one backup file.
router.get('/:name', requireAuth(['admin']), async (req, res) => {
  if (!SAFE_NAME_RE.test(req.params.name)) {
    return res.status(400).json({ error: 'invalid backup name' });
  }
  try {
    const buffer = await fetchBackup(req.params.name);
    if (!buffer) return res.status(404).json({ error: 'backup not found' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}"`);
    res.send(buffer);
  } catch (err) {
    console.error('DB backup download error:', err);
    res.status(500).json({ error: 'failed to download backup' });
  }
});

module.exports = router;
