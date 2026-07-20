I'm setting up **The Film Archive (TFA)** on my Ubuntu home server — a self-hosted web app that monitors Letterboxd lists and automatically queues movies for download via Radarr/Prowlarr/qBittorrent, with files landing in a Plex media folder.

**Repo:** https://github.com/VLMello/TheFilmArchive

**Stack:**
- Docker Compose with 6 services: tfa-backend (Node/Express), tfa-frontend (React/nginx), postgres:16, Radarr, Prowlarr, qBittorrent
- Backend syncs Letterboxd RSS feeds hourly and adds movies to Radarr automatically
- Frontend at port 8080, Radarr at 7878, Prowlarr at 9696, qBittorrent at 8090

**What I need you to do:**
1. Install Docker Engine + Docker Compose plugin on Ubuntu (using the official `apt` method, not snap)
2. Clone https://github.com/VLMello/TheFilmArchive
3. Create `.env` from `.env.example` — I'll tell you the paths and you pick safe DB credentials
4. Run `docker compose up --build -d`
5. Enable Docker to start on boot (`sudo systemctl enable docker`) and verify `restart: unless-stopped` is set in compose (it already is)
6. Confirm all 6 containers are healthy with `docker compose ps`

**Environment variables needed:**
- `POSTGRES_DB=tfa`
- `POSTGRES_USER=tfa`
- `POSTGRES_PASSWORD` — generate a strong one
- `DATABASE_URL=postgresql://tfa:<password>@postgres:5432/tfa`
- `MOVIES_PATH` — I'll provide the absolute path to my Plex movies folder
- `DOWNLOADS_PATH` — I'll provide the absolute path for torrent downloads
- `TZ=America/Sao_Paulo`

**After containers are up, I'll configure via web UIs:**
- Radarr (port 7878) → Settings → Media Management: add root folder `/movies` → Settings → Download Clients: add qBittorrent (host: `qbittorrent`, port: `8090`) → Settings → Apps: connect Prowlarr
- Prowlarr (port 9696) → add indexers
- TFA (port 8080) → Settings → enter Radarr URL (`http://radarr:7878`) + API key + quality profile ID → add a Letterboxd list URL → click Sync Now

Please start by installing Docker on Ubuntu.
