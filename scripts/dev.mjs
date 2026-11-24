import {spawn} from 'node:child_process';
import {cp, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import process from 'node:process';
import {createServer} from 'vite';
import {build as esbuild} from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const electronBin = require('electron');

const excalidrawFontsSrc = resolve(
  root,
  'node_modules/@excalidraw/excalidraw/dist/prod/fonts',
);
const publicExcalidrawFonts = resolve(
  root,
  'renderer/public/excalidraw-assets/fonts',
);
if (existsSync(excalidrawFontsSrc) && !existsSync(publicExcalidrawFonts)) {
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

const vite = await createServer({
  configFile: resolve(root, 'renderer/vite.config.ts'),
});
await vite.listen();
const devUrl = `http://127.0.0.1:${vite.config.server.port ?? 5178}`;

const child = spawn(electronBin, [resolve(root, 'dist/electron/main.cjs')], {
  cwd: root,
  stdio: 'inherit',
  env: {...process.env, FORGEOPS_RENDERER_DEV_URL: devUrl},
});

child.on('exit', async code => {
  await vite.close();
  process.exit(code ?? 0);
});
