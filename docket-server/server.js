require('dotenv').config();

const express = require('express');
const cors = require('cors');
const db = require('./db/connection');
const { seed } = require('./db/seed');

const app = express();
app.use(cors());
// Attachments travel as base64 inline in the JSON body (see
// attachment-storage.js's 5MB-per-file cap) — base64 inflates that by
// ~33%, and a ticket/comment can carry more than one file, so the
// default 100kb express.json() limit rejects any real attachment with a
// 413 long before the app's own size check ever runs.
app.use(express.json({ limit: '10mb' }));

// A body-parser failure (oversized payload, malformed JSON) would
// otherwise fall through to Express's default HTML error page — the
// frontend's response.json() then throws a confusing
// "unexpected character at line 1 column 1" instead of showing the
// actual problem. Reply in the same { error } shape every route already
// uses so the client can surface a real message.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request too large — attachments are capped at 5MB each.' });
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed request body.' });
  }
  next(err);
});

// Root route — just so opening the bare Render URL in a browser doesn't
// look like the server is down. The frontend never calls this directly.
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Docket API is running' });
});

// Health check — confirms the server is up and the DB file is readable.
app.get('/api/health', (req, res) => {
  const counts = {
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    agents: db.prepare('SELECT COUNT(*) AS n FROM agents').get().n,
    admins: db.prepare('SELECT COUNT(*) AS n FROM admins').get().n,
    tickets: db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n
  };
  res.json({ status: 'ok', counts });
});

app.use('/api/users', require('./routes/users'));
app.use('/api/agents', require('./routes/agents'));
app.use('/api/admins', require('./routes/admins'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/auth', require('./routes/auth'));
// Comments are nested under a ticket: /api/tickets/:ticketId/comments
app.use('/api/tickets/:ticketId/comments', require('./routes/comments'));
app.use('/api/attachments', require('./middleware/attachments'));
app.use('/api/backup', require('./routes/backup'));

const PORT = process.env.PORT || 4000;

seed();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Docket API listening on http://localhost:${PORT}`);
});
