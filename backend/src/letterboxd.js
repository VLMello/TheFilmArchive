const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name) => name === 'item',
});

function parseRss(xml) {
  const result = parser.parse(xml);
  const items = result?.rss?.channel?.item ?? [];
  return items.map(item => {
    const link = item.link ?? '';
    const slug = link.split('/film/')[1]?.replace(/\/$/, '') ?? null;
    return {
      title: item['letterboxd:filmTitle'] ?? item.title ?? '',
      year: item['letterboxd:filmYear'] ? parseInt(item['letterboxd:filmYear']) : null,
      slug,
    };
  }).filter(m => m.title);
}

async function fetchList(url) {
  const rssUrl = url.replace(/\/$/, '') + '/rss/';
  const { data } = await axios.get(rssUrl, {
    headers: { 'User-Agent': 'TheFilmArchive/1.0' },
    timeout: 10000,
  });
  return parseRss(data);
}

module.exports = { parseRss, fetchList };
