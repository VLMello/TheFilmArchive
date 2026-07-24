import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import MovieDetail from '../views/MovieDetail';
import { getMovie, getSettings } from '../api';

vi.mock('../api', () => ({
  getMovie: vi.fn(),
  getSettings: vi.fn(),
}));

const MOVIE = {
  id: 5,
  title: 'The Godfather',
  year: 1972,
  status: 'downloading',
  radarr_error: null,
  radarr_id: 1,
  tmdb_id: 238,
  letterboxd_slug: 'the-godfather',
  director: 'Francis Ford Coppola',
  genres: 'Drama, Crime',
  overview: 'The aging patriarch of an organized crime dynasty...',
  runtime: 175,
  certification: 'R',
  studio: 'Paramount Pictures',
  ratings: { imdb: { value: 9.2 }, rottenTomatoes: { value: 97 }, metacritic: { value: 100 } },
  credits: {
    cast: [
      { name: 'Marlon Brando', character: 'Vito Corleone' },
      { name: 'Al Pacino', character: 'Michael Corleone' },
    ],
    crew: [{ name: 'Mario Puzo', job: 'Screenplay' }],
  },
  size_bytes: 93_910_541_057,
  progress: 60,
  list_name: 'Next in Line',
  created_at: '2026-01-01T00:00:00Z',
  poster_url: null,
};

function renderAt(id) {
  return render(
    <MemoryRouter initialEntries={[`/movies/${id}`]}>
      <Routes>
        <Route path="/movies/:id" element={<MovieDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getSettings.mockResolvedValue({ radarr_external_url: 'http://192.168.0.154:7878' });
});

test('shows basic and medium info: director, runtime, certification, studio, ratings, overview', async () => {
  getMovie.mockResolvedValue(MOVIE);
  renderAt(5);

  expect(await screen.findByText('The Godfather')).toBeInTheDocument();
  expect(screen.getByText('Directed by Francis Ford Coppola')).toBeInTheDocument();
  expect(screen.getByText('R')).toBeInTheDocument();
  expect(screen.getByText('2h 55m')).toBeInTheDocument();
  expect(screen.getByText('Paramount Pictures')).toBeInTheDocument();
  expect(screen.getByText('IMDb 9.2')).toBeInTheDocument();
  expect(screen.getByText('RT 97%')).toBeInTheDocument();
  expect(screen.getByText('Metacritic 100%')).toBeInTheDocument();
  expect(screen.getByText(/aging patriarch/)).toBeInTheDocument();
  expect(screen.getByText('Drama')).toBeInTheDocument();
  expect(screen.getByText('Crime')).toBeInTheDocument();
});

test('shows cast and crew sections', async () => {
  getMovie.mockResolvedValue(MOVIE);
  renderAt(5);

  expect(await screen.findByText('Cast')).toBeInTheDocument();
  expect(screen.getByText(/Marlon Brando/)).toBeInTheDocument();
  expect(screen.getByText(/as Vito Corleone/)).toBeInTheDocument();
  expect(screen.getByText(/Al Pacino/)).toBeInTheDocument();

  expect(screen.getByText('Crew')).toBeInTheDocument();
  expect(screen.getByText(/Mario Puzo/)).toBeInTheDocument();
  expect(screen.getByText('Screenplay')).toBeInTheDocument();
});

test('omits cast/crew sections when there are no credits', async () => {
  getMovie.mockResolvedValue({ ...MOVIE, credits: null });
  renderAt(5);

  await screen.findByText('The Godfather');
  expect(screen.queryByText('Cast')).not.toBeInTheDocument();
  expect(screen.queryByText('Crew')).not.toBeInTheDocument();
});

test('shows progress with size while downloading', async () => {
  getMovie.mockResolvedValue(MOVIE);
  renderAt(5);

  expect(await screen.findByText(/52\.5 GB \/ 87\.5 GB \(60%\)/)).toBeInTheDocument();
});

test('has a Letterboxd button and a Radarr button pointing at the right URLs', async () => {
  getMovie.mockResolvedValue(MOVIE);
  renderAt(5);

  const letterboxdLink = (await screen.findByText('View on Letterboxd')).closest('a');
  expect(letterboxdLink).toHaveAttribute('href', 'https://letterboxd.com/film/the-godfather/');

  const radarrLink = screen.getByText('Open in Radarr').closest('a');
  expect(radarrLink).toHaveAttribute('href', 'http://192.168.0.154:7878/movie/238');
});

test('hides the Radarr button when the movie was never added to Radarr', async () => {
  getMovie.mockResolvedValue({ ...MOVIE, tmdb_id: null, radarr_id: null, radarr_error: 'No match found' });
  renderAt(5);

  await screen.findByText('The Godfather');
  expect(screen.queryByText('Open in Radarr')).not.toBeInTheDocument();
  expect(screen.getByText('View on Letterboxd')).toBeInTheDocument();
});

test('has a Plex button when the movie has a plex_url', async () => {
  getMovie.mockResolvedValue({ ...MOVIE, status: 'downloaded', plex_url: 'http://192.168.0.154:32400/web/index.html#!/server/abc123/details?key=%2Flibrary%2Fmetadata%2F141' });
  renderAt(5);

  const plexLink = (await screen.findByText('Open in Plex')).closest('a');
  expect(plexLink).toHaveAttribute('href', 'http://192.168.0.154:32400/web/index.html#!/server/abc123/details?key=%2Flibrary%2Fmetadata%2F141');
});

test('hides the Plex button when the movie has no plex_url yet', async () => {
  getMovie.mockResolvedValue({ ...MOVIE, plex_url: null });
  renderAt(5);

  await screen.findByText('The Godfather');
  expect(screen.queryByText('Open in Plex')).not.toBeInTheDocument();
});

test('shows an error banner with retry when the movie fails to load', async () => {
  getMovie.mockRejectedValueOnce(new Error('down'));
  renderAt(5);

  expect(await screen.findByText('Failed to load this movie.')).toBeInTheDocument();

  getMovie.mockResolvedValue(MOVIE);
  fireEvent.click(screen.getByText('Retry'));
  expect(await screen.findByText('The Godfather')).toBeInTheDocument();
});
