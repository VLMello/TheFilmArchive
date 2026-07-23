INSERT INTO settings (key) VALUES
  ('plex_url'),
  ('plex_token')
ON CONFLICT (key) DO NOTHING;
