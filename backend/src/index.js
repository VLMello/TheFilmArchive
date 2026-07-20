const express = require('express');
const { migrate } = require('./db');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

async function start() {
  await migrate();
  app.listen(3000, () => console.log('TFA backend on :3000'));
}

if (require.main === module) {
  start().catch(err => { console.error(err); process.exit(1); });
}

module.exports = app;
