import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

// Dashboard/Movies mount as part of routing and immediately fire their own
// data-fetch effects; flush those microtasks so they don't leak into the
// next test as an unwrapped act() warning.
async function flush() {
  await act(async () => { await Promise.resolve(); });
}

vi.mock('../api', () => ({
  getLists: vi.fn().mockResolvedValue([]),
  getSyncStatus: vi.fn().mockResolvedValue({ running: false, lastSyncedAt: null }),
  getMovies: vi.fn().mockResolvedValue([]),
  triggerSync: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({}),
  updateSettings: vi.fn(),
  addList: vi.fn(),
  deleteList: vi.fn(),
}));

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>
  );
}

test('renders all nav links and the logo', async () => {
  renderApp();
  expect(screen.getByText('The Film Archive')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Movies' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  await flush();
});

test('hamburger button toggles the nav-links open class', async () => {
  renderApp();
  const toggle = screen.getByRole('button', { name: /toggle navigation menu/i });
  const links = screen.getByRole('link', { name: 'Movies' }).closest('.nav-links');

  expect(links).not.toHaveClass('open');
  fireEvent.click(toggle);
  expect(links).toHaveClass('open');
  fireEvent.click(toggle);
  expect(links).not.toHaveClass('open');
  await flush();
});

test('clicking a nav link closes the mobile menu', async () => {
  renderApp();
  const toggle = screen.getByRole('button', { name: /toggle navigation menu/i });
  const moviesLink = screen.getByRole('link', { name: 'Movies' });
  const links = moviesLink.closest('.nav-links');

  fireEvent.click(toggle);
  expect(links).toHaveClass('open');
  fireEvent.click(moviesLink);
  expect(links).not.toHaveClass('open');
  await flush();
});
