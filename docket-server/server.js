require('dotenv').config();

const app = require('./app');
const { seed } = require('./db/seed');

const PORT = process.env.PORT || 4000;
const SETUP_RETRY_MS = 30 * 1000;

// Runs after the server is listening, so a database problem at boot leaves
// the API answering 503 and recovering by itself once the database is back,
// rather than exiting with nothing listening at all.
async function setUp() {
  try {
    await seed();
  } catch (err) {
    console.error(`Database setup failed, retrying in ${SETUP_RETRY_MS / 1000}s:`, err);
    setTimeout(setUp, SETUP_RETRY_MS);
    return;
  }
  app.locals.ready = true;
  require('./utils/message-reminders').startMessageReminders();
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Docket API listening on http://localhost:${PORT}`);
  setUp();
});
