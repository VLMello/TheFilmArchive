const BASE = '/api';

async function json(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const getLists    = () => fetch(`${BASE}/lists`).then(json);
export const addList     = (url, name) => fetch(`${BASE}/lists`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, name }),
}).then(json);
export const deleteList  = (id) => fetch(`${BASE}/lists/${id}`, { method: 'DELETE' });

export const getMovies   = (params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v))
  ).toString();
  return fetch(`${BASE}/movies${qs ? `?${qs}` : ''}`).then(json);
};

export const triggerSync  = () => fetch(`${BASE}/sync`, { method: 'POST' }).then(json);
export const getSyncStatus = () => fetch(`${BASE}/sync/status`).then(json);

export const getSettings    = () => fetch(`${BASE}/settings`).then(json);
export const updateSettings = (data) => fetch(`${BASE}/settings`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
}).then(json);
