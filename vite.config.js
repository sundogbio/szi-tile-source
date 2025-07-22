import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path'

export default defineConfig(({command}) => ({
  // Otherwise the public directory ends up in dist. There is probably a better way
  // of doing this, but until I reorganise the folder structure, this is fine for now!
  publicDir: command === 'build' ? false : 'public',
  build : {
    lib: {
      entry: resolve(__dirname, 'src/main.js'),
      name: 'SziTileSource',
      // the proper extensions will be added
      fileName: 'szi-tile-source',
    },
  }
}))
