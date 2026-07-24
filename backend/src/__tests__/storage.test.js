jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  migrate: jest.fn().mockResolvedValue(),
}));
jest.mock('../sync', () => ({
  runSync: jest.fn().mockResolvedValue(),
  refreshStatuses: jest.fn().mockResolvedValue(),
  getStatus: jest.fn(() => ({ running: false, lastSyncedAt: null })),
}));
jest.mock('fs/promises', () => ({ statfs: jest.fn() }));

const request = require('supertest');
const app = require('../index');
const fs = require('fs/promises');

beforeEach(() => jest.clearAllMocks());

test('GET /api/storage reports total/used/free bytes from the /data mount', async () => {
  fs.statfs.mockResolvedValue({ bsize: 4096, blocks: 1000, bfree: 300, bavail: 250 });

  const res = await request(app).get('/api/storage');

  expect(fs.statfs).toHaveBeenCalledWith('/data');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    totalBytes: 1000 * 4096,
    usedBytes: (1000 - 300) * 4096,
    freeBytes: 250 * 4096,
  });
});

test('GET /api/storage returns 500 if the mount is unreadable', async () => {
  fs.statfs.mockRejectedValue(new Error('ENOENT'));

  const res = await request(app).get('/api/storage');

  expect(res.status).toBe(500);
});
