INSERT INTO settings (key) VALUES
  ('qbittorrent_url'),
  ('qbittorrent_username'),
  ('qbittorrent_password')
ON CONFLICT (key) DO NOTHING;
