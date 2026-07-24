const fs = require('fs/promises');
const path = require('path');
const { pool } = require('./db');
const { getSettings } = require('./settings');
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

// If Radarr reports absolutely nothing for a movie (no queue item, no file)
// for longer than this, it's flagged as stalled instead of silently shown
// as "queued" forever — see updateStatuses.
const STALL_THRESHOLD_MS = 20 * 60 * 1000;

async function addNewMovies(list, movies, radarr, settings) {
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
}

// Movies that were added because of a list entry, but whose entry has since
// been removed from the Letterboxd list, get deleted: from Radarr (which also
// deletes the organized /movies copy), qBittorrent (which stops seeding and
// deletes the raw file in /downloads — Radarr's own deleteFiles never touches
// that), a filesystem safety-net pass in case anything's still left behind,
// TFA's own DB, and a Plex library nudge so the dead entry doesn't linger.
//
// slugsByList maps every OTHER list's slug set for this same sync cycle (built
// upfront in runSync, before any list's removals run) — a movie missing from
// this list but present on another is a move, not a real removal, and gets
// re-pointed at its new list instead of being deleted and re-downloaded from
// scratch (this is exactly what used to happen: moving a movie between lists
// deleted its Radarr entry and finished download, then re-added and
// re-downloaded it fresh under the new list).
async function reconcileRemovals(list, movies, radarr, plex, qbittorrent, slugsByList) {
  const currentSlugs = new Set(movies.map(m => m.slug));
  const { rows } = await pool.query(
    'SELECT id, letterboxd_slug, radarr_id, title FROM movies WHERE list_id = $1',
    [list.id]
  );
  const stale = rows.filter(r => !currentSlugs.has(r.letterboxd_slug));
  if (stale.length === 0) return;

  let removedAny = false;

  for (const row of stale) {
    const otherListId = [...(slugsByList.get(row.letterboxd_slug) ?? [])].find(id => id !== list.id);
    if (otherListId != null) {
      const { rows: conflict } = await pool.query(
        'SELECT id FROM movies WHERE letterboxd_slug = $1 AND list_id = $2',
        [row.letterboxd_slug, otherListId]
      );
      // Destination list already independently tracks this movie (e.g. added
      // to both lists at different times) — don't move, fall through to the
      // normal removal below so the two rows don't collide.
      if (conflict.length === 0) {
        await pool.query('UPDATE movies SET list_id = $1 WHERE id = $2', [otherListId, row.id]);
        console.log(`Moved "${row.title}" from list "${list.name}" to another tracked list — no re-download needed`);
        continue;
      }
    }

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

// Sums the files directly inside a movie's destination folder — used to
// show real progress while Radarr is copying the finished download in from
// /downloads (a slow byte-for-byte copy for large files, not instant).
async function getFolderSize(folderPath) {
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      if (entry.isFile()) {
        const stat = await fs.stat(path.join(folderPath, entry.name));
        total += stat.size;
      }
    }
    return total;
  } catch (_) {
    return null;
  }
}

async function updateStatuses(radarr, plex) {
  const { rows } = await pool.query(
    `SELECT id, radarr_id, director, credits, status, queue_missing_since FROM movies
     WHERE radarr_id IS NOT NULL AND (status != 'downloaded' OR size_bytes IS NULL OR director IS NULL OR credits IS NULL)`
  );
  if (rows.length === 0) return;

  const queue = await radarr.getQueue();
  const queueByMovieId = new Map(queue.map(q => [q.movieId, q]));
  let justFinishedImporting = false;

  for (const movie of rows) {
    try {
      const data = await radarr.get(movie.radarr_id);
      const queueItem = queueByMovieId.get(movie.radarr_id);
      // A queue item just means Radarr grabbed a release — it may still be
      // sitting in the torrent client's own queue (e.g. hit the max
      // concurrent downloads limit), not actually transferring yet. Once the
      // torrent finishes, Radarr copies it into /movies (slow for large
      // files, and not instant like a hardlink) before hasFile flips true —
      // trackedDownloadState catches that in-between window.
      const actuallyDownloading = queueItem?.status === 'downloading';
      const importingNow = ['importing', 'importPending'].includes(queueItem?.trackedDownloadState);
      const status = data.hasFile
        ? 'downloaded'
        : actuallyDownloading
          ? 'downloading'
          : importingNow
            ? 'importing'
            : 'queued';

      if (status === 'downloaded' && movie.status !== 'downloaded') justFinishedImporting = true;

      // Radarr can silently lose track of a grabbed download (observed: a
      // duplicate/reused release hash meant the queue entry never
      // materialized despite qBittorrent finishing the download) — nothing
      // in the queue and no file means TFA would otherwise show "queued"
      // forever with no way to tell that from a healthy one just waiting
      // its turn. Flag it as an error once that's been true for a while,
      // instead of a normal brief gap between polls.
      let queueMissingSince = movie.queue_missing_since;
      let stallError = null;
      if (!data.hasFile && !queueItem) {
        if (!queueMissingSince) {
          queueMissingSince = new Date();
        } else if (Date.now() - new Date(queueMissingSince).getTime() > STALL_THRESHOLD_MS) {
          stallError = 'Stalled — Radarr shows no active download. Try a manual search in Radarr.';
        }
      } else {
        queueMissingSince = null;
      }

      let progress = null;
      let sizeBytes = null;
      if (data.hasFile) {
        progress = 100;
        sizeBytes = data.sizeOnDisk || null;
      } else if (actuallyDownloading && queueItem.size) {
        progress = Math.round(((queueItem.size - queueItem.sizeleft) / queueItem.size) * 1000) / 10;
        sizeBytes = queueItem.size;
      } else if (importingNow && queueItem?.size) {
        sizeBytes = queueItem.size;
        const importedSoFar = data.path ? await getFolderSize(data.path) : null;
        if (importedSoFar != null) {
          progress = Math.min(100, Math.round((importedSoFar / sizeBytes) * 1000) / 10);
        }
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
           credits = $12, queue_missing_since = $13, radarr_error = $14
         WHERE id = $15`,
        [status, progress, overview, genres, poster, sizeBytes, director, runtime, certification, studio, ratings, creditsJson, queueMissingSince, stallError, movie.id]
      );
    } catch (e) {
      // Radarr no longer has this movie at all (e.g. deleted directly in its
      // own UI, outside TFA) — clearing radarr_id and setting radarr_error
      // makes addNewMovies treat it as a fresh add again next sync, instead
      // of silently never updating this row again.
      if (e.response?.status === 404) {
        try {
          await pool.query(
            `UPDATE movies SET radarr_id = NULL, queue_missing_since = NULL,
               radarr_error = 'Radarr no longer has this movie — it will be re-added on the next sync.'
             WHERE id = $1`,
            [movie.id]
          );
        } catch (_) {}
      }
    }
  }

  if (justFinishedImporting && plex) {
    try {
      await plex.refresh();
    } catch (e) {
      console.error('Plex refresh failed:', e.message);
    }
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

    // Every list is scraped up front, before any removal or addition runs,
    // so a movie moved from list A to list B can be recognized as a move
    // regardless of which list happens to sync first this cycle — doing
    // this per-list (the old behavior) meant whichever list processed
    // first had no way to know the movie had landed on another list.
    const scraped = new Map();
    for (const list of lists) {
      try {
        scraped.set(list.id, await fetchList(list.url));
      } catch (e) {
        console.error(`Failed to fetch list "${list.name}":`, e.message);
      }
    }

    const slugsByList = new Map();
    for (const [listId, movies] of scraped) {
      for (const m of movies) {
        if (!slugsByList.has(m.slug)) slugsByList.set(m.slug, new Set());
        slugsByList.get(m.slug).add(listId);
      }
    }

    for (const list of lists) {
      const movies = scraped.get(list.id);
      if (!movies) continue; // this list's fetch failed — leave its rows alone this cycle
      try {
        await reconcileRemovals(list, movies, radarr, plex, qbittorrent, slugsByList);
      } catch (e) {
        console.error(`reconcileRemovals failed for list "${list.name}":`, e.message);
      }
    }

    for (const list of lists) {
      const movies = scraped.get(list.id);
      if (!movies) continue;
      try {
        await addNewMovies(list, movies, radarr, settings);
        await pool.query('UPDATE lists SET last_synced_at = NOW() WHERE id = $1', [list.id]);
      } catch (e) {
        console.error(`addNewMovies failed for list "${list.name}":`, e.message);
      }
    }

    await updateStatuses(radarr, plex);
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
    const plex = plexClient(settings);
    await updateStatuses(radarr, plex);
  } catch (e) {
    console.error('refreshStatuses failed:', e.message);
  }
}

function getStatus() {
  return { running, lastSyncedAt };
}

module.exports = { runSync, refreshStatuses, getStatus };
