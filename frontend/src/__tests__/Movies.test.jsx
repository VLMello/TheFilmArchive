import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Movies from '../views/Movies';
import { getMovies, getLists, getSyncStatus, triggerSync, getStorage } from '../api';

vi.mock('../api', () => ({
  getMovies: vi.fn(),
  getLists: vi.fn(),
  getSyncStatus: vi.fn(),
  triggerSync: vi.fn(),
  getStorage: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});

const MOVIES = [
  { id: 1, title: 'Alien', year: 1979, status: 'downloaded', radarr_error: null, radarr_id: 101, tmdb_id: 348, director: 'Ridley Scott', list_id: 1, list_name: 'A', created_at: '2026-01-01T00:00:00Z', size_bytes: 10_000_000_000, progress: 100 },
  { id: 2, title: 'Brazil', year: 1985, status: 'pending', radarr_error: 'No match found in Radarr', list_id: 1, list_name: 'A', created_at: '2026-01-03T00:00:00Z', size_bytes: null, progress: null },
  { id: 3, title: 'Citizen Kane', year: 1941, status: 'queued', radarr_error: null, list_id: 2, list_name: 'B', created_at: '2026-01-02T00:00:00Z', size_bytes: null, progress: null },
  { id: 4, title: 'Dune', year: 2021, status: 'downloading', radarr_error: null, list_id: 1, list_name: 'A', created_at: '2026-01-04T00:00:00Z', size_bytes: 20_000_000_000, progress: 25 },
  { id: 5, title: 'Arrival', year: 2016, status: 'importing', radarr_error: null, list_id: 1, list_name: 'A', created_at: '2026-01-05T00:00:00Z', size_bytes: 8_000_000_000, progress: 40 },
];

beforeEach(() => {
  vi.clearAllMocks();
  getLists.mockResolvedValue([
    { id: 1, name: 'A', url: 'https://letterboxd.com/x/list/a/', last_synced_at: '2026-01-05T00:00:00Z' },
    { id: 2, name: 'B', url: 'https://letterboxd.com/x/list/b/', last_synced_at: null },
  ]);
  getSyncStatus.mockResolvedValue({ running: false, lastSyncedAt: null });
  getStorage.mockResolvedValue(null);
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

test('shows progress-with-size and an "importing" chip for a movie being copied into place', async () => {
  getMovies.mockResolvedValue(MOVIES);
  render(<Movies />);

  expect(await screen.findByText('3.0 GB / 7.5 GB (40%)')).toBeInTheDocument(); // Arrival, importing
  const card = (await screen.findByText('Arrival')).closest('.movie-card');
  expect(card.querySelector('.chip-importing')).toHaveTextContent('importing');
});

test('shows total storage used with no warning when plenty of space is free', async () => {
  getMovies.mockResolvedValue(MOVIES);
  getStorage.mockResolvedValue({ totalBytes: 1_000_000_000_000, usedBytes: 600_000_000_000, freeBytes: 400_000_000_000 });
  render(<Movies />);

  expect(await screen.findByText('558.8 GB / 931.3 GB used')).toBeInTheDocument();
  expect(screen.queryByText('⚠ Low disk space')).not.toBeInTheDocument();
});

test('shows a low disk space warning when free space drops under 100GB', async () => {
  getMovies.mockResolvedValue(MOVIES);
  getStorage.mockResolvedValue({ totalBytes: 1_000_000_000_000, usedBytes: 950_000_000_000, freeBytes: 50_000_000_000 });
  render(<Movies />);

  expect(await screen.findByText('⚠ Low disk space')).toBeInTheDocument();
});

test('does not render a storage bar while storage info has not loaded', async () => {
  getMovies.mockResolvedValue(MOVIES);
  getStorage.mockResolvedValue(null);
  render(<Movies />);
  await screen.findByText('Alien');

  expect(screen.queryByText(/used$/)).not.toBeInTheDocument();
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

test('clicking a card navigates to that movie\'s detail page', async () => {
  getMovies.mockResolvedValue(MOVIES);
  render(<Movies />);
  const card = (await screen.findByText('Alien')).closest('.movie-card');
  fireEvent.click(card);

  expect(mockNavigate).toHaveBeenCalledWith('/movies/1');
});

test('shows just the director\'s name on the card, no prefix', async () => {
  getMovies.mockResolvedValue(MOVIES);
  render(<Movies />);

  expect(await screen.findByText('Ridley Scott')).toBeInTheDocument();
  expect(screen.queryByText(/Directed by/)).not.toBeInTheDocument();
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
