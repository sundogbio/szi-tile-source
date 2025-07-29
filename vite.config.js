import { readFileSync } from 'fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
console.log(packageJson.version);

export default defineConfig(({ command }) => ({
  // Otherwise the public directory ends up in dist. There is probably a better way
  // of doing this, but until I reorganise the folder structure, this is fine for now!
  publicDir: command === 'build' ? false : 'public',
  define: {
    __VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.js'),
      name: 'SziTileSource',
      // the proper extensions will be added
      fileName: 'szi-tile-source',
    },
  },
}));
