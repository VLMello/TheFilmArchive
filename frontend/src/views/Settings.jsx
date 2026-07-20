import React, { useEffect, useState } from 'react';
import { getLists, addList, deleteList, getSettings, updateSettings } from '../api';

const SETTING_FIELDS = [
  { key: 'radarr_url',                label: 'Radarr URL',              placeholder: 'http://localhost:7878' },
  { key: 'radarr_api_key',            label: 'Radarr API Key',          placeholder: 'your-api-key' },
  { key: 'radarr_quality_profile_id', label: 'Quality Profile ID',      placeholder: '1' },
  { key: 'radarr_root_folder_path',   label: 'Root Folder Path',        placeholder: '/movies' },
  { key: 'prowlarr_url',              label: 'Prowlarr URL',            placeholder: 'http://localhost:9696' },
  { key: 'prowlarr_api_key',          label: 'Prowlarr API Key',        placeholder: 'your-api-key' },
  { key: 'plex_movies_path',          label: 'Plex Movies Path',        placeholder: 'D:\\Media\\Movies' },
];

export default function Settings() {
  const [lists, setLists]         = useState([]);
  const [settings, setSettings]   = useState({});
  const [newUrl, setNewUrl]       = useState('');
  const [newName, setNewName]     = useState('');
  const [addError, setAddError]   = useState('');
  const [saved, setSaved]         = useState(false);

  useEffect(() => {
    getLists().then(setLists);
    getSettings().then(setSettings);
  }, []);

  async function handleAddList() {
    if (!newUrl || !newName) { setAddError('URL and name are required'); return; }
    try {
      const list = await addList(newUrl, newName);
      setLists(l => [...l, list]);
      setNewUrl(''); setNewName(''); setAddError('');
    } catch (e) {
      setAddError('Failed to add list — check the URL');
    }
  }

  async function handleDeleteList(id) {
    await deleteList(id);
    setLists(l => l.filter(x => x.id !== id));
  }

  async function handleSaveSettings() {
    const updated = await updateSettings(settings);
    setSettings(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="page">
      <h1>Settings</h1>

      <h2 style={{ fontSize: '1rem', color: '#888', margin: '0 0 12px' }}>Letterboxd Lists</h2>
      <div className="card">
        {lists.map(list => (
          <div key={list.id} className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{list.name}</strong>
              <div style={{ color: '#666', fontSize: '0.8rem' }}>{list.url}</div>
            </div>
            <button
              onClick={() => handleDeleteList(list.id)}
              style={{ background: '#3a1a1a', color: '#f56a6a' }}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 12 }}>
          <input
            placeholder="https://letterboxd.com/user/list/my-list/"
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
          />
          <input
            placeholder="List name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            style={{ width: 180, flexShrink: 0 }}
          />
          <button onClick={handleAddList} style={{ flexShrink: 0 }}>Add</button>
        </div>
        {addError && <p className="error-text">{addError}</p>}
      </div>

      <h2 style={{ fontSize: '1rem', color: '#888', margin: '20px 0 12px' }}>Radarr & Services</h2>
      <div className="card">
        {SETTING_FIELDS.map(({ key, label, placeholder }) => (
          <div key={key} style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', color: '#888', fontSize: '0.8rem', marginBottom: 4 }}>
              {label}
            </label>
            <input
              value={settings[key] ?? ''}
              placeholder={placeholder}
              onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
            />
          </div>
        ))}
        <button onClick={handleSaveSettings} style={{ marginTop: 8 }}>
          {saved ? 'Saved ✓' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
