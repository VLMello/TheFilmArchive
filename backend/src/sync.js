const fs = require('fs/promises');
const { pool } = require('./db');
const { fetchList } = require('./letterboxd');
const { client: radarrClient } = require('./radarr');
const { client: plexClient } = require('./plex');
const { client: qbittorrentClient } = require('./qbittorrent');

let running = false;
let lastSyncedAt = null;

// Crew jobs worth surfacing on the detail page — deliberately excludes the
// long tail Radarr/TMDB tracks (stand-ins, boom operators, etc).
const NOTABLE_CREW_JOBS = [
  'Screenplay', 'Writer', 'Story', 'Producer', 'Executive Producer',
  'Director of Photography', 'Original Music Composer', 'Editor', 'Production Design',
];

async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function syncList(list, radarr, settings, plex, qbittorrent) {
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

  await reconcileRemovals(list, movies, radarr, plex, qbittorrent);

  await pool.query('UPDATE lists SET last_synced_at = NOW() WHERE id = $1', [list.id]);
}

// Movies that were added because of a list entry, but whose entry has since
// been removed from the Letterboxd list, get deleted: from Radarr (which also
// deletes the organized /movies copy), qBittorrent (which stops seeding and
// deletes the raw file in /downloads — Radarr's own deleteFiles never touches
// that), a filesystem safety-net pass in case anything's still left behind,
// TFA's own DB, and a Plex library nudge so the dead entry doesn't linger.
async function reconcileRemovals(list, movies, radarr, plex, qbittorrent) {
  const currentSlugs = new Set(movies.map(m => m.slug));
  const { rows } = await pool.query(
    'SELECT id, letterboxd_slug, radarr_id, title FROM movies WHERE list_id = $1',
    [list.id]
  );
  const stale = rows.filter(r => !currentSlugs.has(r.letterboxd_slug));
  if (stale.length === 0) return;

  let removedAny = false;

  for (const row of stale) {
    if (row.radarr_id) {
      let folderPath = null;
      try {
        const movie = await radarr.get(row.radarr_id);
        folderPath = movie?.path ?? null;
      } catch (e) {
        if (e.response?.status !== 404) {
          console.error(`Skipping removal of "${row.title}" — could not reach Radarr:`, e.message);
          continue;
        }
      }

      let torrentHash = null;
      try {
        const history = await radarr.getHistory(row.radarr_id);
        const grabbed = history.find(h => h.eventType === 'grabbed' && h.data?.torrentInfoHash);
        torrentHash = grabbed?.data?.torrentInfoHash ?? null;
      } catch (e) {
        console.error(`Could not look up download hash for "${row.title}":`, e.message);
      }

      try {
        await radarr.remove(row.radarr_id);
      } catch (e) {
        if (e.response?.status !== 404) {
          console.error(`Failed to delete "${row.title}" from Radarr:`, e.message);
          continue;
        }
      }

      if (folderPath) {
        try {
          await fs.rm(folderPath, { recursive: true, force: true });
        } catch (e) {
          console.error(`Filesystem cleanup failed for "${row.title}" at ${folderPath}:`, e.message);
        }
      }

      if (torrentHash && qbittorrent) {
        try {
          await qbittorrent.removeByHash(torrentHash);
        } catch (e) {
          console.error(`Failed to remove torrent for "${row.title}" from qBittorrent:`, e.message);
        }
      }
    }

    await pool.query('DELETE FROM movies WHERE id = $1', [row.id]);
    console.log(`Removed "${row.title}" — no longer on list "${list.name}"`);
    removedAny = true;
  }

  if (removedAny && plex) {
    try {
      await plex.refreshAndClean();
    } catch (e) {
      console.error('Plex refresh failed:', e.message);
    }
  }
}

async function updateStatuses(radarr) {
  const { rows } = await pool.query(
    `SELECT id, radarr_id, director, credits FROM movies
     WHERE radarr_id IS NOT NULL AND (status != 'downloaded' OR size_bytes IS NULL OR director IS NULL OR credits IS NULL)`
  );
  if (rows.length === 0) return;

  const queue = await radarr.getQueue();
  const queueByMovieId = new Map(queue.map(q => [q.movieId, q]));

  for (const movie of rows) {
    try {
      const data = await radarr.get(movie.radarr_id);
      const queueItem = queueByMovieId.get(movie.radarr_id);
      // A queue item just means Radarr grabbed a release — it may still be
      // sitting in the torrent client's own queue (e.g. hit the max
      // concurrent downloads limit), not actually transferring yet.
      const actuallyDownloading = queueItem?.status === 'downloading';
      const status = data.hasFile
        ? 'downloaded'
        : actuallyDownloading
          ? 'downloading'
          : 'queued';

      let progress = null;
      let sizeBytes = null;
      if (data.hasFile) {
        progress = 100;
        sizeBytes = data.sizeOnDisk || null;
      } else if (actuallyDownloading && queueItem.size) {
        progress = Math.round(((queueItem.size - queueItem.sizeleft) / queueItem.size) * 1000) / 10;
        sizeBytes = queueItem.size;
      } else if (queueItem?.size) {
        sizeBytes = queueItem.size; // known size even if not actively downloading yet
      }

      const overview = data.overview ?? null;
      const genres = (data.genres ?? []).join(', ') || null;
      const poster = (data.images ?? []).find(i => i.coverType === 'poster')?.remoteUrl ?? null;
      const runtime = data.runtime ?? null;
      const certification = data.certification ?? null;
      const studio = data.studio ?? null;
      const ratings = data.ratings ? JSON.stringify(data.ratings) : null;

      // Cast/crew never change once known — only fetched once per movie,
      // not on every sync cycle.
      let director = movie.director ?? null;
      let credits = movie.credits ?? null;
      if (!director || !credits) {
        try {
          const creditList = await radarr.getCredits(movie.radarr_id);
          director = creditList.find(c => c.type === 'crew' && c.job === 'Director')?.personName ?? director;
          const cast = creditList
            .filter(c => c.type === 'cast')
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .slice(0, 10)
            .map(c => ({ name: c.personName, character: c.character }));
          const crew = creditList
            .filter(c => c.type === 'crew' && c.job !== 'Director' && NOTABLE_CREW_JOBS.includes(c.job))
            .map(c => ({ name: c.personName, job: c.job }));
          credits = { cast, crew };
        } catch (_) {}
      }
      const creditsJson = credits ? JSON.stringify(credits) : null;

      await pool.query(
        `UPDATE movies SET status = $1, progress = $2, overview = $3, genres = $4, poster_url = $5,
           size_bytes = $6, director = $7, runtime = $8, certification = $9, studio = $10, ratings = $11,
           credits = $12
         WHERE id = $13`,
        [status, progress, overview, genres, poster, sizeBytes, director, runtime, certification, studio, ratings, creditsJson, movie.id]
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
    const plex = plexClient(settings);
    const qbittorrent = qbittorrentClient(settings);
    const { rows: lists } = await pool.query('SELECT * FROM lists');
    for (const list of lists) {
      try {
        await syncList(list, radarr, settings, plex, qbittorrent);
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
