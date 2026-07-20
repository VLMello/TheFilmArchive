jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  migrate: jest.fn().mockResolvedValue(),
}));
jest.mock('../sync', () => ({
  runSync: jest.fn().mockResolvedValue(),
  getStatus: jest.fn(() => ({ running: false, lastSyncedAt: null })),
}));

const request = require('supertest');
const app = require('../index');
const { pool } = require('../db');

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
