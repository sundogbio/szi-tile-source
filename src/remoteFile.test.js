/**
 * @vitest-environment jsdom
 */
import { RemoteFile } from './remoteFile.js';
import { expect, test, vi, afterEach } from 'vitest';

const FILE_SIZE = 1000;

/** Build a fake 206 Response carrying the Content-Range RemoteFile parses. */
function rangeResponse(start, end) {
  return {
    ok: true,
    status: 206,
    headers: new Headers({ 'Content-Range': `bytes ${start}-${end}/${FILE_SIZE}` }),
    arrayBuffer: async () => new ArrayBuffer(end - start + 1),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test('forwards the cache option to fetch for the size probe and range requests', async () => {
  const fetchSpy = vi.fn(async (_url, opts) => {
    const range = opts.headers.Range.match(/bytes=(\d+)-(\d+)/);
    return rangeResponse(parseInt(range[1], 10), parseInt(range[2], 10));
  });
  vi.stubGlobal('fetch', fetchSpy);

  const file = await RemoteFile.create('http://example.test/file.szi', { cache: 'no-store' });
  await file.fetchRange(0, 16);

  // First call is the size probe, second is the range request; both must carry cache.
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  for (const call of fetchSpy.mock.calls) {
    expect(call[1].cache).toBe('no-store');
  }
});

test('leaves cache undefined when not supplied (default browser behavior)', async () => {
  const fetchSpy = vi.fn(async (_url, opts) => {
    const range = opts.headers.Range.match(/bytes=(\d+)-(\d+)/);
    return rangeResponse(parseInt(range[1], 10), parseInt(range[2], 10));
  });
  vi.stubGlobal('fetch', fetchSpy);

  await RemoteFile.create('http://example.test/file.szi', {});

  expect(fetchSpy.mock.calls[0][1].cache).toBeUndefined();
});
