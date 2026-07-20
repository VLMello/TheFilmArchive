const router = require('express').Router();
const { pool } = require('../db');

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT key, value FROM settings ORDER BY key');
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/', async (req, res) => {
  const entries = Object.entries(req.body);
  for (const [key, value] of entries) {
    await pool.query(
      'UPDATE settings SET value = $1 WHERE key = $2',
      [String(value), key]
    );
  }
  const { rows } = await pool.query('SELECT key, value FROM settings ORDER BY key');
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

module.exports = router;
