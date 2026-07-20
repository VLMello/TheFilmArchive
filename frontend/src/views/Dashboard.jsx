import React, { useEffect, useState, useCallback } from 'react';
import { getLists, getSyncStatus, triggerSync, getMovies } from '../api';

const STATUSES = ['pending', 'queued', 'downloading', 'downloaded'];

export default function Dashboard() {
  const [lists, setLists]   = useState([]);
  const [status, setStatus] = useState({ running: false, lastSyncedAt: null });
  const [counts, setCounts] = useState({});
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const [l, s, movies] = await Promise.all([
      getLists(),
      getSyncStatus(),
      getMovies(),
    ]);
    setLists(l);
    setStatus(s);
    const c = {};
    for (const m of movies) c[m.status] = (c[m.status] ?? 0) + 1;
    setCounts(c);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSync() {
    setSyncing(true);
    await triggerSync();
    // Poll status until not running
    const poll = setInterval(async () => {
      const s = await getSyncStatus();
      setStatus(s);
      if (!s.running) { clearInterval(poll); setSyncing(false); load(); }
    }, 2000);
  }

  return (
    <div className="page">
      <h1>Dashboard</h1>

      <div className="card">
        <div className="row">
          <span>Last sync: {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : 'Never'}</span>
          <button onClick={handleSync} disabled={syncing || status.running}>
            {syncing || status.running ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
        <div className="row" style={{ gap: 24 }}>
          {STATUSES.map(s => (
            <span key={s}>
              <span className={`chip chip-${s}`}>{s}</span>
              {' '}{counts[s] ?? 0}
            </span>
          ))}
        </div>
      </div>

      <h2 style={{ margin: '20px 0 12px', fontSize: '1rem', color: '#888' }}>Configured Lists</h2>
      {lists.length === 0 && <p style={{ color: '#666' }}>No lists yet. Add one in Settings.</p>}
      {lists.map(list => (
        <div key={list.id} className="card">
          <strong>{list.name}</strong>
          <div style={{ color: '#666', fontSize: '0.85rem', marginTop: 4 }}>
            {list.url}
          </div>
          <div style={{ color: '#555', fontSize: '0.8rem', marginTop: 4 }}>
            Last synced: {list.last_synced_at ? new Date(list.last_synced_at).toLocaleString() : 'Never'}
          </div>
        </div>
      ))}
    </div>
  );
}
