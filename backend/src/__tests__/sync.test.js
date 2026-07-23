jest.mock('../db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../letterboxd', () => ({ fetchList: jest.fn() }));
jest.mock('../radarr', () => ({ client: jest.fn() }));
jest.mock('../plex', () => ({ client: jest.fn() }));
jest.mock('fs/promises', () => ({ rm: jest.fn() }));

const { pool } = require('../db');
const { fetchList } = require('../letterboxd');
const { client: radarrClientFactory } = require('../radarr');
const { client: plexClientFactory } = require('../plex');
const fs = require('fs/promises');
const { runSync, getStatus } = require('../sync');

const mockRadarr = {
  lookup: jest.fn(),
  add: jest.fn(),
  get: jest.fn(),
  getQueue: jest.fn(),
  remove: jest.fn(),
};

const mockPlex = {
  refreshAndClean: jest.fn(),
};

const SETTINGS_ROWS = [
  { key: 'radarr_url', value: 'http://radarr:7878' },
  { key: 'radarr_api_key', value: 'key' },
  { key: 'radarr_quality_profile_id', value: '1' },
  { key: 'radarr_root_folder_path', value: '/movies' },
];

beforeEach(() => {
  jest.clearAllMocks();
  radarrClientFactory.mockReturnValue(mockRadarr);
  plexClientFactory.mockReturnValue(mockPlex);
  fs.rm.mockResolvedValue();
});

test('getStatus returns not running initially', () => {
  const status = getStatus();
  expect(status.running).toBe(false);
  expect(status.lastSyncedAt).toBeNull();
});

test('runSync adds new movie to Radarr and sets status queued', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: SETTINGS_ROWS }) // settings
    .mockResolvedValueOnce({ rows: [{ id: 1, url: 'https://letterboxd.com/user/list/queue' }] }) // lists
    .mockResolvedValueOnce({ rows: [] }) // exists check → not found
    .mockResolvedValueOnce({ rows: [] }) // INSERT movie
    // reconcileRemovals: the movie we just added is still on the list, nothing stale
    .mockResolvedValueOnce({ rows: [{ id: 99, letterboxd_slug: 'the-godfather', radarr_id: 42, title: 'The Godfather' }] })
    .mockResolvedValueOnce({ rows: [] }) // UPDATE list last_synced_at
    .mockResolvedValueOnce({ rows: [] }); // non-downloaded movies for status update

  fetchList.mockResolvedValue([{ title: 'The Godfather', year: 1972, slug: 'the-godfather' }]);
  mockRadarr.lookup.mockResolvedValue({ tmdbId: 238, title: 'The Godfather', year: 1972 });
  mockRadarr.add.mockResolvedValue({ id: 42, title: 'The Godfather' });
  mockRadarr.getQueue.mockResolvedValue([]);

  await runSync();

  expect(fetchList).toHaveBeenCalledWith('https://letterboxd.com/user/list/queue');
  expect(mockRadarr.lookup).toHaveBeenCalledWith('The Godfather', 1972);
  expect(mockRadarr.add).toHaveBeenCalledWith(
    { tmdbId: 238, title: 'The Godfather', year: 1972 },
    '1',
    '/movies'
  );
  const insertCall = pool.query.mock.calls.find(c =>
    typeof c[0] === 'string' && c[0].includes('INSERT INTO movies')
  );
  expect(insertCall).toBeTruthy();
  expect(insertCall[1]).toContain(42); // radarr_id

  expect(mockRadarr.remove).not.toHaveBeenCalled();
  expect(mockPlex.refreshAndClean).not.toHaveBeenCalled();
});

test('runSync records radarr_error when lookup returns null', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: SETTINGS_ROWS })
    .mockResolvedValueOnce({ rows: [{ id: 1, url: 'https://letterboxd.com/user/list/queue' }] })
    .mockResolvedValueOnce({ rows: [] })  // not exists check
    .mockResolvedValueOnce({ rows: [] })  // INSERT with error
    .mockResolvedValueOnce({ rows: [] })  // reconcileRemovals: nothing tracked yet
    .mockResolvedValueOnce({ rows: [] })  // UPDATE last_synced_at
    .mockResolvedValueOnce({ rows: [] }); // status poll

  fetchList.mockResolvedValue([{ title: 'Unknown Film', year: 1900, slug: 'unknown-film' }]);
  mockRadarr.lookup.mockResolvedValue(null);
  mockRadarr.getQueue.mockResolvedValue([]);

  await runSync();

  const insertCall = pool.query.mock.calls.find(c =>
    typeof c[0] === 'string' && c[0].includes('INSERT INTO movies') && c[1]?.includes('No match found in Radarr')
  );
  expect(insertCall).toBeTruthy();
});

test('removes a movie no longer on the list from Radarr, disk, and the DB, then nudges Plex', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: SETTINGS_ROWS }) // settings
    .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Next in Line', url: 'https://letterboxd.com/user/list/queue' }] }) // lists
    // reconcileRemovals: DB has a movie whose slug isn't in the fresh scrape
    .mockResolvedValueOnce({ rows: [{ id: 5, letterboxd_slug: 'gone-movie', radarr_id: 7, title: 'Gone Movie' }] })
    .mockResolvedValueOnce({ rows: [] }) // DELETE FROM movies
    .mockResolvedValueOnce({ rows: [] }) // UPDATE list last_synced_at
    .mockResolvedValueOnce({ rows: [] }); // status poll (nothing left to check)

  fetchList.mockResolvedValue([]); // list is now empty
  mockRadarr.get.mockResolvedValue({ path: '/movies/Gone Movie (2020)' });
  mockRadarr.remove.mockResolvedValue();
  mockRadarr.getQueue.mockResolvedValue([]);

  await runSync();

  expect(mockRadarr.get).toHaveBeenCalledWith(7);
  expect(mockRadarr.remove).toHaveBeenCalledWith(7);
  expect(fs.rm).toHaveBeenCalledWith('/movies/Gone Movie (2020)', { recursive: true, force: true });

  const deleteCall = pool.query.mock.calls.find(c =>
    typeof c[0] === 'string' && c[0].includes('DELETE FROM movies')
  );
  expect(deleteCall).toBeTruthy();
  expect(deleteCall[1]).toEqual([5]);

  expect(mockPlex.refreshAndClean).toHaveBeenCalled();
});

test('keeps the DB row and does not delete files if Radarr is unreachable', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: SETTINGS_ROWS })
    .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Next in Line', url: 'https://letterboxd.com/user/list/queue' }] })
    .mockResolvedValueOnce({ rows: [{ id: 5, letterboxd_slug: 'gone-movie', radarr_id: 7, title: 'Gone Movie' }] })
    .mockResolvedValueOnce({ rows: [] }) // UPDATE list last_synced_at
    .mockResolvedValueOnce({ rows: [] }); // status poll

  fetchList.mockResolvedValue([]);
  mockRadarr.get.mockRejectedValue({ message: 'network error', response: undefined });
  mockRadarr.getQueue.mockResolvedValue([]);

  await runSync();

  expect(mockRadarr.remove).not.toHaveBeenCalled();
  expect(fs.rm).not.toHaveBeenCalled();
  const deleteCall = pool.query.mock.calls.find(c =>
    typeof c[0] === 'string' && c[0].includes('DELETE FROM movies')
  );
  expect(deleteCall).toBeFalsy();
  expect(mockPlex.refreshAndClean).not.toHaveBeenCalled();
});

test('still cleans up the DB row when Radarr already lost track of the movie (404)', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: SETTINGS_ROWS })
    .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Next in Line', url: 'https://letterboxd.com/user/list/queue' }] })
    .mockResolvedValueOnce({ rows: [{ id: 5, letterboxd_slug: 'gone-movie', radarr_id: 7, title: 'Gone Movie' }] })
    .mockResolvedValueOnce({ rows: [] }) // DELETE FROM movies
    .mockResolvedValueOnce({ rows: [] }) // UPDATE list last_synced_at
    .mockResolvedValueOnce({ rows: [] }); // status poll

  fetchList.mockResolvedValue([]);
  mockRadarr.get.mockRejectedValue({ message: 'not found', response: { status: 404 } });
  mockRadarr.getQueue.mockResolvedValue([]);

  await runSync();

  const deleteCall = pool.query.mock.calls.find(c =>
    typeof c[0] === 'string' && c[0].includes('DELETE FROM movies')
  );
  expect(deleteCall).toBeTruthy();
  expect(fs.rm).not.toHaveBeenCalled(); // no folder path known, nothing to clean
});
