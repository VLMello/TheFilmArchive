jest.mock('../db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../letterboxd', () => ({ fetchList: jest.fn() }));
jest.mock('../radarr', () => ({ client: jest.fn() }));

const { pool } = require('../db');
const { fetchList } = require('../letterboxd');
const { client: radarrClientFactory } = require('../radarr');
const { runSync, getStatus } = require('../sync');

const mockRadarr = {
  lookup: jest.fn(),
  add: jest.fn(),
  get: jest.fn(),
  getQueue: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  radarrClientFactory.mockReturnValue(mockRadarr);
});

test('getStatus returns not running initially', () => {
  const status = getStatus();
  expect(status.running).toBe(false);
  expect(status.lastSyncedAt).toBeNull();
});

test('runSync adds new movie to Radarr and sets status queued', async () => {
  // Settings query
  pool.query
    .mockResolvedValueOnce({ rows: [
      { key: 'radarr_url', value: 'http://radarr:7878' },
      { key: 'radarr_api_key', value: 'key' },
      { key: 'radarr_quality_profile_id', value: '1' },
      { key: 'radarr_root_folder_path', value: '/movies' },
    ]})
    // Lists query
    .mockResolvedValueOnce({ rows: [{ id: 1, url: 'https://letterboxd.com/user/list/queue' }] })
    // Movie already exists check → not found
    .mockResolvedValueOnce({ rows: [] })
    // INSERT movie
    .mockResolvedValueOnce({ rows: [] })
    // UPDATE list last_synced_at
    .mockResolvedValueOnce({ rows: [] })
    // Non-downloaded movies for status update
    .mockResolvedValueOnce({ rows: [] });

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
  // Verify INSERT called with status queued and radarr_id 42
  const insertCall = pool.query.mock.calls.find(c =>
    typeof c[0] === 'string' && c[0].includes('INSERT INTO movies')
  );
  expect(insertCall).toBeTruthy();
  expect(insertCall[1]).toContain(42); // radarr_id
});

test('runSync records radarr_error when lookup returns null', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [
      { key: 'radarr_url', value: 'http://radarr:7878' },
      { key: 'radarr_api_key', value: 'key' },
      { key: 'radarr_quality_profile_id', value: '1' },
      { key: 'radarr_root_folder_path', value: '/movies' },
    ]})
    .mockResolvedValueOnce({ rows: [{ id: 1, url: 'https://letterboxd.com/user/list/queue' }] })
    .mockResolvedValueOnce({ rows: [] })  // not exists check
    .mockResolvedValueOnce({ rows: [] })  // INSERT with error
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
