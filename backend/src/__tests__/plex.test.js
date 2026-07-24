const axios = require('axios');
jest.mock('axios');

const { client } = require('../plex');

let mockAxiosInstance;

beforeEach(() => {
  mockAxiosInstance = { get: jest.fn(), put: jest.fn() };
  axios.create.mockReturnValue(mockAxiosInstance);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test('returns null when plex_url or plex_token are not configured', () => {
  expect(client({})).toBeNull();
  expect(client({ plex_url: 'http://plex:32400' })).toBeNull();
  expect(client({ plex_token: 'abc' })).toBeNull();
});

test('getMovieSectionKey finds the movie-type library section', async () => {
  mockAxiosInstance.get.mockResolvedValue({
    data: { MediaContainer: { Directory: [
      { type: 'show', key: '2' },
      { type: 'movie', key: '1' },
    ] } },
  });
  const plex = client({ plex_url: 'http://plex:32400', plex_token: 'tok' });
  const key = await plex.getMovieSectionKey();
  expect(key).toBe('1');
  expect(mockAxiosInstance.get).toHaveBeenCalledWith('/library/sections', {
    params: { 'X-Plex-Token': 'tok' },
    headers: { Accept: 'application/json' },
  });
});

test('refreshAndClean refreshes the section then empties trash via PUT', async () => {
  mockAxiosInstance.get
    .mockResolvedValueOnce({ data: { MediaContainer: { Directory: [{ type: 'movie', key: '1' }] } } })
    .mockResolvedValueOnce({}); // refresh
  mockAxiosInstance.put.mockResolvedValueOnce({}); // emptyTrash

  const plex = client({ plex_url: 'http://plex:32400', plex_token: 'tok' });
  const promise = plex.refreshAndClean();
  await jest.advanceTimersByTimeAsync(3000);
  await promise;

  expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(2, '/library/sections/1/refresh', {
    params: { 'X-Plex-Token': 'tok' },
  });
  // Newer Plex Media Server rejects a GET here with a 404 — must be PUT.
  expect(mockAxiosInstance.put).toHaveBeenCalledWith('/library/sections/1/emptyTrash', null, {
    params: { 'X-Plex-Token': 'tok' },
  });
});

test('refresh scans the section without touching trash', async () => {
  mockAxiosInstance.get
    .mockResolvedValueOnce({ data: { MediaContainer: { Directory: [{ type: 'movie', key: '1' }] } } })
    .mockResolvedValueOnce({}); // refresh

  const plex = client({ plex_url: 'http://plex:32400', plex_token: 'tok' });
  await plex.refresh();

  expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(2, '/library/sections/1/refresh', {
    params: { 'X-Plex-Token': 'tok' },
  });
  expect(mockAxiosInstance.put).not.toHaveBeenCalled();
});

test('refreshAndClean does nothing if no movie section is found', async () => {
  mockAxiosInstance.get.mockResolvedValue({ data: { MediaContainer: { Directory: [] } } });
  const plex = client({ plex_url: 'http://plex:32400', plex_token: 'tok' });
  await plex.refreshAndClean();
  expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1); // only the sections lookup
});
