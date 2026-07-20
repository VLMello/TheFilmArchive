const express = require('express');
const cron = require('node-cron');
const { migrate } = require('./db');
const { runSync } = require('./sync');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/lists', require('./routes/lists'));
app.use('/api/movies', require('./routes/movies'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/settings', require('./routes/settings'));

async function start() {
  await migrate();
  cron.schedule('0 * * * *', () => runSync().catch(console.error));
  app.listen(3000, () => console.log('TFA backend on :3000'));
}

if (require.main === module) {
  start().catch(err => { console.error(err); process.exit(1); });
}

module.exports = app;
