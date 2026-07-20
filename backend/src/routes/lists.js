const router = require('express').Router();
const { pool } = require('../db');

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM lists ORDER BY id');
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { url, name } = req.body;
  if (!url || !name) return res.status(400).json({ error: 'url and name are required' });
  const { rows } = await pool.query(
    'INSERT INTO lists (url, name) VALUES ($1, $2) RETURNING *',
    [url, name]
  );
  res.status(201).json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM lists WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
