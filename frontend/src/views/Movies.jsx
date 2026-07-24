import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMovies, getLists, getSyncStatus, triggerSync } from '../api';
import ErrorBanner from '../components/ErrorBanner';
import LoadingState from '../components/LoadingState';
import { formatBytes } from '../format';

const STATUS_OPTIONS = ['', 'pending', 'queued', 'downloading', 'importing', 'downloaded'];
const STATUSES = ['pending', 'queued', 'downloading', 'importing', 'downloaded'];

const SORTERS = {
  newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
  oldest: (a, b) => new Date(a.created_at) - new Date(b.created_at),
  title: (a, b) => a.title.localeCompare(b.title),
  year: (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity),
};

export default function Movies() {
  const navigate = useNavigate();
  const [movies, setMovies]     = useState([]);
  const [lists, setLists]       = useState([]);
  const [status, setStatus]     = useState('');
  const [listId, setListId]     = useState('');
  const [search, setSearch]     = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [sort, setSort]         = useState('newest');
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const [syncStatus, setSyncStatus] = useState({ running: false, lastSyncedAt: null });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  useEffect(() => {
    getLists().then(setLists).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [movieData, statusData] = await Promise.all([getMovies(), getSyncStatus()]);
        if (!cancelled) {
          setMovies(movieData);
          setSyncStatus(statusData);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError('Failed to load movies.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const poll = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(poll); };
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      await triggerSync();
    } catch (e) {
      setSyncing(false);
      setSyncError('Failed to start sync.');
      return;
    }
    const poll = setInterval(async () => {
      try {
        const s = await getSyncStatus();
        setSyncStatus(s);
        if (!s.running) {
          clearInterval(poll);
          setSyncing(false);
          getMovies().then(setMovies).catch(() => {});
        }
      } catch (e) {
        clearInterval(poll);
        setSyncing(false);
        setSyncError('Failed to check sync status.');
      }
    }, 2000);
  }

  const counts = useMemo(() => {
    const c = {};
    for (const m of movies) c[m.status] = (c[m.status] ?? 0) + 1;
    return c;
  }, [movies]);

  const toggleStatusFilter = useCallback(s => {
    setStatus(cur => (cur === s ? '' : s));
  }, []);

  const visible = useMemo(() => {
    let out = movies;
    if (status) out = out.filter(m => m.status === status);
    if (listId) out = out.filter(m => String(m.list_id) === String(listId));
    const term = search.trim().toLowerCase();
    if (term) out = out.filter(m => m.title.toLowerCase().includes(term));
    if (errorsOnly) out = out.filter(m => m.radarr_error != null);
    return [...out].sort(SORTERS[sort]);
  }, [movies, status, listId, search, errorsOnly, sort]);

  function retryLoad() {
    setLoading(true);
    getMovies().then(setMovies).then(() => setError(null)).catch(() => setError('Failed to load movies.')).finally(() => setLoading(false));
  }

  if (loading) {
    return (
      <div className="page">
        <h1>Movies</h1>
        <LoadingState label="Loading…" />
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Movies</h1>

      {error && <ErrorBanner message={error} onRetry={retryLoad} />}
      {syncError && <ErrorBanner message={syncError} onDismiss={() => setSyncError(null)} />}

      <div className="card">
        <div className="row">
          <span style={{ color: 'var(--text-faint)', fontSize: 'var(--font-sm)' }}>
            Last sync: {syncStatus.lastSyncedAt ? new Date(syncStatus.lastSyncedAt).toLocaleString() : 'Never'}
          </span>
          <button onClick={handleSync} disabled={syncing || syncStatus.running}>
            {syncing || syncStatus.running ? 'Syncing…' : 'Sync Now'}
          </button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
            {STATUSES.map(s => (
              <button
                key={s}
                className={`chip-button${status === s ? ' active' : ''}`}
                onClick={() => toggleStatusFilter(s)}
                title={`Show only ${s} movies`}
              >
                <span className={`chip chip-${s}`}>{s} {counts[s] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <input
          className="filter-control"
          placeholder="Search title…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-control" value={status} onChange={e => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </select>
        <select className="filter-control" value={listId} onChange={e => setListId(e.target.value)}>
          <option value="">All lists</option>
          {lists.map(l => (
            <option key={l.id} value={l.id} title={`Last synced: ${l.last_synced_at ? new Date(l.last_synced_at).toLocaleString() : 'Never'}`}>
              {l.name}
            </option>
          ))}
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
        <span style={{ color: 'var(--text-dim)', fontSize: 'var(--font-sm)' }}>
          {visible.length !== movies.length ? `${visible.length} of ${movies.length} movies` : `${movies.length} movies`}
        </span>
      </div>

      <div className="movie-grid">
        {visible.map(m => {
          const totalBytes = m.size_bytes;
          const doneBytes = totalBytes != null && m.progress != null ? totalBytes * (m.progress / 100) : null;
          return (
            <div
              key={m.id}
              className="movie-card"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/movies/${m.id}`)}
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

                {m.director && <div className="movie-stat-row">{m.director}</div>}

                {totalBytes != null && m.status !== 'downloading' && m.status !== 'importing' && (
                  <div className="movie-stat-row">{formatBytes(totalBytes)}</div>
                )}

                <div className="row" style={{ margin: '6px 0' }}>
                  <span className={`chip chip-${m.radarr_error ? 'error' : m.status}`}>
                    {m.radarr_error ? 'error' : m.status}
                  </span>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{m.list_name}</span>
                </div>

                {(m.status === 'downloading' || m.status === 'importing') && m.progress != null && (
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${m.progress}%` }} />
                    <span className="progress-label">
                      {totalBytes != null
                        ? `${formatBytes(doneBytes)} / ${formatBytes(totalBytes)} (${m.progress}%)`
                        : `${m.progress}%`}
                    </span>
                  </div>
                )}

                {m.genres && (
                  <div className="genre-row">
                    {m.genres.split(', ').map(g => (
                      <span key={g} className="genre-chip">{g}</span>
                    ))}
                  </div>
                )}

                {m.radarr_error && (
                  <p className="error-text" style={{ marginTop: 6 }}>⚠ {m.radarr_error}</p>
                )}

                <div className="movie-added">
                  Added {new Date(m.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <p style={{ color: 'var(--text-dimmer)', textAlign: 'center', padding: 32 }}>No movies match.</p>
        )}
      </div>
    </div>
  );
}
