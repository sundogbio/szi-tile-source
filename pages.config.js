import { defineConfig } from 'vite';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig(({ command }) => ({
  define: {
    __VERSION__: JSON.stringify(packageJson.version),
  },
  base: '', // relative paths
}));
