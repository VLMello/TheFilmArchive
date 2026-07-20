const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const sql = fs.readFileSync(
    path.join(__dirname, 'migrations/001_init.sql'),
    'utf8'
  );
  await pool.query(sql);
}

module.exports = { pool, migrate };
