const axios = require('axios');

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://flaresolverr:8191/v1';
const MAX_PAGES = 20;

const POSTER_TAG_RE = /<div class="react-component" data-component-class="LazyPoster"[^>]*>/g;
const ITEM_NAME_RE = /data-item-name="([^"]*)"/;
const ITEM_SLUG_RE = /data-item-slug="([^"]*)"/;

function decodeEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseListPage(html) {
  const movies = [];
  for (const [tag] of html.matchAll(POSTER_TAG_RE)) {
    const nameMatch = tag.match(ITEM_NAME_RE);
    const slugMatch = tag.match(ITEM_SLUG_RE);
    if (!nameMatch || !slugMatch) continue;

    const fullName = decodeEntities(nameMatch[1]);
    const yearMatch = fullName.match(/^(.*) \((\d{4})\)$/);
    movies.push({
      title: yearMatch ? yearMatch[1] : fullName,
      year: yearMatch ? parseInt(yearMatch[2], 10) : null,
      slug: slugMatch[1],
    });
  }
  return movies;
}

async function fetchPage(pageUrl) {
  const { data } = await axios.post(FLARESOLVERR_URL, {
    cmd: 'request.get',
    url: pageUrl,
    maxTimeout: 60000,
  });
  return data.solution.response;
}

async function fetchList(url) {
  const baseUrl = url.replace(/\/$/, '') + '/';
  const movies = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = page === 1 ? baseUrl : `${baseUrl}page/${page}/`;
    const html = await fetchPage(pageUrl);
    const pageMovies = parseListPage(html);
    if (pageMovies.length === 0) break;
    movies.push(...pageMovies);
  }

  return movies;
}

module.exports = { parseListPage, fetchList };
