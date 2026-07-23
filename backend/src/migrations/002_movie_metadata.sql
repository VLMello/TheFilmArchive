ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS overview        TEXT,
  ADD COLUMN IF NOT EXISTS genres          TEXT,
  ADD COLUMN IF NOT EXISTS poster_url      TEXT,
  ADD COLUMN IF NOT EXISTS progress        REAL;
