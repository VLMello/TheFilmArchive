const router = require('express').Router();
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');
const { getSettings } = require('../settings');
const { client: plexClient } = require('../plex');

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
  const movie = rows[0];

  res.json({ ...movie, plex_url: await resolvePlexUrl(movie) });
}));

// Deep-links to the movie in Plex Web. Both the ratingKey (per movie) and
// the server's machineIdentifier (global, constant) are cached in the DB
// after their first live Plex lookup, so this is a pure DB read on every
// request after the first time a given movie's detail page is opened.
async function resolvePlexUrl(movie) {
  if (movie.status !== 'downloaded' || !movie.tmdb_id) return null;

  const settings = await getSettings();
  if (!settings.plex_external_url) return null;
  const plex = plexClient(settings);
  if (!plex) return null;

  try {
    let ratingKey = movie.plex_rating_key;
    if (!ratingKey) {
      ratingKey = await plex.findRatingKeyByTmdbId(movie.tmdb_id);
      if (ratingKey) {
        await pool.query('UPDATE movies SET plex_rating_key = $1 WHERE id = $2', [ratingKey, movie.id]);
      }
    }
    if (!ratingKey) return null;

    let machineIdentifier = settings.plex_machine_identifier;
    if (!machineIdentifier) {
      machineIdentifier = await plex.getMachineIdentifier();
      if (machineIdentifier) {
        await pool.query('UPDATE settings SET value = $1 WHERE key = $2', [machineIdentifier, 'plex_machine_identifier']);
      }
    }
    if (!machineIdentifier) return null;

    return `${settings.plex_external_url}/web/index.html#!/server/${machineIdentifier}/details?key=%2Flibrary%2Fmetadata%2F${ratingKey}`;
  } catch (_) {
    return null;
  }
}

module.exports = router;
