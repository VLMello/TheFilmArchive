const router = require('express').Router();
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

router.get('/', asyncHandler(async (req, res) => {
  const { status, list_id } = req.query;
  const params = [];
  let query = `
    SELECT m.*, l.name AS list_name
    FROM movies m
    JOIN lists l ON m.list_id = l.id
    WHERE 1=1
  `;
  if (status) { params.push(status); query += ` AND m.status = $${params.length}`; }
  if (list_id) { params.push(list_id); query += ` AND m.list_id = $${params.length}`; }
  query += ' ORDER BY m.created_at DESC';
  const { rows } = await pool.query(query, params);
  res.json(rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.*, l.name AS list_name, l.url AS list_url
     FROM movies m
     JOIN lists l ON m.list_id = l.id
     WHERE m.id = $1`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Movie not found' });
  res.json(rows[0]);
}));

module.exports = router;
