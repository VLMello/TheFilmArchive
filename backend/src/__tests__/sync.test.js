jest.mock('../db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../letterboxd', () => ({ fetchList: jest.fn() }));
jest.mock('../radarr', () => ({ client: jest.fn() }));
jest.mock('../plex', () => ({ client: jest.fn() }));
jest.mock('../qbittorrent', () => ({ client: jest.fn() }));
jest.mock('fs/promises', () => ({ rm: jest.fn(), readdir: jest.fn(), stat: jest.fn() }));

const { pool } = require('../db');
const { fetchList } = require('../letterboxd');
const { client: radarrClientFactory } = require('../radarr');
const { client: plexClientFactory } = require('../plex');
const { client: qbittorrentClientFactory } = require('../qbittorrent');
const fs = require('fs/promises');
const { runSync, refreshStatuses, getStatus } = require('../sync');

const mockRadarr = {
  lookup: jest.fn(),
  add: jest.fn(),
  get: jest.fn(),
  getQueue: jest.fn(),
  remove: jest.fn(),
  getHistory: jest.fn(),
  getCredits: jest.fn(),
  search: jest.fn(),
  removeQueueItem: jest.fn(),
};

const mockPlex = {
  refresh: jest.fn(),
  refreshAndClean: jest.fn(),
};

const mockQbittorrent = {
  removeByHash: jest.fn(),
};

const SETTINGS_ROWS = [
  { key: 'radarr_url', value: 'http://radarr:7878' },
  { key: 'radarr_api_key', value: 'key' },
  { key: 'radarr_quality_profile_id', value: '1' },
  { key: 'radarr_root_folder_path', value: '/movies' },
];

// pool.query is dispatched by matching a distinctive substring of the SQL
// text rather than hard-coding call order — the sync/reconcile pipeline now
// makes a variable number of calls per list, so a strict sequential chain of
// mockResolvedValueOnce would be extremely brittle here.
function mockDb(handlers) {
  pool.query.mockImplementation((sql, params = []) => {
    for (const [pattern, fn] of handlers) {
      if (sql.includes(pattern)) return Promise.resolve(fn(params) ?? { rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  radarrClientFactory.mockReturnValue(mockRadarr);
  plexClientFactory.mockReturnValue(mockPlex);
  qbittorrentClientFactory.mockReturnValue(mockQbittorrent);
  fs.rm.mockResolvedValue();
  mockRadarr.getHistory.mockResolvedValue([]);
  mockRadarr.getCredits.mockResolvedValue([]);
  mockRadarr.getQueue.mockResolvedValue([]);
  mockRadarr.search.mockResolvedValue();
  mockRadarr.removeQueueItem.mockResolvedValue();
});

function callsMatching(pattern) {
  return pool.query.mock.calls.filter(c => typeof c[0] === 'string' && c[0].includes(pattern));
}

test('getStatus returns not running initially', () => {
  const status = getStatus();
  expect(status.running).toBe(false);
  expect(status.lastSyncedAt).toBeNull();
});

test('runSync adds new movie to Radarr and sets status queued', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT * FROM lists', () => ({ rows: [{ id: 1, name: 'Queue', url: 'https://letterboxd.com/user/list/queue' }] })],
    ['SELECT id, letterboxd_slug, radarr_id, title FROM movies WHERE list_id', () => ({ rows: [] })],
    ['SELECT id, radarr_error FROM movies', () => ({ rows: [] })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since', () => ({ rows: [] })],
  ]);
  fetchList.mockResolvedValue([{ title: 'The Godfather', year: 1972, slug: 'the-godfather' }]);
  mockRadarr.lookup.mockResolvedValue({ tmdbId: 238, title: 'The Godfather', year: 1972 });
  mockRadarr.add.mockResolvedValue({ id: 42, title: 'The Godfather' });

  await runSync();

  expect(fetchList).toHaveBeenCalledWith('https://letterboxd.com/user/list/queue');
  expect(mockRadarr.lookup).toHaveBeenCalledWith('The Godfather', 1972);
  expect(mockRadarr.add).toHaveBeenCalledWith(
    { tmdbId: 238, title: 'The Godfather', year: 1972 },
    '1',
    '/movies'
  );
  const insertCall = callsMatching('INSERT INTO movies')[0];
  expect(insertCall).toBeTruthy();
  expect(insertCall[1]).toContain(42); // radarr_id

  expect(mockRadarr.remove).not.toHaveBeenCalled();
  expect(mockPlex.refreshAndClean).not.toHaveBeenCalled();
});

test('runSync records radarr_error when lookup returns null', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT * FROM lists', () => ({ rows: [{ id: 1, name: 'Queue', url: 'https://letterboxd.com/user/list/queue' }] })],
    ['SELECT id, letterboxd_slug, radarr_id, title FROM movies WHERE list_id', () => ({ rows: [] })],
    ['SELECT id, radarr_error FROM movies', () => ({ rows: [] })],
  ]);
  fetchList.mockResolvedValue([{ title: 'Unknown Film', year: 1900, slug: 'unknown-film' }]);
  mockRadarr.lookup.mockResolvedValue(null);

  await runSync();

  const insertCall = callsMatching('INSERT INTO movies').find(c => c[1]?.includes('No match found in Radarr'));
  expect(insertCall).toBeTruthy();
});

test('removes a movie no longer on any tracked list from Radarr, qBittorrent, disk, and the DB, then nudges Plex', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT * FROM lists', () => ({ rows: [{ id: 1, name: 'Next in Line', url: 'https://letterboxd.com/user/list/queue' }] })],
    ['SELECT id, letterboxd_slug, radarr_id, title FROM movies WHERE list_id',
      () => ({ rows: [{ id: 5, letterboxd_slug: 'gone-movie', radarr_id: 7, title: 'Gone Movie' }] })],
  ]);
  fetchList.mockResolvedValue([]); // list is now empty, and no other list has this slug either
  mockRadarr.get.mockResolvedValue({ path: '/movies/Gone Movie (2020)' });
  mockRadarr.getHistory.mockResolvedValue([
    { eventType: 'grabbed', data: { torrentInfoHash: 'ABCHASH123' } },
  ]);
  mockRadarr.remove.mockResolvedValue();

  await runSync();

  expect(mockRadarr.get).toHaveBeenCalledWith(7);
  expect(mockRadarr.getHistory).toHaveBeenCalledWith(7);
  expect(mockRadarr.remove).toHaveBeenCalledWith(7);
  expect(fs.rm).toHaveBeenCalledWith('/movies/Gone Movie (2020)', { recursive: true, force: true });
  expect(mockQbittorrent.removeByHash).toHaveBeenCalledWith('ABCHASH123');

  const deleteCall = callsMatching('DELETE FROM movies')[0];
  expect(deleteCall).toBeTruthy();
  expect(deleteCall[1]).toEqual([5]);

  expect(mockPlex.refreshAndClean).toHaveBeenCalled();
});

test('still removes the movie even if no download hash can be found', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT * FROM lists', () => ({ rows: [{ id: 1, name: 'Next in Line', url: 'https://letterboxd.com/user/list/queue' }] })],
    ['SELECT id, letterboxd_slug, radarr_id, title FROM movies WHERE list_id',
      () => ({ rows: [{ id: 5, letterboxd_slug: 'gone-movie', radarr_id: 7, title: 'Gone Movie' }] })],
  ]);
  fetchList.mockResolvedValue([]);
  mockRadarr.get.mockResolvedValue({ path: '/movies/Gone Movie (2020)' });
  mockRadarr.getHistory.mockResolvedValue([]); // no grabbed event on record
  mockRadarr.remove.mockResolvedValue();

  await runSync();

  expect(mockQbittorrent.removeByHash).not.toHaveBeenCalled();
  expect(callsMatching('DELETE FROM movies')[0]).toBeTruthy();
});

test('keeps the DB row and does not delete files if Radarr is unreachable', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT * FROM lists', () => ({ rows: [{ id: 1, name: 'Next in Line', url: 'https://letterboxd.com/user/list/queue' }] })],
    ['SELECT id, letterboxd_slug, radarr_id, title FROM movies WHERE list_id',
      () => ({ rows: [{ id: 5, letterboxd_slug: 'gone-movie', radarr_id: 7, title: 'Gone Movie' }] })],
  ]);
  fetchList.mockResolvedValue([]);
  mockRadarr.get.mockRejectedValue({ message: 'network error', response: undefined });

  await runSync();

  expect(mockRadarr.remove).not.toHaveBeenCalled();
  expect(fs.rm).not.toHaveBeenCalled();
  expect(mockQbittorrent.removeByHash).not.toHaveBeenCalled();
  expect(callsMatching('DELETE FROM movies')[0]).toBeFalsy();
  expect(mockPlex.refreshAndClean).not.toHaveBeenCalled();
});

test('still cleans up the DB row when Radarr already lost track of the movie (404)', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT * FROM lists', () => ({ rows: [{ id: 1, name: 'Next in Line', url: 'https://letterboxd.com/user/list/queue' }] })],
    ['SELECT id, letterboxd_slug, radarr_id, title FROM movies WHERE list_id',
      () => ({ rows: [{ id: 5, letterboxd_slug: 'gone-movie', radarr_id: 7, title: 'Gone Movie' }] })],
  ]);
  fetchList.mockResolvedValue([]);
  mockRadarr.get.mockRejectedValue({ message: 'not found', response: { status: 404 } });

  await runSync();

  expect(callsMatching('DELETE FROM movies')[0]).toBeTruthy();
  expect(fs.rm).not.toHaveBeenCalled(); // no folder path known, nothing to clean
});

test('moves a movie between lists instead of deleting and re-downloading it', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT * FROM lists', () => ({
      rows: [
        { id: 1, name: 'Old List', url: 'https://letterboxd.com/user/list/old' },
        { id: 2, name: 'New List', url: 'https://letterboxd.com/user/list/new' },
      ],
    })],
    ['SELECT id, letterboxd_slug, radarr_id, title FROM movies WHERE list_id', (params) => {
      if (params[0] === 1) return { rows: [{ id: 26, letterboxd_slug: 'michael-2026', radarr_id: 24, title: 'Michael' }] };
      return { rows: [] }; // list 2 has no DB rows yet — Michael is new to it
    }],
    // Conflict check for the move: destination list (2) has no independent row for this slug
    ['SELECT id FROM movies WHERE letterboxd_slug', () => ({ rows: [] })],
    ['SELECT id, radarr_error FROM movies', () => ({ rows: [] })], // won't be reached for Michael, but list 2's own fresh addNewMovies pass runs
  ]);
  fetchList.mockImplementation((url) => {
    if (url.endsWith('/old')) return Promise.resolve([]); // Michael removed from the old list
    return Promise.resolve([{ title: 'Michael', year: 2026, slug: 'michael-2026' }]); // and now on the new one
  });

  await runSync();

  const moveCall = callsMatching('UPDATE movies SET list_id')[0];
  expect(moveCall).toBeTruthy();
  expect(moveCall[1]).toEqual([2, 26]);

  // No destructive action taken — the existing Radarr entry/file is left alone
  expect(mockRadarr.remove).not.toHaveBeenCalled();
  expect(fs.rm).not.toHaveBeenCalled();
  expect(mockQbittorrent.removeByHash).not.toHaveBeenCalled();
  expect(callsMatching('DELETE FROM movies')[0]).toBeFalsy();
  // Radarr never gets asked to add "Michael" fresh, since after the move
  // list 2's own exists-check would find the (now repointed) row
  expect(mockRadarr.add).not.toHaveBeenCalled();
});

test('falls back to a normal removal when the destination list already independently tracks the movie', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT * FROM lists', () => ({
      rows: [
        { id: 1, name: 'Old List', url: 'https://letterboxd.com/user/list/old' },
        { id: 2, name: 'New List', url: 'https://letterboxd.com/user/list/new' },
      ],
    })],
    ['SELECT id, letterboxd_slug, radarr_id, title FROM movies WHERE list_id', (params) => {
      if (params[0] === 1) return { rows: [{ id: 26, letterboxd_slug: 'michael-2026', radarr_id: 24, title: 'Michael' }] };
      return { rows: [] };
    }],
    // Conflict check: list 2 ALREADY has its own independent row for this slug
    ['SELECT id FROM movies WHERE letterboxd_slug', () => ({ rows: [{ id: 99 }] })],
  ]);
  fetchList.mockImplementation((url) => {
    if (url.endsWith('/old')) return Promise.resolve([]);
    return Promise.resolve([{ title: 'Michael', year: 2026, slug: 'michael-2026' }]);
  });
  mockRadarr.get.mockResolvedValue({ path: '/movies/Michael (2026)' });
  mockRadarr.remove.mockResolvedValue();

  await runSync();

  expect(callsMatching('UPDATE movies SET list_id')[0]).toBeFalsy();
  expect(mockRadarr.remove).toHaveBeenCalledWith(24);
  expect(callsMatching('DELETE FROM movies')[0]).toBeTruthy();
});

test('a queue item that is not actually transferring yet is reported as queued, not downloading', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since', () => ({ rows: [{ id: 1, radarr_id: 42 }] })],
  ]);
  mockRadarr.get.mockResolvedValue({ hasFile: false, overview: null, genres: [], images: [] });
  mockRadarr.getQueue.mockResolvedValue([
    { movieId: 42, status: 'queued', size: 5_000_000_000, sizeleft: 5_000_000_000 },
  ]);

  await refreshStatuses();

  const updateCall = callsMatching('UPDATE movies SET status')[0];
  expect(updateCall).toBeTruthy();
  const [status, progress, , , , sizeBytes] = updateCall[1];
  expect(status).toBe('queued');
  expect(progress).toBeNull();
  expect(sizeBytes).toBe(5_000_000_000); // size still recorded even though not downloading yet
});

test('a queue item that is actually transferring is reported as downloading with progress', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since', () => ({ rows: [{ id: 1, radarr_id: 42 }] })],
  ]);
  mockRadarr.get.mockResolvedValue({ hasFile: false, overview: null, genres: [], images: [] });
  mockRadarr.getQueue.mockResolvedValue([
    { movieId: 42, status: 'downloading', size: 10_000_000_000, sizeleft: 7_500_000_000 },
  ]);

  await refreshStatuses();

  const updateCall = callsMatching('UPDATE movies SET status')[0];
  const [status, progress] = updateCall[1];
  expect(status).toBe('downloading');
  expect(progress).toBe(25);
});

test('a finished torrent still being copied into /movies is reported as importing with real progress', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since', () => ({ rows: [{ id: 1, radarr_id: 42 }] })],
  ]);
  mockRadarr.get.mockResolvedValue({
    hasFile: false, overview: null, genres: [], images: [], path: '/movies/Some Movie (2020)',
  });
  mockRadarr.getQueue.mockResolvedValue([
    { movieId: 42, status: 'completed', trackedDownloadState: 'importing', size: 100_000_000, sizeleft: 0 },
  ]);
  fs.readdir.mockResolvedValue([{ name: 'movie.mkv', isFile: () => true }]);
  fs.stat.mockResolvedValue({ size: 40_000_000 });

  await refreshStatuses();

  expect(fs.readdir).toHaveBeenCalledWith('/movies/Some Movie (2020)', { withFileTypes: true });
  const updateCall = callsMatching('UPDATE movies SET status')[0];
  const [status, progress, , , , sizeBytes] = updateCall[1];
  expect(status).toBe('importing');
  expect(progress).toBe(40);
  expect(sizeBytes).toBe(100_000_000);
});

test('a queue item still queued to import (not yet copying) is also reported as importing', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since', () => ({ rows: [{ id: 1, radarr_id: 42 }] })],
  ]);
  mockRadarr.get.mockResolvedValue({ hasFile: false, overview: null, genres: [], images: [], path: '/movies/Some Movie (2020)' });
  mockRadarr.getQueue.mockResolvedValue([
    { movieId: 42, status: 'completed', trackedDownloadState: 'importPending', size: 100_000_000, sizeleft: 0 },
  ]);
  fs.readdir.mockResolvedValue([]);

  await refreshStatuses();

  const updateCall = callsMatching('UPDATE movies SET status')[0];
  expect(updateCall[1][0]).toBe('importing');
});

test('nudges Plex once a movie finishes importing and becomes downloaded', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since', () => ({ rows: [{ id: 1, radarr_id: 42, status: 'importing' }] })],
  ]);
  mockRadarr.get.mockResolvedValue({ hasFile: true, sizeOnDisk: 100_000_000, overview: null, genres: [], images: [] });

  await refreshStatuses();

  expect(mockPlex.refresh).toHaveBeenCalledTimes(1);
});

test('does not nudge Plex when nothing finished importing this cycle', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since', () => ({ rows: [{ id: 1, radarr_id: 42, status: 'downloading' }] })],
  ]);
  mockRadarr.get.mockResolvedValue({ hasFile: false, overview: null, genres: [], images: [] });
  mockRadarr.getQueue.mockResolvedValue([
    { movieId: 42, status: 'downloading', size: 10_000_000_000, sizeleft: 7_500_000_000 },
  ]);

  await refreshStatuses();

  expect(mockPlex.refresh).not.toHaveBeenCalled();
});

test('does not nudge Plex again for a movie that was already downloaded', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    // still selected because size_bytes is null, but status is already 'downloaded'
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since', () => ({ rows: [{ id: 1, radarr_id: 42, status: 'downloaded' }] })],
  ]);
  mockRadarr.get.mockResolvedValue({ hasFile: true, sizeOnDisk: 100_000_000, overview: null, genres: [], images: [] });

  await refreshStatuses();

  expect(mockPlex.refresh).not.toHaveBeenCalled();
});

test('marks queue_missing_since the first time Radarr reports no queue item and no file', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since', () => ({ rows: [{ id: 1, radarr_id: 42, queue_missing_since: null }] })],
  ]);
  mockRadarr.get.mockResolvedValue({ hasFile: false, overview: null, genres: [], images: [] });
  // getQueue defaults to [] in beforeEach — no queue item for movie 42

  await refreshStatuses();

  const updateCall = callsMatching('UPDATE movies SET status')[0];
  const [, , , , , , , , , , , , queueMissingSince, radarrError] = updateCall[1];
  expect(queueMissingSince).toBeInstanceOf(Date);
  expect(radarrError).toBeNull(); // not flagged as stalled yet — first time seeing this
});

test('retries automatically (cleans up the old download, asks Radarr to search again) the first time a movie is found stalled', async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since',
      () => ({ rows: [{ id: 1, radarr_id: 42, queue_missing_since: twoHoursAgo, stall_retry_count: 0 }] })],
  ]);
  mockRadarr.get.mockResolvedValue({ hasFile: false, overview: null, genres: [], images: [] });
  mockRadarr.getHistory.mockResolvedValue([{ eventType: 'grabbed', data: { torrentInfoHash: 'ABC123' } }]);

  await refreshStatuses();

  expect(mockQbittorrent.removeByHash).toHaveBeenCalledWith('ABC123');
  expect(mockRadarr.search).toHaveBeenCalledWith(42);

  const updateCall = callsMatching('UPDATE movies SET status')[0];
  const [, , , , , , , , , , , , queueMissingSince, radarrError, stallRetryCount] = updateCall[1];
  expect(radarrError).toBeNull(); // still retrying automatically — nothing surfaced to the user yet
  expect(stallRetryCount).toBe(1);
  expect(queueMissingSince).toBeInstanceOf(Date); // clock restarted for this attempt
});

test('also retries a movie whose queue entry exists but is stuck in "warning" (e.g. a dead torrent with no seeders)', async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since',
      () => ({ rows: [{ id: 1, radarr_id: 42, queue_missing_since: twoHoursAgo, stall_retry_count: 0 }] })],
  ]);
  mockRadarr.get.mockResolvedValue({ hasFile: false, overview: null, genres: [], images: [] });
  mockRadarr.getQueue.mockResolvedValue([
    { movieId: 42, id: 777, status: 'warning', errorMessage: 'The download is stalled with no connections' },
  ]);

  await refreshStatuses();

  // Blocklisted via the queue entry itself, not a qBittorrent hash lookup —
  // there's an active queue item to work with here, unlike the fully-missing case.
  expect(mockRadarr.removeQueueItem).toHaveBeenCalledWith(777, { removeFromClient: true, blocklist: true });
  expect(mockQbittorrent.removeByHash).not.toHaveBeenCalled();
  expect(mockRadarr.search).toHaveBeenCalledWith(42);

  const updateCall = callsMatching('UPDATE movies SET status')[0];
  const [, , , , , , , , , , , , , radarrError, stallRetryCount] = updateCall[1];
  expect(radarrError).toBeNull();
  expect(stallRetryCount).toBe(1);
});

test('surfaces an error only after exhausting all automatic retries', async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since',
      () => ({ rows: [{ id: 1, radarr_id: 42, queue_missing_since: twoHoursAgo, stall_retry_count: 3 }] })],
  ]);
  mockRadarr.get.mockResolvedValue({ hasFile: false, overview: null, genres: [], images: [] });

  await refreshStatuses();

  expect(mockRadarr.search).not.toHaveBeenCalled();
  const updateCall = callsMatching('UPDATE movies SET status')[0];
  const [, , , , , , , , , , , , , radarrError, stallRetryCount] = updateCall[1];
  expect(radarrError).toMatch(/Stalled after 3 automatic retries/);
  expect(stallRetryCount).toBe(3);
});

test('clears the stalled flag and retry count once a queue item reappears', async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since',
      () => ({ rows: [{ id: 1, radarr_id: 42, queue_missing_since: twoHoursAgo, stall_retry_count: 2 }] })],
  ]);
  mockRadarr.get.mockResolvedValue({ hasFile: false, overview: null, genres: [], images: [] });
  mockRadarr.getQueue.mockResolvedValue([
    { movieId: 42, status: 'queued', size: 1_000_000_000, sizeleft: 1_000_000_000 },
  ]);

  await refreshStatuses();

  const updateCall = callsMatching('UPDATE movies SET status')[0];
  const [, , , , , , , , , , , , queueMissingSince, radarrError, stallRetryCount] = updateCall[1];
  expect(queueMissingSince).toBeNull();
  expect(radarrError).toBeNull();
  expect(stallRetryCount).toBe(0);
});

test('clears a queue entry stuck in "warning" once the file is already downloaded', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since', () => ({ rows: [{ id: 1, radarr_id: 42 }] })],
  ]);
  mockRadarr.get.mockResolvedValue({ hasFile: true, sizeOnDisk: 123, overview: null, genres: [], images: [], title: 'Michael' });
  mockRadarr.getQueue.mockResolvedValue([{ movieId: 42, id: 999, status: 'warning' }]);

  await refreshStatuses();

  expect(mockRadarr.removeQueueItem).toHaveBeenCalledWith(999, { removeFromClient: true, blocklist: false });
});

test('clears radarr_id and flags for re-adding when Radarr no longer has the movie at all', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since', () => ({ rows: [{ id: 1, radarr_id: 42 }] })],
  ]);
  mockRadarr.get.mockRejectedValue({ message: 'not found', response: { status: 404 } });

  await refreshStatuses();

  const orphanCall = callsMatching('UPDATE movies SET radarr_id = NULL')[0];
  expect(orphanCall).toBeTruthy();
  expect(orphanCall[1]).toEqual([1]);
});

test('fetches director/runtime/certification/studio/ratings/cast/crew when unknown', async () => {
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since',
      () => ({ rows: [{ id: 1, radarr_id: 42, director: null, credits: null }] })],
  ]);
  mockRadarr.get.mockResolvedValue({
    hasFile: false,
    overview: 'A movie.',
    genres: ['Drama'],
    images: [],
    runtime: 175,
    certification: 'R',
    studio: 'Paramount',
    ratings: { imdb: { value: 9.2 } },
  });
  mockRadarr.getCredits.mockResolvedValue([
    { type: 'crew', job: 'Director', personName: 'Francis Ford Coppola' },
    { type: 'cast', order: 1, character: 'Michael Corleone', personName: 'Al Pacino' },
    { type: 'cast', order: 0, character: 'Vito Corleone', personName: 'Marlon Brando' },
    { type: 'crew', job: 'Screenplay', personName: 'Mario Puzo' },
    { type: 'crew', job: 'Boom Operator', personName: 'Someone Obscure' }, // filtered out
  ]);

  await refreshStatuses();

  expect(mockRadarr.getCredits).toHaveBeenCalledWith(42);
  const updateCall = callsMatching('UPDATE movies SET status')[0];
  const [, , , , , , director, runtime, certification, studio, ratings, credits] = updateCall[1];
  expect(director).toBe('Francis Ford Coppola');
  expect(runtime).toBe(175);
  expect(certification).toBe('R');
  expect(studio).toBe('Paramount');
  expect(JSON.parse(ratings)).toEqual({ imdb: { value: 9.2 } });

  const parsedCredits = JSON.parse(credits);
  // cast sorted by order, Director excluded from crew, obscure job filtered out
  expect(parsedCredits.cast).toEqual([
    { name: 'Marlon Brando', character: 'Vito Corleone' },
    { name: 'Al Pacino', character: 'Michael Corleone' },
  ]);
  expect(parsedCredits.crew).toEqual([{ name: 'Mario Puzo', job: 'Screenplay' }]);
});

test('does not look up credits again once director and credits are already known', async () => {
  const existingCredits = { cast: [{ name: 'Marlon Brando', character: 'Vito Corleone' }], crew: [] };
  mockDb([
    ['SELECT key, value FROM settings', () => ({ rows: SETTINGS_ROWS })],
    ['SELECT id, radarr_id, director, credits, status, queue_missing_since',
      () => ({ rows: [{ id: 1, radarr_id: 42, director: 'Francis Ford Coppola', credits: existingCredits }] })],
  ]);
  mockRadarr.get.mockResolvedValue({ hasFile: false, overview: null, genres: [], images: [] });

  await refreshStatuses();

  expect(mockRadarr.getCredits).not.toHaveBeenCalled();
  const updateCall = callsMatching('UPDATE movies SET status')[0];
  expect(updateCall[1][6]).toBe('Francis Ford Coppola'); // director unchanged
  expect(JSON.parse(updateCall[1][11])).toEqual(existingCredits); // credits unchanged
});
