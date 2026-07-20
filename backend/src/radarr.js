const axios = require('axios');

function client(settings) {
  const http = axios.create({
    baseURL: `${settings.radarr_url}/api/v3`,
    headers: { 'X-Api-Key': settings.radarr_api_key },
    timeout: 15000,
  });

  return {
    async lookup(title, year) {
      const term = year ? `${title} ${year}` : title;
      const { data } = await http.get('/movie/lookup', { params: { term } });
      return data[0] ?? null;
    },

    async add(movie, qualityProfileId, rootFolderPath) {
      const { data } = await http.post('/movie', {
        title: movie.title,
        year: movie.year,
        tmdbId: movie.tmdbId,
        qualityProfileId: parseInt(qualityProfileId),
        rootFolderPath,
        monitored: true,
        addOptions: { searchForMovie: true },
      });
      return data;
    },

    async get(radarrId) {
      const { data } = await http.get(`/movie/${radarrId}`);
      return data;
    },

    async getQueue() {
      const { data } = await http.get('/queue', { params: { pageSize: 1000 } });
      return data.records ?? [];
    },
  };
}

module.exports = { client };
