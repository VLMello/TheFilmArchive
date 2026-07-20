import React, { useEffect, useState } from 'react';
import { getMovies, getLists, getSettings } from '../api';

const STATUS_OPTIONS = ['', 'pending', 'queued', 'downloading', 'downloaded'];

export default function Movies() {
  const [movies, setMovies]     = useState([]);
  const [lists, setLists]       = useState([]);
  const [radarrUrl, setRadarrUrl] = useState('');
  const [filters, setFilters]   = useState({ status: '', list_id: '' });

  useEffect(() => {
    getLists().then(setLists);
    getSettings().then(s => setRadarrUrl(s.radarr_url ?? ''));
  }, []);

  useEffect(() => {
    getMovies(filters).then(setMovies);
  }, [filters]);

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value }));
  }

  return (
    <div className="page">
      <h1>Movies</h1>

      <div className="row" style={{ marginBottom: 16 }}>
        <select value={filters.status} onChange={e => setFilter('status', e.target.value)} style={{ width: 160 }}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </select>
        <select value={filters.list_id} onChange={e => setFilter('list_id', e.target.value)} style={{ width: 200 }}>
          <option value="">All lists</option>
          {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <span style={{ color: '#666', fontSize: '0.85rem' }}>{movies.length} movies</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Year</th>
            <th>List</th>
            <th>Status</th>
            <th>Added</th>
          </tr>
        </thead>
        <tbody>
          {movies.map(m => (
            <tr
              key={m.id}
              style={{ cursor: m.radarr_id && radarrUrl ? 'pointer' : 'default' }}
              onClick={() => {
                if (m.radarr_id && radarrUrl) {
                  window.open(`${radarrUrl}/movie/${m.radarr_id}`, '_blank');
                }
              }}
            >
              <td>
                {m.title}
                {m.radarr_error && (
                  <span className="error-text" title={m.radarr_error}> ⚠</span>
                )}
              </td>
              <td>{m.year ?? '—'}</td>
              <td>{m.list_name}</td>
              <td>
                <span className={`chip chip-${m.radarr_error ? 'error' : m.status}`}>
                  {m.radarr_error ? 'error' : m.status}
                </span>
              </td>
              <td style={{ color: '#666', fontSize: '0.85rem' }}>
                {new Date(m.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
          {movies.length === 0 && (
            <tr><td colSpan={5} style={{ color: '#555', textAlign: 'center', padding: 32 }}>No movies yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
