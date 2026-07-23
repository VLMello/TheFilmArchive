const axios = require('axios');
jest.mock('axios');

const { client } = require('../qbittorrent');

let mockAxiosInstance;

beforeEach(() => {
  mockAxiosInstance = { post: jest.fn() };
  axios.create.mockReturnValue(mockAxiosInstance);
});

test('returns null when qbittorrent_url is not configured', () => {
  expect(client({})).toBeNull();
});

test('removeByHash logs in then deletes the torrent with its files', async () => {
  mockAxiosInstance.post
    .mockResolvedValueOnce({ headers: { 'set-cookie': ['SID=abc123; Path=/'] } }) // login
    .mockResolvedValueOnce({}); // delete

  const qb = client({
    qbittorrent_url: 'http://qbittorrent:8090',
    qbittorrent_username: 'admin',
    qbittorrent_password: 'pw',
  });
  await qb.removeByHash('deadbeef');

  expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(
    1,
    '/api/v2/auth/login',
    expect.any(URLSearchParams),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const deleteCall = mockAxiosInstance.post.mock.calls[1];
  expect(deleteCall[0]).toBe('/api/v2/torrents/delete');
  expect(deleteCall[1].get('hashes')).toBe('deadbeef');
  expect(deleteCall[1].get('deleteFiles')).toBe('true');
  expect(deleteCall[2].headers.Cookie).toBe('SID=abc123');
});

test('removeByHash only logs in once across multiple calls', async () => {
  mockAxiosInstance.post
    .mockResolvedValueOnce({ headers: { 'set-cookie': ['SID=abc123; Path=/'] } })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({});

  const qb = client({ qbittorrent_url: 'http://qbittorrent:8090' });
  await qb.removeByHash('hash1');
  await qb.removeByHash('hash2');

  const loginCalls = mockAxiosInstance.post.mock.calls.filter(c => c[0] === '/api/v2/auth/login');
  expect(loginCalls).toHaveLength(1);
});
