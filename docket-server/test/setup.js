// Loaded before every test file (see the "test" script in package.json).
//
// db/connection.js and middleware/authenticate.js refuse to load without
// their settings, and authenticate.js loads .env as it does. dotenv never
// overwrites a variable that's already set, so setting every variable the
// app reads here means a developer's real .env can't leak into a test run:
// - the database is a dummy local URL; the pool only connects on the first
//   query, so tests that don't query need no database at all
// - RESEND_API_KEY is empty, so utils/email.js logs instead of sending
// - SUPABASE_URL points at a closed local port, so a storage call fails
//   instead of reaching the real bucket

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  DATABASE_SSL: 'false',
  AUTH_TOKEN_SECRET: 'test-secret',
  APP_URL: 'http://localhost:3000',
  CORS_ORIGINS: '',
  RESEND_API_KEY: '',
  EMAIL_FROM: 'Docket <test@example.com>',
  SUPABASE_URL: 'http://127.0.0.1:1',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  SUPABASE_STORAGE_BUCKET: 'test-attachments',
  MESSAGE_REMINDER_MINUTES: '0',
  DOTENV_CONFIG_QUIET: 'true'
});
