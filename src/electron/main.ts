/**
 * Electron 44 Desktop Main Process:
 * Boots `ForgeRuntime` on loopback, enforces hardened WebPreferences
 * (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`), and
 * supports headless smoke verification via `FORGEOPS_SMOKE_EXIT=1`.
 */

import {join, resolve} from 'node:path';
import process from 'node:process';
import {app, BrowserWindow, dialog, ipcMain} from 'electron';
import {ForgeRuntime} from '../server/runtime.ts';

let runtime: ForgeRuntime | null = null;
let mainWindow: BrowserWindow | null = null;

async function bootstrapDesktop(): Promise<void> {
  const dataDir =
    process.env['FORGEOPS_DATA_DIR'] ??
    join(app.getPath('userData'), 'forgeops-v2');
  runtime = new ForgeRuntime({dataDir});
  await runtime.start();

  // Kick off non-blocking Environment Doctor probe in background.
  void runtime.steward.runEnvironmentDoctor().catch(() => undefined);

  ipcMain.handle('forgeops:pick-directory', async () => {
    if (!mainWindow) {
      return null;
    }
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) {
      return null;
    }
    return res.filePaths[0] ?? null;
  });

  const preloadPath = resolve(__dirname, 'preload.cjs');
  const isSmoke = process.env['FORGEOPS_SMOKE_EXIT'] === '1';

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    show: !isSmoke,
    title: 'ForgeOps — Enterprise Software Engineering Meta-Harness',
    backgroundColor: '#07090e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [
        `--forgeops-api-url=${runtime.httpServer.apiBaseUrl}`,
        `--forgeops-token=${runtime.httpServer.sessionToken}`,
      ],
    },
  });

  const devUrl = process.env['FORGEOPS_RENDERER_DEV_URL'];
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    const htmlPath = resolve(__dirname, '../renderer/index.html');
    await mainWindow.loadFile(htmlPath);
  }

  if (isSmoke) {
    // Allow React bootstrap + authenticated /api/bootstrap fetch to settle.
    setTimeout(() => {
      void (async () => {
        try {
          const domText = (await mainWindow?.webContents.executeJavaScript(
            'document.body ? document.body.innerText : ""',
          )) as string;
          const ok = domText.includes('ForgeOps');
          process.stdout.write(
            `FORGEOPS_ELECTRON_SMOKE_OK:${ok}:${domText.slice(0, 120).replace(/\s+/g, ' ')}\n`,
          );
          if (!ok) {
            app.exit(2);
            return;
          }
        } finally {
          app.quit();
        }
      })();
    }, 1500);
  }
}

void app.whenReady().then(() => {
  void bootstrapDesktop().catch(err => {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`Fatal bootstrap error: ${msg}\n`);
    app.exit(1);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', event => {
  if (runtime) {
    event.preventDefault();
    const toStop = runtime;
    runtime = null;
    void toStop.stop().finally(() => {
      app.exit(0);
    });
  }
});
