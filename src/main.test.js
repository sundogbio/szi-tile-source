import { getContentsOfSziFile } from './main.js';
import { expect, test } from 'vitest';

// This isn't an actual test, just a runner so I can debug as I go. It assumes
// that you have done 'npx vite' to serve up the examples on a local server to
// to start with
test('Test contents', { timeout: 300_000 }, async () => {
  const contents = await getContentsOfSziFile('http://localhost:5173/examples/compressed/mixmas.szi');
  expect(contents.size).toBe(150);
});
