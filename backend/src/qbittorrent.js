const axios = require('axios');

function client(settings) {
  if (!settings.qbittorrent_url) return null;

  const http = axios.create({ baseURL: settings.qbittorrent_url, timeout: 15000 });
  let cookie = null;

  async function login() {
    const { headers } = await http.post(
      '/api/v2/auth/login',
      new URLSearchParams({
        username: settings.qbittorrent_username || '',
        password: settings.qbittorrent_password || '',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const setCookie = headers['set-cookie'];
    if (setCookie) cookie = setCookie[0].split(';')[0];
  }

  return {
    // Stops seeding and deletes the raw file(s) in the downloads folder —
    // Radarr's own deleteFiles only removes the organized library copy, it
    // never touches the original download the torrent client is seeding.
    async removeByHash(hash, deleteFiles = true) {
      if (!cookie) await login();
      await http.post(
        '/api/v2/torrents/delete',
        new URLSearchParams({ hashes: hash, deleteFiles: String(deleteFiles) }),
        { headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
    },
  };
}

module.exports = { client };
