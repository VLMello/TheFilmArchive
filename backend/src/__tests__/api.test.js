jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  migrate: jest.fn().mockResolvedValue(),
}));
jest.mock('../sync', () => ({
  runSync: jest.fn().mockResolvedValue(),
  getStatus: jest.fn(() => ({ running: false, lastSyncedAt: null })),
}));
jest.mock('../plex', () => ({ client: jest.fn() }));

const request = require('supertest');
const app = require('../index');
const { pool } = require('../db');
const { client: plexClientFactory } = require('../plex');

const mockPlex = {
  findRatingKeyByTmdbId: jest.fn(),
  getMachineIdentifier: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

test('GET /health returns ok', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
});

test('GET /api/lists returns list of lists', async () => {
  pool.query.mockResolvedValue({ rows: [{ id: 1, url: 'http://letterboxd.com/...', name: 'Queue' }] });
  const res = await request(app).get('/api/lists');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].name).toBe('Queue');
});

test('POST /api/lists creates a list', async () => {
  pool.query.mockResolvedValue({ rows: [{ id: 2, url: 'http://x.com', name: 'Test' }] });
  const res = await request(app)
    .post('/api/lists')
    .send({ url: 'http://x.com', name: 'Test' });
  expect(res.status).toBe(201);
  expect(res.body.id).toBe(2);
});

test('POST /api/lists returns 400 when url missing', async () => {
  const res = await request(app).post('/api/lists').send({ name: 'No URL' });
  expect(res.status).toBe(400);
});

test('DELETE /api/lists/:id returns 204', async () => {
  pool.query.mockResolvedValue({ rows: [] });
  const res = await request(app).delete('/api/lists/1');
  expect(res.status).toBe(204);
});

test('GET /api/sync/status returns status object', async () => {
  const res = await request(app).get('/api/sync/status');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('running');
});

test('POST /api/sync fires sync and returns 200', async () => {
  const res = await request(app).post('/api/sync');
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('sync started');
});

test('GET /api/movies/:id returns a single movie', async () => {
  pool.query.mockResolvedValue({ rows: [{ id: 5, title: 'The Godfather', list_name: 'Queue' }] });
  const res = await request(app).get('/api/movies/5');
  expect(res.status).toBe(200);
  expect(res.body.title).toBe('The Godfather');
});

test('GET /api/movies/:id returns 404 when not found', async () => {
  pool.query.mockResolvedValue({ rows: [] });
  const res = await request(app).get('/api/movies/999');
  expect(res.status).toBe(404);
});

test('GET /api/movies/:id resolves and caches a Plex deep link on first lookup', async () => {
  plexClientFactory.mockReturnValue(mockPlex);
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 5, title: 'The Godfather', status: 'downloaded', tmdb_id: 238, plex_rating_key: null }] })
    .mockResolvedValueOnce({ rows: [
      { key: 'plex_url', value: 'http://plex:32400' },
      { key: 'plex_token', value: 'tok' },
      { key: 'plex_external_url', value: 'http://192.168.0.154:32400' },
      { key: 'plex_machine_identifier', value: '' },
    ] })
    .mockResolvedValueOnce({ rows: [] }) // UPDATE movies SET plex_rating_key
    .mockResolvedValueOnce({ rows: [] }); // UPDATE settings SET value (machine identifier)

  mockPlex.findRatingKeyByTmdbId.mockResolvedValue('141');
  mockPlex.getMachineIdentifier.mockResolvedValue('abc123');

  const res = await request(app).get('/api/movies/5');

  expect(res.status).toBe(200);
  expect(mockPlex.findRatingKeyByTmdbId).toHaveBeenCalledWith(238);
  expect(res.body.plex_url).toBe('http://192.168.0.154:32400/web/index.html#!/server/abc123/details?key=%2Flibrary%2Fmetadata%2F141');

  const ratingKeyUpdate = pool.query.mock.calls.find(c => c[0].includes('plex_rating_key'));
  expect(ratingKeyUpdate[1]).toEqual(['141', 5]);
  const machineIdUpdate = pool.query.mock.calls.find(c => c[0].includes('UPDATE settings'));
  expect(machineIdUpdate[1]).toEqual(['abc123', 'plex_machine_identifier']);
});

test('GET /api/movies/:id reuses a cached plex_rating_key and machine identifier without calling Plex', async () => {
  plexClientFactory.mockReturnValue(mockPlex);
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 5, title: 'The Godfather', status: 'downloaded', tmdb_id: 238, plex_rating_key: '141' }] })
    .mockResolvedValueOnce({ rows: [
      { key: 'plex_external_url', value: 'http://192.168.0.154:32400' },
      { key: 'plex_machine_identifier', value: 'abc123' },
    ] });

  const res = await request(app).get('/api/movies/5');

  expect(res.body.plex_url).toBe('http://192.168.0.154:32400/web/index.html#!/server/abc123/details?key=%2Flibrary%2Fmetadata%2F141');
  expect(mockPlex.findRatingKeyByTmdbId).not.toHaveBeenCalled();
  expect(mockPlex.getMachineIdentifier).not.toHaveBeenCalled();
});

test('GET /api/movies/:id omits plex_url for a movie that has not finished downloading', async () => {
  pool.query.mockResolvedValueOnce({ rows: [{ id: 5, title: 'The Godfather', status: 'downloading', tmdb_id: 238 }] });

  const res = await request(app).get('/api/movies/5');

  expect(res.body.plex_url).toBeNull();
  expect(pool.query).toHaveBeenCalledTimes(1); // never even looks at settings
});

test('GET /api/movies/:id omits plex_url when plex_external_url is not configured', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 5, title: 'The Godfather', status: 'downloaded', tmdb_id: 238 }] })
    .mockResolvedValueOnce({ rows: [{ key: 'plex_url', value: 'http://plex:32400' }] });

  const res = await request(app).get('/api/movies/5');

  expect(res.body.plex_url).toBeNull();
});

test('GET /api/settings returns settings object', async () => {
  pool.query.mockResolvedValue({ rows: [{ key: 'radarr_url', value: 'http://radarr:7878' }] });
  const res = await request(app).get('/api/settings');
  expect(res.status).toBe(200);
  expect(res.body.radarr_url).toBe('http://radarr:7878');
});

test('PUT /api/settings updates and returns settings', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [] }) // UPDATE
    .mockResolvedValueOnce({ rows: [{ key: 'radarr_url', value: 'http://new:7878' }] }); // SELECT
  const res = await request(app)
    .put('/api/settings')
    .send({ radarr_url: 'http://new:7878' });
  expect(res.status).toBe(200);
  expect(res.body.radarr_url).toBe('http://new:7878');
});
