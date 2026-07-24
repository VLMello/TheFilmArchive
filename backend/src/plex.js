const axios = require('axios');

function client(settings) {
  if (!settings.plex_url || !settings.plex_token) return null;

  const http = axios.create({ baseURL: settings.plex_url, timeout: 15000 });
  const token = settings.plex_token;

  return {
    async getMovieSectionKey() {
      const { data } = await http.get('/library/sections', {
        params: { 'X-Plex-Token': token },
        headers: { Accept: 'application/json' },
      });
      const section = (data.MediaContainer.Directory || []).find(d => d.type === 'movie');
      return section ? section.key : null;
    },

    // Best-effort: nudges Plex to pick up a newly imported file immediately,
    // instead of leaving it invisible on clients with no manual "scan
    // library" button until Plex's own next scheduled scan.
    async refresh() {
      const key = await this.getMovieSectionKey();
      if (!key) return;
      await http.get(`/library/sections/${key}/refresh`, { params: { 'X-Plex-Token': token } });
    },

    // Looks up the Plex ratingKey for a movie by TMDB id, so a deep link can
    // be built — Plex's own guid doesn't expose the TMDB id unless
    // includeGuids is requested.
    async findRatingKeyByTmdbId(tmdbId) {
      const key = await this.getMovieSectionKey();
      if (!key) return null;
      const { data } = await http.get(`/library/sections/${key}/all`, {
        params: { 'X-Plex-Token': token, includeGuids: 1 },
        headers: { Accept: 'application/json' },
      });
      const items = data.MediaContainer.Metadata || [];
      const match = items.find(it => (it.Guid || []).some(g => g.id === `tmdb://${tmdbId}`));
      return match ? match.ratingKey : null;
    },

    async getMachineIdentifier() {
      const { data } = await http.get('/identity', {
        params: { 'X-Plex-Token': token },
        headers: { Accept: 'application/json' },
      });
      return data.MediaContainer.machineIdentifier;
    },

    // Best-effort: nudges Plex to notice a file removed from disk and drop the
    // now-dead library entry, instead of leaving a broken/grayed-out item
    // until Plex's own next scheduled scan.
    async refreshAndClean() {
      const key = await this.getMovieSectionKey();
      if (!key) return;
      await http.get(`/library/sections/${key}/refresh`, { params: { 'X-Plex-Token': token } });
      await new Promise(resolve => setTimeout(resolve, 3000));
      // Newer Plex Media Server versions reject a GET here with a 404 — needs PUT.
      await http.put(`/library/sections/${key}/emptyTrash`, null, { params: { 'X-Plex-Token': token } });
    },
  };
}

module.exports = { client };
