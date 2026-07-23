import React, { useEffect, useState, useMemo } from 'react';
import { getMovies, getLists, getSettings } from '../api';
import ErrorBanner from '../components/ErrorBanner';
import LoadingState from '../components/LoadingState';

const STATUS_OPTIONS = ['', 'pending', 'queued', 'downloading', 'downloaded'];

const SORTERS = {
  newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
  oldest: (a, b) => new Date(a.created_at) - new Date(b.created_at),
  title: (a, b) => a.title.localeCompare(b.title),
  year: (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity),
};

export default function Movies() {
  const [movies, setMovies]     = useState([]);
  const [lists, setLists]       = useState([]);
  const [radarrUrl, setRadarrUrl] = useState('');
  const [filters, setFilters]   = useState({ status: '', list_id: '' });
  const [search, setSearch]     = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [sort, setSort]         = useState('newest');
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    getLists().then(setLists).catch(() => {});
    getSettings().then(s => setRadarrUrl(s.radarr_url ?? '')).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getMovies(filters);
        if (!cancelled) { setMovies(data); setError(null); }
      } catch (e) {
        if (!cancelled) setError('Failed to load movies.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const poll = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(poll); };
  }, [filters]);

  const visible = useMemo(() => {
    let out = movies;
    const term = search.trim().toLowerCase();
    if (term) out = out.filter(m => m.title.toLowerCase().includes(term));
    if (errorsOnly) out = out.filter(m => m.radarr_error != null);
    return [...out].sort(SORTERS[sort]);
  }, [movies, search, errorsOnly, sort]);

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value }));
  }

  function retryLoad() {
    setLoading(true);
    setFilters(f => ({ ...f }));
  }

  return (
    <div className="page">
      <h1>Movies</h1>

      {error && <ErrorBanner message={error} onRetry={retryLoad} />}

      <div className="row" style={{ marginBottom: 16 }}>
        <input
          className="filter-control"
          placeholder="Search title…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-control" value={filters.status} onChange={e => setFilter('status', e.target.value)}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </select>
        <select className="filter-control" value={filters.list_id} onChange={e => setFilter('list_id', e.target.value)}>
          <option value="">All lists</option>
          {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select className="filter-control" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="title">Title (A–Z)</option>
          <option value="year">Year (newest)</option>
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.85rem', color: '#ccc' }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={errorsOnly}
            onChange={e => setErrorsOnly(e.target.checked)}
          />
          Errors only
        </label>
        <span style={{ color: '#666', fontSize: '0.85rem' }}>
          {visible.length !== movies.length ? `${visible.length} of ${movies.length} movies` : `${movies.length} movies`}
        </span>
      </div>

      {loading && movies.length === 0 ? (
        <LoadingState label="Loading movies…" />
      ) : (
        <div className="movie-grid">
          {visible.map(m => (
            <div
              key={m.id}
              className="movie-card"
              style={{ cursor: m.radarr_id && radarrUrl ? 'pointer' : 'default' }}
              onClick={() => {
                if (m.radarr_id && radarrUrl) {
                  window.open(`${radarrUrl}/movie/${m.radarr_id}`, '_blank');
                }
              }}
            >
              <div className="movie-poster">
                {m.poster_url
                  ? <img src={m.poster_url} alt={m.title} loading="lazy" />
                  : <div className="movie-poster-placeholder">{m.title[0]}</div>}
              </div>

              <div className="movie-body">
                <div className="movie-title-row">
                  <span className="movie-title">{m.title}</span>
                  <span className="movie-year">{m.year ?? '—'}</span>
                </div>

                <div className="row" style={{ margin: '6px 0' }}>
                  <span className={`chip chip-${m.radarr_error ? 'error' : m.status}`}>
                    {m.radarr_error ? 'error' : m.status}
                  </span>
                  <span style={{ color: '#666', fontSize: '0.8rem' }}>{m.list_name}</span>
                </div>

                {m.status === 'downloading' && m.progress != null && (
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${m.progress}%` }} />
                    <span className="progress-label">{m.progress}%</span>
                  </div>
                )}

                {m.genres && (
                  <div className="genre-row">
                    {m.genres.split(', ').map(g => (
                      <span key={g} className="genre-chip">{g}</span>
                    ))}
                  </div>
                )}

                {m.overview && <p className="movie-overview">{m.overview}</p>}

                {m.radarr_error && (
                  <p className="error-text" style={{ marginTop: 6 }}>⚠ {m.radarr_error}</p>
                )}

                <div className="movie-added">
                  Added {new Date(m.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
          {visible.length === 0 && (
            <p style={{ color: '#555', textAlign: 'center', padding: 32 }}>No movies match.</p>
          )}
        </div>
      )}
    </div>
  );
}
