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

    // Best-effort: nudges Plex to notice a file removed from disk and drop the
    // now-dead library entry, instead of leaving a broken/grayed-out item
    // until Plex's own next scheduled scan.
    async refreshAndClean() {
      const key = await this.getMovieSectionKey();
      if (!key) return;
      await http.get(`/library/sections/${key}/refresh`, { params: { 'X-Plex-Token': token } });
      await new Promise(resolve => setTimeout(resolve, 3000));
      await http.get(`/library/sections/${key}/emptyTrash`, { params: { 'X-Plex-Token': token } });
    },
  };
}

module.exports = { client };
