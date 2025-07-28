/**
 * @vitest-environment jsdom
 */
import { enableSziTileSource } from './main.js';
import { RemoteFile } from './remoteFile.js';
import { expect, test } from 'vitest';
import OpenSeadragon from 'openseadragon';
import { getContentsOfSziFile } from './sziFileReader.js';

// Basic check that fetching the contents works with a "real" webserver
test('Test contents', async () => {
  const contents = await getContentsOfSziFile(
    await RemoteFile.create('http://localhost:5173/examples/zipped/mixmas-jpeg.szi', {}),
  );
  expect(contents.size).toBe(150);
});

// Basic E2E check that the tile source can be created and gives sensible values
// for the tile urls
test('Test construction', async () => {
  enableSziTileSource(OpenSeadragon);

  const sziTileSource = await OpenSeadragon.SziTileSource.createSziTileSource(
    'http://localhost:5173/examples/zipped/mixmas-jpeg.szi',
  );

  expect(sziTileSource.getTileUrl(0, 0, 0)).toEqual('mixmas/mixmas_files/0/0_0.jpeg');
  expect(sziTileSource.getTileUrl(10, 55, 33)).toEqual('mixmas/mixmas_files/10/55_33.jpeg');
});
