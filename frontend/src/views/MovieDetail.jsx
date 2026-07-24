import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getMovie, getSettings } from '../api';
import ErrorBanner from '../components/ErrorBanner';
import LoadingState from '../components/LoadingState';
import { formatBytes, formatRuntime } from '../format';

export default function MovieDetail() {
  const { id } = useParams();
  const [movie, setMovie] = useState(null);
  const [radarrUrl, setRadarrUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function load() {
    setLoading(true);
    Promise.all([getMovie(id), getSettings()])
      .then(([m, s]) => {
        setMovie(m);
        setRadarrUrl(s.radarr_external_url ?? '');
        setError(null);
      })
      .catch(() => setError('Failed to load this movie.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  if (loading) {
    return (
      <div className="page">
        <LoadingState label="Loading…" />
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="page">
        <Link to="/movies">&larr; Back to Movies</Link>
        <ErrorBanner message={error ?? 'Movie not found.'} onRetry={load} />
      </div>
    );
  }

  const totalBytes = movie.size_bytes;
  const doneBytes = totalBytes != null && movie.progress != null ? totalBytes * (movie.progress / 100) : null;
  const ratings = movie.ratings ?? {};
  const letterboxdUrl = `https://letterboxd.com/film/${movie.letterboxd_slug}/`;
  const radarrLinkUrl = movie.tmdb_id && radarrUrl ? `${radarrUrl}/movie/${movie.tmdb_id}` : null;

  return (
    <div className="page">
      <Link to="/movies">&larr; Back to Movies</Link>

      <div className="detail-layout">
        <div className="detail-poster">
          {movie.poster_url
            ? <img src={movie.poster_url} alt={movie.title} />
            : <div className="movie-poster-placeholder">{movie.title[0]}</div>}
        </div>

        <div className="detail-body">
          <h1>{movie.title} <span className="movie-year">{movie.year ?? ''}</span></h1>

          {movie.director && <p className="detail-director">Directed by {movie.director}</p>}

          <div className="row detail-meta">
            {movie.certification && <span className="chip">{movie.certification}</span>}
            {formatRuntime(movie.runtime) && <span>{formatRuntime(movie.runtime)}</span>}
            {movie.studio && <span>{movie.studio}</span>}
          </div>

          <div className="row" style={{ margin: '10px 0' }}>
            <span className={`chip chip-${movie.radarr_error ? 'error' : movie.status}`}>
              {movie.radarr_error ? 'error' : movie.status}
            </span>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{movie.list_name}</span>
          </div>

          {(movie.status === 'downloading' || movie.status === 'importing') && movie.progress != null && (
            <div className="progress-bar" style={{ maxWidth: 320 }}>
              <div className="progress-fill" style={{ width: `${movie.progress}%` }} />
              <span className="progress-label">
                {totalBytes != null
                  ? `${formatBytes(doneBytes)} / ${formatBytes(totalBytes)} (${movie.progress}%)`
                  : `${movie.progress}%`}
              </span>
            </div>
          )}
          {movie.status !== 'downloading' && movie.status !== 'importing' && totalBytes != null && (
            <div className="movie-stat-row">{formatBytes(totalBytes)}</div>
          )}

          {movie.radarr_error && <p className="error-text" style={{ marginTop: 6 }}>⚠ {movie.radarr_error}</p>}

          {movie.genres && (
            <div className="genre-row">
              {movie.genres.split(', ').map(g => <span key={g} className="genre-chip">{g}</span>)}
            </div>
          )}

          {(ratings.imdb?.value || ratings.rottenTomatoes?.value || ratings.metacritic?.value) && (
            <div className="row detail-ratings">
              {ratings.imdb?.value && <span>IMDb {ratings.imdb.value}</span>}
              {ratings.rottenTomatoes?.value && <span>RT {ratings.rottenTomatoes.value}%</span>}
              {ratings.metacritic?.value && <span>Metacritic {ratings.metacritic.value}%</span>}
            </div>
          )}

          {movie.overview && <p className="detail-overview">{movie.overview}</p>}

          {movie.credits?.cast?.length > 0 && (
            <>
              <h2 className="detail-section-heading">Cast</h2>
              <div className="credits-list">
                {movie.credits.cast.map((c, i) => (
                  <span key={`${c.name}-${i}`} className="credit-chip">
                    {c.name}{c.character && <span className="credit-role"> as {c.character}</span>}
                  </span>
                ))}
              </div>
            </>
          )}

          {movie.credits?.crew?.length > 0 && (
            <>
              <h2 className="detail-section-heading">Crew</h2>
              <div className="credits-list">
                {movie.credits.crew.map((c, i) => (
                  <span key={`${c.name}-${i}`} className="credit-chip">
                    <span className="credit-role">{c.job}</span> {c.name}
                  </span>
                ))}
              </div>
            </>
          )}

          <div className="row detail-actions">
            <a href={letterboxdUrl} target="_blank" rel="noreferrer">
              <button>View on Letterboxd</button>
            </a>
            {radarrLinkUrl && (
              <a href={radarrLinkUrl} target="_blank" rel="noreferrer">
                <button>Open in Radarr</button>
              </a>
            )}
            {movie.plex_url && (
              <a href={movie.plex_url} target="_blank" rel="noreferrer">
                <button>Open in Plex</button>
              </a>
            )}
          </div>

          <div className="movie-added">Added {new Date(movie.created_at).toLocaleDateString()}</div>
        </div>
      </div>
    </div>
  );
}
