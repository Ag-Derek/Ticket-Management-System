const express = require('express');
const cors = require('cors');
const db = require('./db/connection');

const app = express();
app.use(cors());
app.use(express.json());

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
// Comments are nested under a ticket: /api/tickets/:ticketId/comments
app.use('/api/tickets/:ticketId/comments', require('./routes/comments'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Docket API listening on http://localhost:${PORT}`);
});
