INSERT INTO settings (key) VALUES
  ('plex_external_url'),
  ('plex_machine_identifier')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS plex_rating_key TEXT;
