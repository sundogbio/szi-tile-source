/**
 * @vitest-environment jsdom
 */
import { enableSziTileSource } from './main.js';
import { RemoteFile } from './remoteFile.js';
import { expect, test, beforeAll, afterAll, afterEach } from 'vitest';
import OpenSeadragon from 'openseadragon';
import { getContentsOfSziFile } from './sziFileReader.js';

import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { LocalFile } from './testHelpers.js';

// Set up for mocked network request handling with msw
export const server = setupServer(
  http.head('http://localhost:5173/examples/zipped/mixmas-jpeg.szi', async ({ request }) => {
    const localFile = await LocalFile.create('./public/examples/zipped/mixmas-jpeg.szi');

    const response = HttpResponse.text('');
    response.headers.set('content-length', localFile.size);
    return response;
  }),
  http.get('http://localhost:5173/examples/zipped/mixmas-jpeg.szi', async ({ request }) => {
    const localFile = await LocalFile.create('./public/examples/zipped/mixmas-jpeg.szi');

    const headers = request.headers;
    const range = headers.get('Range');
    const [match, startStr, endStr] = range.match(/^bytes=(\d*)-(\d*)/);
    if (match) {
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10) + 1; //Range requests are *inclusive*

      const body = await localFile.fetchRange(start, end, undefined);
      return new HttpResponse(body, { status: 206 });
    } else {
      return new HttpResponse(undefined, { status: 500 });
    }
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Basic check that fetching the contents works with something that looks a network request
test('Test contents', async () => {
  const sziFile = await RemoteFile.create('http://localhost:5173/examples/zipped/mixmas-jpeg.szi', {});
  const contents = await getContentsOfSziFile(sziFile);

  expect(contents.size).toBe(150);

  // Check that contents do not overlap
  const sortedLocations = Array.from(contents.values()).sort((a, b) => a.start - b.start);
  let lastMaxEnd = 0;
  for (let i = 0; i < sortedLocations.length; i++) {
    const location = sortedLocations[i];
    expect(location.start).toBeGreaterThanOrEqual(lastMaxEnd);
    expect(location.start + location.bodyLength).toBeLessThan(location.maxEnd);
    expect(location.maxEnd).toBeLessThan(sziFile.size);

    lastMaxEnd = location.maxEnd;
  }

  // Check that content filenames match expectations
  const auxFileNames = new Set(['mixmas/scan-properties.xml', 'mixmas/mixmas_files/vips-properties.xml']);
  let dziFound = false;
  let imageTileFiles = 0;
  for (const filename of contents.keys()) {
    if (filename === 'mixmas/mixmas.dzi') {
      dziFound = true;
    } else if (!auxFileNames.has(filename)) {
      expect(filename).toMatch(/^mixmas\/mixmas_files\/\d+\/\d+_\d+\.jpeg$/);
      imageTileFiles++;
    }
  }

  expect(imageTileFiles).toEqual(147);
  expect(dziFound).toBeTruthy();
});

// Basic E2E check that the tile source can be created and gives sensible values
// for some standard getters
test('Test construction', async () => {
  enableSziTileSource(OpenSeadragon);

  const sziTileSource = await OpenSeadragon.SziTileSource.createSziTileSource(
    'http://localhost:5173/examples/zipped/mixmas-jpeg.szi',
  );

  expect(sziTileSource.getTileUrl(0, 0, 0)).toEqual('mixmas/mixmas_files/0/0_0.jpeg');
  expect(sziTileSource.getTileUrl(10, 2, 2)).toEqual('mixmas/mixmas_files/10/2_2.jpeg');

  expect(sziTileSource.getNumTiles(0)).toEqual({ x: 1, y: 1 });
  expect(sziTileSource.getNumTiles(11)).toEqual({ x: 5, y: 5 });

  expect(sziTileSource.getTileHeight(11)).toEqual(254);
  expect(sziTileSource.getTileWidth(11)).toEqual(254);
});
