import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Movies from '../views/Movies';
import { getMovies, getLists, getSettings, getSyncStatus, triggerSync } from '../api';

vi.mock('../api', () => ({
  getMovies: vi.fn(),
  getLists: vi.fn(),
  getSettings: vi.fn(),
  getSyncStatus: vi.fn(),
  triggerSync: vi.fn(),
}));

const MOVIES = [
  { id: 1, title: 'Alien', year: 1979, status: 'downloaded', radarr_error: null, radarr_id: 101, tmdb_id: 348, list_id: 1, list_name: 'A', created_at: '2026-01-01T00:00:00Z', size_bytes: 10_000_000_000, progress: 100 },
  { id: 2, title: 'Brazil', year: 1985, status: 'pending', radarr_error: 'No match found in Radarr', list_id: 1, list_name: 'A', created_at: '2026-01-03T00:00:00Z', size_bytes: null, progress: null },
  { id: 3, title: 'Citizen Kane', year: 1941, status: 'queued', radarr_error: null, list_id: 2, list_name: 'B', created_at: '2026-01-02T00:00:00Z', size_bytes: null, progress: null },
  { id: 4, title: 'Dune', year: 2021, status: 'downloading', radarr_error: null, list_id: 1, list_name: 'A', created_at: '2026-01-04T00:00:00Z', size_bytes: 20_000_000_000, progress: 25 },
];

beforeEach(() => {
  vi.clearAllMocks();
  getLists.mockResolvedValue([
    { id: 1, name: 'A', url: 'https://letterboxd.com/x/list/a/', last_synced_at: '2026-01-05T00:00:00Z' },
    { id: 2, name: 'B', url: 'https://letterboxd.com/x/list/b/', last_synced_at: null },
  ]);
  getSettings.mockResolvedValue({});
  getSyncStatus.mockResolvedValue({ running: false, lastSyncedAt: null });
});

afterEach(() => {
  vi.useRealTimers();
});

test('shows a loading state only on the first fetch, not subsequent polls', async () => {
  vi.useFakeTimers();
  getMovies.mockResolvedValue(MOVIES);

  render(<Movies />);
  expect(screen.getByText('Loading…')).toBeInTheDocument();

  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.queryByText('Loading…')).not.toBeInTheDocument();

  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  expect(getMovies).toHaveBeenCalledTimes(2);
});

test('clicking a status count chip filters the grid, click again clears it', async () => {
  getMovies.mockResolvedValue(MOVIES);
  render(<Movies />);
  await screen.findByText('Alien');

  fireEvent.click(screen.getByTitle('Show only downloaded movies'));
  expect(screen.getByText('Alien')).toBeInTheDocument();
  expect(screen.queryByText('Brazil')).not.toBeInTheDocument();
  expect(screen.queryByText('Dune')).not.toBeInTheDocument();

  fireEvent.click(screen.getByTitle('Show only downloaded movies'));
  expect(screen.getByText('Dune')).toBeInTheDocument();
});

test('list dropdown filters the grid client-side', async () => {
  getMovies.mockResolvedValue(MOVIES);
  render(<Movies />);
  await screen.findByText('Alien');

  fireEvent.change(screen.getByDisplayValue('All lists'), { target: { value: '2' } });

  expect(await screen.findByText('Citizen Kane')).toBeInTheDocument();
  expect(screen.queryByText('Alien')).not.toBeInTheDocument();
});

test('the list dropdown surfaces last-synced as an option tooltip', async () => {
  getMovies.mockResolvedValue(MOVIES);
  render(<Movies />);
  await screen.findByText('Alien');

  const optionA = screen.getByRole('option', { name: 'A' });
  expect(optionA).toHaveAttribute('title', expect.stringContaining('Last synced:'));
  const optionB = screen.getByRole('option', { name: 'B' });
  expect(optionB).toHaveAttribute('title', expect.stringContaining('Never'));
});

test('search filters client-side without an extra getMovies call', async () => {
  getMovies.mockResolvedValue(MOVIES);
  render(<Movies />);
  await screen.findByText('Alien');

  const callsBefore = getMovies.mock.calls.length;
  fireEvent.change(screen.getByPlaceholderText('Search title…'), { target: { value: 'bra' } });

  expect(await screen.findByText('Brazil')).toBeInTheDocument();
  expect(screen.queryByText('Alien')).not.toBeInTheDocument();
  expect(getMovies).toHaveBeenCalledTimes(callsBefore);
});

test('errors-only toggle narrows to movies with a radarr_error', async () => {
  getMovies.mockResolvedValue(MOVIES);
  render(<Movies />);
  await screen.findByText('Alien');

  fireEvent.click(screen.getByLabelText('Errors only'));

  expect(await screen.findByText('Brazil')).toBeInTheDocument();
  expect(screen.queryByText('Alien')).not.toBeInTheDocument();
});

test('changing sort reorders the rendered movie titles', async () => {
  getMovies.mockResolvedValue(MOVIES);
  render(<Movies />);
  await screen.findByText('Alien');

  fireEvent.change(screen.getByDisplayValue('Newest first'), { target: { value: 'title' } });

  await waitFor(() => {
    const titles = screen.getAllByText(/^(Alien|Brazil|Citizen Kane|Dune)$/).map(el => el.textContent);
    expect(titles).toEqual(['Alien', 'Brazil', 'Citizen Kane', 'Dune']);
  });
});

test('shows file size for a downloaded movie and progress-with-size for a downloading one', async () => {
  getMovies.mockResolvedValue(MOVIES);
  render(<Movies />);

  expect(await screen.findByText('9.3 GB')).toBeInTheDocument(); // Alien, downloaded, 10_000_000_000 bytes
  expect(await screen.findByText('4.7 GB / 18.6 GB (25%)')).toBeInTheDocument(); // Dune, downloading
});

test('Sync Now polls status until running is false, then stops', async () => {
  getMovies.mockResolvedValue(MOVIES);
  getSyncStatus
    .mockResolvedValueOnce({ running: false, lastSyncedAt: null }) // initial load
    .mockResolvedValueOnce({ running: true, lastSyncedAt: null })  // first poll
    .mockResolvedValueOnce({ running: false, lastSyncedAt: '2026-01-01T00:00:00Z' }) // second poll: done
    .mockResolvedValue({ running: false, lastSyncedAt: '2026-01-01T00:00:00Z' });
  triggerSync.mockResolvedValue({ message: 'sync started' });

  render(<Movies />);
  await screen.findByText('Sync Now');

  vi.useFakeTimers();

  fireEvent.click(screen.getByText('Sync Now'));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(triggerSync).toHaveBeenCalled();

  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByText('Syncing…')).toBeInTheDocument();

  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByText('Sync Now')).toBeInTheDocument();

  const callsAfterDone = getSyncStatus.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(4000));
  expect(getSyncStatus.mock.calls.length).toBe(callsAfterDone);
});

test('clicking a card opens the browser-accessible Radarr URL by tmdbId, not the internal DB id', async () => {
  getMovies.mockResolvedValue(MOVIES);
  getSettings.mockResolvedValue({
    radarr_url: 'http://radarr:7878', // internal Docker hostname — not resolvable by a browser
    radarr_external_url: 'http://192.168.0.154:7878',
  });
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {});

  render(<Movies />);
  const card = (await screen.findByText('Alien')).closest('.movie-card');
  fireEvent.click(card);

  // Radarr's web UI routes by titleSlug (== tmdbId), not its internal id (101).
  expect(openSpy).toHaveBeenCalledWith('http://192.168.0.154:7878/movie/348', '_blank');
  openSpy.mockRestore();
});

test('shows an error banner when fetching movies fails', async () => {
  getMovies.mockRejectedValue(new Error('down'));
  render(<Movies />);
  expect(await screen.findByText('Failed to load movies.')).toBeInTheDocument();
});

test('clears the poll interval on unmount', async () => {
  vi.useFakeTimers();
  getMovies.mockResolvedValue(MOVIES);
  const { unmount } = render(<Movies />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(getMovies).toHaveBeenCalledTimes(1);

  unmount();
  await vi.advanceTimersByTimeAsync(30000);
  expect(getMovies).toHaveBeenCalledTimes(1);
});
