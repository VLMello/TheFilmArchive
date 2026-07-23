import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Movies from '../views/Movies';
import { getMovies, getLists, getSettings } from '../api';

vi.mock('../api', () => ({
  getMovies: vi.fn(),
  getLists: vi.fn(),
  getSettings: vi.fn(),
}));

const MOVIES = [
  { id: 1, title: 'Alien', year: 1979, status: 'downloaded', radarr_error: null, list_name: 'A', created_at: '2026-01-01T00:00:00Z' },
  { id: 2, title: 'Brazil', year: 1985, status: 'pending', radarr_error: 'No match found in Radarr', list_name: 'A', created_at: '2026-01-03T00:00:00Z' },
  { id: 3, title: 'Citizen Kane', year: 1941, status: 'queued', radarr_error: null, list_name: 'A', created_at: '2026-01-02T00:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  getLists.mockResolvedValue([]);
  getSettings.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

test('shows a loading state only on the first fetch, not subsequent polls', async () => {
  vi.useFakeTimers();
  getMovies.mockResolvedValue(MOVIES);

  render(<Movies />);
  expect(screen.getByText('Loading movies…')).toBeInTheDocument();

  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.queryByText('Loading movies…')).not.toBeInTheDocument();

  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(screen.queryByText('Loading movies…')).not.toBeInTheDocument();
  expect(getMovies).toHaveBeenCalledTimes(2);
});

test('changing the status filter triggers a new server-side getMovies call', async () => {
  getMovies.mockResolvedValue(MOVIES);
  render(<Movies />);
  await screen.findByText('Alien');

  fireEvent.change(screen.getByDisplayValue('All statuses'), { target: { value: 'queued' } });

  await waitFor(() =>
    expect(getMovies).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'queued' }))
  );
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
  expect(screen.queryByText('Citizen Kane')).not.toBeInTheDocument();
});

test('changing sort reorders the rendered movie titles', async () => {
  getMovies.mockResolvedValue(MOVIES);
  render(<Movies />);
  await screen.findByText('Alien');

  fireEvent.change(screen.getByDisplayValue('Newest first'), { target: { value: 'title' } });

  await waitFor(() => {
    const titles = screen.getAllByText(/Alien|Brazil|Citizen Kane/).map(el => el.textContent);
    expect(titles).toEqual(['Alien', 'Brazil', 'Citizen Kane']);
  });
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
