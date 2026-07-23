import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Settings from '../views/Settings';
import { getLists, addList, deleteList, getSettings, updateSettings } from '../api';

vi.mock('../api', () => ({
  getLists: vi.fn(),
  addList: vi.fn(),
  deleteList: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getLists.mockResolvedValue([{ id: 1, name: 'Next in Line', url: 'https://letterboxd.com/x/list/y/' }]);
  getSettings.mockResolvedValue({ radarr_url: 'http://localhost:7878' });
});

afterEach(() => {
  vi.useRealTimers();
});

test('renders the Radarr/Prowlarr/Plex sub-section headings and their fields', async () => {
  render(<Settings />);
  expect(await screen.findByText('Radarr')).toBeInTheDocument();
  expect(screen.getByText('Prowlarr')).toBeInTheDocument();
  expect(screen.getByText('Plex')).toBeInTheDocument();
  expect(screen.getByText('Radarr URL')).toBeInTheDocument();
  expect(screen.getByText('Prowlarr API Key')).toBeInTheDocument();
  expect(screen.getByText('Plex Movies Path')).toBeInTheDocument();
});

test('adding a list appends the new row and clears the form on success', async () => {
  addList.mockResolvedValue({ id: 2, name: 'New List', url: 'https://letterboxd.com/x/list/new/' });
  render(<Settings />);
  await screen.findByText('Next in Line');

  fireEvent.change(screen.getByPlaceholderText('https://letterboxd.com/user/list/my-list/'), {
    target: { value: 'https://letterboxd.com/x/list/new/' },
  });
  fireEvent.change(screen.getByPlaceholderText('List name'), { target: { value: 'New List' } });
  fireEvent.click(screen.getByText('Add'));

  expect(await screen.findByText('New List')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('List name')).toHaveValue('');
});

test('adding a list shows an error on failure', async () => {
  addList.mockRejectedValue(new Error('bad url'));
  render(<Settings />);
  await screen.findByText('Next in Line');

  fireEvent.change(screen.getByPlaceholderText('https://letterboxd.com/user/list/my-list/'), {
    target: { value: 'not-a-url' },
  });
  fireEvent.change(screen.getByPlaceholderText('List name'), { target: { value: 'Bad' } });
  fireEvent.click(screen.getByText('Add'));

  expect(await screen.findByText('Failed to add list — check the URL')).toBeInTheDocument();
});

test('removing a list removes the row on success', async () => {
  deleteList.mockResolvedValue(undefined);
  render(<Settings />);
  await screen.findByText('Next in Line');

  fireEvent.click(screen.getByText('Remove'));

  await waitFor(() => expect(screen.queryByText('Next in Line')).not.toBeInTheDocument());
});

test('removing a list keeps the row and shows an error on failure', async () => {
  deleteList.mockRejectedValue(new Error('failed'));
  render(<Settings />);
  await screen.findByText('Next in Line');

  fireEvent.click(screen.getByText('Remove'));

  expect(await screen.findByText('Failed to remove list.')).toBeInTheDocument();
  expect(screen.getByText('Next in Line')).toBeInTheDocument();
});

test('saving settings shows a confirmation that reverts after a timeout', async () => {
  updateSettings.mockResolvedValue({ radarr_url: 'http://localhost:7878' });
  render(<Settings />);
  await screen.findByText('Radarr');

  vi.useFakeTimers();

  fireEvent.click(screen.getByText('Save Settings'));
  await act(() => vi.advanceTimersByTimeAsync(0)); // flush the `await updateSettings()` microtask
  expect(screen.getByText('Saved ✓')).toBeInTheDocument();

  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByText('Save Settings')).toBeInTheDocument();
});

test('saving settings shows an error and keeps prior settings on failure', async () => {
  updateSettings.mockRejectedValue(new Error('bad request'));
  render(<Settings />);
  await screen.findByText('Radarr');

  fireEvent.click(screen.getByText('Save Settings'));

  expect(await screen.findByText('Failed to save settings.')).toBeInTheDocument();
  expect(screen.getByText('Save Settings')).toBeInTheDocument();
  expect(screen.queryByText('Saved ✓')).not.toBeInTheDocument();
});
