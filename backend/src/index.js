const express = require('express');
const cron = require('node-cron');
const { migrate, pool } = require('./db');
const { runSync, refreshStatuses } = require('./sync');
const asyncHandler = require('./asyncHandler');

// Last line of defense: log instead of letting a stray rejection or throw
// (e.g. from a background timer, not just Express routes) kill the process.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

const app = express();
app.use(express.json());

app.get('/health', asyncHandler(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));
app.use('/api/lists', require('./routes/lists'));
app.use('/api/movies', require('./routes/movies'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/settings', require('./routes/settings'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

async function start() {
  await migrate();
  cron.schedule('*/15 * * * *', () => runSync().catch(console.error));
  cron.schedule('* * * * *', () => refreshStatuses().catch(console.error));
  app.listen(3000, () => console.log('TFA backend on :3000'));
}

if (require.main === module) {
  start().catch(err => { console.error(err); process.exit(1); });
}

module.exports = app;
