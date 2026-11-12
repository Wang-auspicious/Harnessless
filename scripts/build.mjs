import {build as esbuild} from 'esbuild';
import {build as viteBuild} from 'vite';
import {mkdir, rm} from 'node:fs/promises';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');

await rm(resolve(root, 'dist'), {recursive: true, force: true});
await mkdir(resolve(root, 'dist/electron'), {recursive: true});

await esbuild({
  entryPoints: [resolve(root, 'src/electron/main.ts')],
  outfile: resolve(root, 'dist/electron/main.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  external: ['electron', 'node:sqlite'],
});

await esbuild({
  entryPoints: [resolve(root, 'src/electron/preload.ts')],
  outfile: resolve(root, 'dist/electron/preload.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
});

await viteBuild({
  configFile: resolve(root, 'renderer/vite.config.ts'),
  logLevel: 'info',
});
