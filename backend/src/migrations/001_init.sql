CREATE TABLE IF NOT EXISTS lists (
  id             SERIAL PRIMARY KEY,
  url            TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  last_synced_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS movies (
  id               SERIAL PRIMARY KEY,
  letterboxd_slug  TEXT NOT NULL,
  title            TEXT NOT NULL,
  year             INT,
  tmdb_id          INT,
  radarr_id        INT,
  radarr_error     TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  list_id          INT NOT NULL REFERENCES lists(id),
  created_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(letterboxd_slug, list_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

INSERT INTO settings (key) VALUES
  ('radarr_url'),
  ('radarr_api_key'),
  ('prowlarr_url'),
  ('prowlarr_api_key'),
  ('plex_movies_path'),
  ('radarr_quality_profile_id'),
  ('radarr_root_folder_path')
ON CONFLICT (key) DO NOTHING;
