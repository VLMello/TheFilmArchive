INSERT INTO settings (key) VALUES
  ('radarr_external_url')
ON CONFLICT (key) DO NOTHING;
