const { pool } = require('./db');
const { fetchList } = require('./letterboxd');
const { client: radarrClient } = require('./radarr');

let running = false;
let lastSyncedAt = null;

async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function syncList(list, radarr, settings) {
  const movies = await fetchList(list.url);

  for (const movie of movies) {
    const { rows } = await pool.query(
      'SELECT id, radarr_error FROM movies WHERE letterboxd_slug = $1 AND list_id = $2',
      [movie.slug, list.id]
    );
    // Rows that previously failed (radarr_error set) get retried instead of skipped.
    if (rows.length > 0 && !rows[0].radarr_error) continue;

    let radarrMovie = null;
    try {
      radarrMovie = await radarr.lookup(movie.title, movie.year);
    } catch (e) {
      await pool.query(
        `INSERT INTO movies (letterboxd_slug, title, year, radarr_error, status, list_id)
         VALUES ($1, $2, $3, $4, 'pending', $5)
         ON CONFLICT (letterboxd_slug, list_id) DO UPDATE SET radarr_error = $4, status = 'pending'`,
        [movie.slug, movie.title, movie.year, e.message, list.id]
      );
      continue;
    }

    if (!radarrMovie) {
      await pool.query(
        `INSERT INTO movies (letterboxd_slug, title, year, radarr_error, status, list_id)
         VALUES ($1, $2, $3, $4, 'pending', $5)
         ON CONFLICT (letterboxd_slug, list_id) DO UPDATE SET radarr_error = $4, status = 'pending'`,
        [movie.slug, movie.title, movie.year, 'No match found in Radarr', list.id]
      );
      continue;
    }

    try {
      const added = await radarr.add(
        radarrMovie,
        settings.radarr_quality_profile_id,
        settings.radarr_root_folder_path
      );
      await pool.query(
        `INSERT INTO movies (letterboxd_slug, title, year, tmdb_id, radarr_id, status, list_id)
         VALUES ($1, $2, $3, $4, $5, 'queued', $6)
         ON CONFLICT (letterboxd_slug, list_id) DO UPDATE
           SET tmdb_id = $4, radarr_id = $5, status = 'queued', radarr_error = NULL`,
        [movie.slug, movie.title, movie.year, radarrMovie.tmdbId, added.id, list.id]
      );
    } catch (e) {
      // 400 means Radarr already has the movie — look it up by tmdbId
      if (e.response?.status === 400) {
        try {
          const existing = await radarr.lookup(movie.title, movie.year);
          if (existing?.id) {
            await pool.query(
              `INSERT INTO movies (letterboxd_slug, title, year, tmdb_id, radarr_id, status, list_id)
               VALUES ($1, $2, $3, $4, $5, 'queued', $6)
               ON CONFLICT (letterboxd_slug, list_id) DO UPDATE
                 SET tmdb_id = $4, radarr_id = $5, status = 'queued', radarr_error = NULL`,
              [movie.slug, movie.title, movie.year, existing.tmdbId, existing.id, list.id]
            );
          }
        } catch (_) {}
      } else {
        await pool.query(
          `INSERT INTO movies (letterboxd_slug, title, year, radarr_error, status, list_id)
           VALUES ($1, $2, $3, $4, 'pending', $5)
           ON CONFLICT (letterboxd_slug, list_id) DO UPDATE SET radarr_error = $4, status = 'pending'`,
          [movie.slug, movie.title, movie.year, e.message, list.id]
        );
      }
    }
  }

  await pool.query('UPDATE lists SET last_synced_at = NOW() WHERE id = $1', [list.id]);
}

async function updateStatuses(radarr) {
  const { rows } = await pool.query(
    `SELECT id, radarr_id FROM movies WHERE radarr_id IS NOT NULL AND status != 'downloaded'`
  );
  if (rows.length === 0) return;

  const queue = await radarr.getQueue();
  const queueByMovieId = new Map(queue.map(q => [q.movieId, q]));

  for (const movie of rows) {
    try {
      const data = await radarr.get(movie.radarr_id);
      const queueItem = queueByMovieId.get(movie.radarr_id);
      const status = data.hasFile
        ? 'downloaded'
        : queueItem
          ? 'downloading'
          : 'queued';

      let progress = null;
      if (data.hasFile) {
        progress = 100;
      } else if (queueItem && queueItem.size) {
        progress = Math.round(((queueItem.size - queueItem.sizeleft) / queueItem.size) * 1000) / 10;
      }

      const overview = data.overview ?? null;
      const genres = (data.genres ?? []).join(', ') || null;
      const poster = (data.images ?? []).find(i => i.coverType === 'poster')?.remoteUrl ?? null;

      await pool.query(
        `UPDATE movies SET status = $1, progress = $2, overview = $3, genres = $4, poster_url = $5 WHERE id = $6`,
        [status, progress, overview, genres, poster, movie.id]
      );
    } catch (_) {}
  }
}

async function runSync() {
  if (running) return;
  running = true;
  try {
    const settings = await getSettings();
    const radarr = radarrClient(settings);
    const { rows: lists } = await pool.query('SELECT * FROM lists');
    for (const list of lists) {
      try {
        await syncList(list, radarr, settings);
      } catch (e) {
        console.error(`syncList failed for list "${list.name}":`, e.message);
      }
    }
    await updateStatuses(radarr);
    lastSyncedAt = new Date();
  } finally {
    running = false;
  }
}

async function refreshStatuses() {
  if (running) return;
  try {
    const settings = await getSettings();
    const radarr = radarrClient(settings);
    await updateStatuses(radarr);
  } catch (e) {
    console.error('refreshStatuses failed:', e.message);
  }
}

function getStatus() {
  return { running, lastSyncedAt };
}

module.exports = { runSync, refreshStatuses, getStatus };
