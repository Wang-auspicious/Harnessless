import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const electronBin = require('electron');

const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBin, [resolve(root, 'dist/electron/main.cjs')], {
  cwd: root,
  stdio: 'inherit',
  env,
});

child.on('exit', code => {
  process.exit(code ?? 0);
});
