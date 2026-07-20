const { parseRss } = require('../letterboxd');

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:letterboxd="https://a.letterboxd.com/ns/1.0/">
  <channel>
    <title>Download Queue</title>
    <item>
      <title>The Godfather (1972)</title>
      <link>https://letterboxd.com/film/the-godfather/</link>
      <letterboxd:filmTitle>The Godfather</letterboxd:filmTitle>
      <letterboxd:filmYear>1972</letterboxd:filmYear>
    </item>
    <item>
      <title>Parasite (2019)</title>
      <link>https://letterboxd.com/film/parasite-2019/</link>
      <letterboxd:filmTitle>Parasite</letterboxd:filmTitle>
      <letterboxd:filmYear>2019</letterboxd:filmYear>
    </item>
  </channel>
</rss>`;

test('parses two movies from RSS', () => {
  const movies = parseRss(SAMPLE_RSS);
  expect(movies).toHaveLength(2);
  expect(movies[0]).toEqual({ title: 'The Godfather', year: 1972, slug: 'the-godfather' });
  expect(movies[1]).toEqual({ title: 'Parasite', year: 2019, slug: 'parasite-2019' });
});

test('handles single item (not array)', () => {
  const single = SAMPLE_RSS.replace(
    /<item>[\s\S]*?<\/item>\s*<item>[\s\S]*?<\/item>/,
    `<item>
      <title>Alien (1979)</title>
      <link>https://letterboxd.com/film/alien/</link>
      <letterboxd:filmTitle>Alien</letterboxd:filmTitle>
      <letterboxd:filmYear>1979</letterboxd:filmYear>
    </item>`
  );
  const movies = parseRss(single);
  expect(movies).toHaveLength(1);
  expect(movies[0].title).toBe('Alien');
});

test('returns empty array for empty channel', () => {
  const empty = `<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>`;
  expect(parseRss(empty)).toEqual([]);
});
