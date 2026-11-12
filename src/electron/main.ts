/**
 * Electron 44 Desktop Main Process:
 * Boots `ForgeRuntime` on loopback, enforces hardened WebPreferences
 * (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`),
 * native frameless DirectUI titlebar overlay, window-bounds persistence,
 * single-instance lock, external URL quarantine, and `FORGEOPS_SMOKE_EXIT=1`.
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import process from 'node:process';
import {app, BrowserWindow, dialog, ipcMain, shell} from 'electron';
import {ForgeRuntime} from '../server/runtime.ts';

interface PersistedWindowBounds {
  readonly width: number;
  readonly height: number;
  readonly x?: number;
  readonly y?: number;
  readonly isMaximized?: boolean;
}

let runtime: ForgeRuntime | null = null;
let mainWindow: BrowserWindow | null = null;

const isSmoke = process.env['FORGEOPS_SMOKE_EXIT'] === '1';

function loadWindowBounds(boundsPath: string): PersistedWindowBounds {
  try {
    if (existsSync(boundsPath)) {
      const parsed = JSON.parse(
        readFileSync(boundsPath, 'utf8'),
      ) as Partial<PersistedWindowBounds>;
      const width =
        typeof parsed.width === 'number' && parsed.width >= 1024
          ? parsed.width
          : 1520;
      const height =
        typeof parsed.height === 'number' && parsed.height >= 680
          ? parsed.height
          : 940;
      return {
        width,
        height,
        x: typeof parsed.x === 'number' ? parsed.x : undefined,
        y: typeof parsed.y === 'number' ? parsed.y : undefined,
        isMaximized: Boolean(parsed.isMaximized),
      };
    }
  } catch {
    // Ignore malformed bounds file and fall back to defaults.
  }
  return {width: 1520, height: 940};
}

function saveWindowBounds(boundsPath: string, win: BrowserWindow): void {
  try {
    const isMaximized = win.isMaximized();
    const b = isMaximized ? win.getNormalBounds() : win.getBounds();
    writeFileSync(
      boundsPath,
      JSON.stringify(
        {
          width: b.width,
          height: b.height,
          x: b.x,
          y: b.y,
          isMaximized,
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch {
    // Non-fatal window bounds persistence failure.
  }
}

function isAllowedExternalUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

async function bootstrapDesktop(): Promise<void> {
  const dataDir =
    process.env['FORGEOPS_DATA_DIR'] ??
    join(app.getPath('userData'), 'forgeops-v2.2');
  mkdirSync(dataDir, {recursive: true});
  const boundsPath = join(dataDir, 'window-bounds.json');

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

  ipcMain.handle('forgeops:open-external', async (_ev, rawUrl: unknown) => {
    if (typeof rawUrl !== 'string' || !isAllowedExternalUrl(rawUrl)) {
      return false;
    }
    await shell.openExternal(rawUrl);
    return true;
  });

  const preloadPath = resolve(__dirname, 'preload.cjs');
  const savedBounds = loadWindowBounds(boundsPath);
  const useWinOverlay = process.platform === 'win32' && !isSmoke;

  mainWindow = new BrowserWindow({
    width: savedBounds.width,
    height: savedBounds.height,
    x: savedBounds.x,
    y: savedBounds.y,
    minWidth: 1180,
    minHeight: 720,
    show: !isSmoke,
    title: 'ForgeOps Console',
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    ...(useWinOverlay
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#ffffff',
            symbolColor: '#334155',
            height: 47,
          },
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      additionalArguments: [
        `--forgeops-api-url=${runtime.httpServer.apiBaseUrl}`,
        `--forgeops-token=${runtime.httpServer.sessionToken}`,
        `--forgeops-win-overlay=${useWinOverlay ? '1' : '0'}`,
      ],
    },
  });

  if (!isSmoke && savedBounds.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.on('close', () => {
    if (mainWindow && !isSmoke) {
      saveWindowBounds(boundsPath, mainWindow);
    }
  });

  const devUrl = process.env['FORGEOPS_RENDERER_DEV_URL'];

  // Quarantine external links to OS default browser; prevent webpage-like window navigation.
  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return {action: 'deny'};
  });

  mainWindow.webContents.on('will-navigate', (ev, targetUrl) => {
    if (devUrl && targetUrl.startsWith(devUrl)) {
      return;
    }
    if (targetUrl.startsWith('file://')) {
      return;
    }
    ev.preventDefault();
    if (isAllowedExternalUrl(targetUrl)) {
      void shell.openExternal(targetUrl);
    }
  });

  // Block accidental browser reload shortcuts in production DirectUI mode.
  if (!devUrl) {
    mainWindow.webContents.on('before-input-event', (ev, input) => {
      const key = input.key.toLowerCase();
      if (
        input.key === 'F5' ||
        ((input.control || input.meta) && key === 'r')
      ) {
        ev.preventDefault();
      }
    });
  }

  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    const htmlPath = resolve(__dirname, '../renderer/index.html');
    await mainWindow.loadFile(htmlPath);
  }

  if (isSmoke) {
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

if (!isSmoke && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    void bootstrapDesktop().catch(err => {
      const msg =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      process.stderr.write(`Fatal bootstrap error: ${msg}\n`);
      app.exit(1);
    });
  });
}

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
