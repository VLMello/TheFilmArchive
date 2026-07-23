import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Dashboard from '../views/Dashboard';
import { getLists, getSyncStatus, triggerSync, getMovies } from '../api';

vi.mock('../api', () => ({
  getLists: vi.fn(),
  getSyncStatus: vi.fn(),
  triggerSync: vi.fn(),
  getMovies: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

test('shows a loading state before the initial data resolves', () => {
  getLists.mockReturnValue(new Promise(() => {}));
  getSyncStatus.mockReturnValue(new Promise(() => {}));
  getMovies.mockReturnValue(new Promise(() => {}));

  render(<Dashboard />);
  expect(screen.getByText('Loading dashboard…')).toBeInTheDocument();
});

test('renders status counts and configured lists once data resolves', async () => {
  getLists.mockResolvedValue([
    { id: 1, name: 'Next in Line', url: 'https://letterboxd.com/x/list/y/', last_synced_at: null },
  ]);
  getSyncStatus.mockResolvedValue({ running: false, lastSyncedAt: null });
  getMovies.mockResolvedValue([
    { status: 'queued' }, { status: 'queued' }, { status: 'downloading' },
  ]);

  render(<Dashboard />);

  expect(await screen.findByText('Next in Line')).toBeInTheDocument();
  const queuedChip = screen.getByText('queued').closest('span');
  expect(queuedChip.parentElement).toHaveTextContent('queued 2');
});

test('Sync Now polls status until running is false, then stops', async () => {
  getLists.mockResolvedValue([]);
  getMovies.mockResolvedValue([]);
  getSyncStatus
    .mockResolvedValueOnce({ running: false, lastSyncedAt: null }) // initial load
    .mockResolvedValueOnce({ running: true, lastSyncedAt: null })  // first poll
    .mockResolvedValueOnce({ running: false, lastSyncedAt: '2026-01-01T00:00:00Z' }) // second poll: done
    .mockResolvedValue({ running: false, lastSyncedAt: '2026-01-01T00:00:00Z' }); // steady state after
  triggerSync.mockResolvedValue({ message: 'sync started' });

  render(<Dashboard />);
  await screen.findByText('Sync Now');

  // Fake timers only from here on, so the RTL findBy above could poll with real timers.
  vi.useFakeTimers();

  fireEvent.click(screen.getByText('Sync Now'));
  await act(() => vi.advanceTimersByTimeAsync(0)); // flush the `await triggerSync()` microtask
  expect(triggerSync).toHaveBeenCalled();

  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByText('Syncing…')).toBeInTheDocument(); // still running after 1st poll

  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByText('Sync Now')).toBeInTheDocument(); // 2nd poll reports done, button reverts

  const callsAfterDone = getSyncStatus.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(4000));
  expect(getSyncStatus.mock.calls.length).toBe(callsAfterDone); // no further polling
});

test('shows an error banner with a working retry when the initial load fails', async () => {
  getLists.mockRejectedValueOnce(new Error('network down'));
  getSyncStatus.mockRejectedValueOnce(new Error('network down'));
  getMovies.mockRejectedValueOnce(new Error('network down'));

  render(<Dashboard />);
  expect(await screen.findByText('Failed to load dashboard data.')).toBeInTheDocument();

  getLists.mockResolvedValue([]);
  getSyncStatus.mockResolvedValue({ running: false, lastSyncedAt: null });
  getMovies.mockResolvedValue([]);

  fireEvent.click(screen.getByText('Retry'));
  await waitFor(() => expect(screen.queryByText('Failed to load dashboard data.')).not.toBeInTheDocument());
});
