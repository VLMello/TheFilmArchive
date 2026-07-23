const { parseListPage } = require('../letterboxd');

function posterTag(name, slug) {
  return `<div class="react-component" data-component-class="LazyPoster" data-request-poster-metadata="true" data-item-name="${name}" data-item-slug="${slug}" data-item-link="/film/${slug}/"></div>`;
}

test('parses two movies from a list page', () => {
  const html = `<ul>${posterTag('The Godfather (1972)', 'the-godfather')}${posterTag('Parasite (2019)', 'parasite-2019')}</ul>`;
  const movies = parseListPage(html);
  expect(movies).toHaveLength(2);
  expect(movies[0]).toEqual({ title: 'The Godfather', year: 1972, slug: 'the-godfather' });
  expect(movies[1]).toEqual({ title: 'Parasite', year: 2019, slug: 'parasite-2019' });
});

test('handles a single poster', () => {
  const html = `<ul>${posterTag('Alien (1979)', 'alien')}</ul>`;
  const movies = parseListPage(html);
  expect(movies).toHaveLength(1);
  expect(movies[0]).toEqual({ title: 'Alien', year: 1979, slug: 'alien' });
});

test('returns empty array when no posters are present', () => {
  expect(parseListPage('<ul></ul>')).toEqual([]);
});

test('decodes HTML entities in titles', () => {
  const html = posterTag('Am&eacute;lie&#39;s &quot;Adventure&quot; (2001)'.replace('&eacute;', 'e'), 'amelies-adventure');
  const movies = parseListPage(html);
  expect(movies[0].title).toBe('Amelie\'s "Adventure"');
});
