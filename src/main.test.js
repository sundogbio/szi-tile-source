/**
 * @vitest-environment jsdom
 */
import { enableSziTileSource, extractDziPathAndUrl, getContentsOfSziFile, UrlMapper } from './main.js';
import { expect, test } from 'vitest';
import OpenSeadragon from 'openseadragon';

// This isn't an actual test, just a runner so I can debug as I go. It assumes
// that you have done 'npx vite' to serve up the examples on a local server to
// to start with
test('Test contents', { timeout: 300_000 }, async () => {
  const contents = await getContentsOfSziFile('http://localhost:5173/examples/zipped/mixmas.szi');
  expect(contents.size).toBe(150);
});

test('Test url mapper', () => {
  const mapper = new UrlMapper('http://localhost:5173/examples/zipped/mixmas.szi');
  expect(mapper.sziFilenameWithoutSuffix).toEqual('mixmas');
  expect(mapper.sziPathWithoutFilename).toEqual('/examples/zipped/');
  expect(mapper.pathInSziFromDziUrl('http://localhost:5173/examples/zipped/mixmas/mixmas_files/0_0.jpg')).toEqual(
    'mixmas/mixmas_files/0_0.jpg',
  );
  expect(mapper.dziXmlUrl()).toEqual('http://localhost:5173/examples/zipped/mixmas/mixmas.dzi');
});

test('Test url mapper with base url', () => {
  const mapper = new UrlMapper('examples/zipped/mixmas.szi', 'http://test.com');
  expect(mapper.sziFilenameWithoutSuffix).toEqual('mixmas');
  expect(mapper.sziPathWithoutFilename).toEqual('/examples/zipped/');
  expect(mapper.pathInSziFromDziUrl('http://test.com/examples/zipped/mixmas/mixmas_files/0_0.jpg')).toEqual(
    'mixmas/mixmas_files/0_0.jpg',
  );
  expect(mapper.dziXmlUrl()).toEqual('http://test.com/examples/zipped/mixmas/mixmas.dzi');
});

// Again, another "test" that is mostly here so I can happily debug the mechanics of constructing the dervied clas
test('Test construction', { timeout: 300_000 }, async () => {
  enableSziTileSource(OpenSeadragon);

  const sziTileSource = await OpenSeadragon.SziTileSource.createSziTileSource(
    'http://localhost:5173/examples/zipped/mixmas.szi',
  );

  expect(sziTileSource.getTileUrl(0, 0, 0)).toEqual(
    'http://localhost:5173/examples/zipped/mixmas/mixmas_files/0/0_0.jpeg',
  );
  expect(sziTileSource.getTileUrl(10, 55, 33)).toEqual(
    'http://localhost:5173/examples/zipped/mixmas/mixmas_files/10/55_33.jpeg',
  );
});
