import {build as esbuild} from 'esbuild';
import {build as viteBuild} from 'vite';
import {cp, mkdir, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');

await rm(resolve(root, 'dist'), {recursive: true, force: true});
await mkdir(resolve(root, 'dist/electron'), {recursive: true});

// Stage Excalidraw offline font assets before Vite builds so both dev & dist work offline under file://
const excalidrawFontsSrc = resolve(
  root,
  'node_modules/@excalidraw/excalidraw/dist/prod/fonts',
);
const publicExcalidrawFonts = resolve(
  root,
  'renderer/public/excalidraw-assets/fonts',
);
if (existsSync(excalidrawFontsSrc)) {
  await mkdir(publicExcalidrawFonts, {recursive: true});
  await cp(excalidrawFontsSrc, publicExcalidrawFonts, {recursive: true});
}

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
