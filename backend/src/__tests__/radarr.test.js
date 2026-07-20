const axios = require('axios');
jest.mock('axios');

const { client } = require('../radarr');

const settings = {
  radarr_url: 'http://radarr:7878',
  radarr_api_key: 'testkey123',
};

let mockAxiosInstance;

beforeEach(() => {
  mockAxiosInstance = { get: jest.fn(), post: jest.fn() };
  axios.create.mockReturnValue(mockAxiosInstance);
});

test('lookup returns first TMDB result', async () => {
  mockAxiosInstance.get.mockResolvedValue({
    data: [{ tmdbId: 238, title: 'The Godfather', year: 1972 }],
  });
  const radarr = client(settings);
  const result = await radarr.lookup('The Godfather', 1972);
  expect(mockAxiosInstance.get).toHaveBeenCalledWith('/movie/lookup', {
    params: { term: 'The Godfather 1972' },
  });
  expect(result).toEqual({ tmdbId: 238, title: 'The Godfather', year: 1972 });
});

test('lookup returns null when Radarr returns empty array', async () => {
  mockAxiosInstance.get.mockResolvedValue({ data: [] });
  const radarr = client(settings);
  const result = await radarr.lookup('Nonexistent Movie', 1900);
  expect(result).toBeNull();
});

test('add posts movie and returns Radarr object with id', async () => {
  mockAxiosInstance.post.mockResolvedValue({ data: { id: 42, title: 'The Godfather' } });
  const radarr = client(settings);
  const result = await radarr.add(
    { tmdbId: 238, title: 'The Godfather', year: 1972 },
    '1',
    '/movies'
  );
  expect(mockAxiosInstance.post).toHaveBeenCalledWith('/movie', {
    title: 'The Godfather',
    year: 1972,
    tmdbId: 238,
    qualityProfileId: 1,
    rootFolderPath: '/movies',
    monitored: true,
    addOptions: { searchForMovie: true },
  });
  expect(result.id).toBe(42);
});

test('get returns movie with hasFile flag', async () => {
  mockAxiosInstance.get.mockResolvedValue({ data: { id: 42, hasFile: true, monitored: true } });
  const radarr = client(settings);
  const result = await radarr.get(42);
  expect(result.hasFile).toBe(true);
});

test('getQueue returns records array', async () => {
  mockAxiosInstance.get.mockResolvedValue({
    data: { records: [{ movieId: 42 }, { movieId: 99 }] },
  });
  const radarr = client(settings);
  const queue = await radarr.getQueue();
  expect(queue).toHaveLength(2);
  expect(queue[0].movieId).toBe(42);
});
