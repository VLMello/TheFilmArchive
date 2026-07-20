const router = require('express').Router();
const { pool } = require('../db');

router.get('/', async (req, res) => {
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
});

module.exports = router;
