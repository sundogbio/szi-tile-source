/**
 * @vitest-environment jsdom
 */
import { enableSziTileSource } from './main.js';
import { RemoteFile } from './remoteFile.js';
import { expect, test } from 'vitest';
import OpenSeadragon from 'openseadragon';
import { getContentsOfSziFile } from './sziFileReader.js';

// This isn't an actual test, just a runner so I can debug as I go. It assumes
// that you have done 'npx vite' to serve up the examples on a local server to
// to start with
test('Test contents', { timeout: 300_000 }, async () => {
  const contents = await getContentsOfSziFile(
    await RemoteFile.create('http://localhost:5173/examples/zipped/mixmas-jpeg.szi', {}),
  );
  expect(contents.size).toBe(150);
});

// Again, another "test" that is mostly here so I can happily debug the mechanics of constructing the dervied clas
test('Test construction', { timeout: 300_000 }, async () => {
  enableSziTileSource(OpenSeadragon);

  const sziTileSource = await OpenSeadragon.SziTileSource.createSziTileSource(
    'http://localhost:5173/examples/zipped/mixmas-jpeg.szi',
  );

  expect(sziTileSource.getTileUrl(0, 0, 0)).toEqual('mixmas/mixmas_files/0/0_0.jpeg');
  expect(sziTileSource.getTileUrl(10, 55, 33)).toEqual('mixmas/mixmas_files/10/55_33.jpeg');
});
