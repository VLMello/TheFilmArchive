const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Without this, a dropped connection on an idle client is an unhandled
// 'error' event and crashes the whole process.
pool.on('error', (err) => {
  console.error('Unexpected PG pool error:', err.message);
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Postgres may not be reachable yet right after a (re)start — retry
// instead of crashing the whole process on the first attempt.
async function migrate() {
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  for (let attempt = 1; ; attempt++) {
    try {
      for (const file of files) {
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        await pool.query(sql);
      }
      return;
    } catch (e) {
      console.error(`migrate attempt ${attempt} failed: ${e.message} — retrying in 5s`);
      await sleep(5000);
    }
  }
}

module.exports = { pool, migrate };
