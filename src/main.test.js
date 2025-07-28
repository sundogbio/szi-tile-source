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
