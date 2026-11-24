/**
 * Electron 44 Desktop Main Process:
 * Boots `ForgeRuntime` on loopback, enforces hardened WebPreferences
 * (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`),
 * native frameless DirectUI titlebar overlay, window-bounds persistence,
 * single-instance lock, external URL quarantine, and `FORGEOPS_SMOKE_EXIT=1`.
 */

import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell,
  type WebFrameMain,
} from 'electron';
import {ForgeRuntime} from '../server/runtime.ts';
import {registerElectronSafeStorage} from '../server/secret-vault.ts';

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
const smokeScreenshotPath = process.env['FORGEOPS_SMOKE_SCREENSHOT'] ?? '';
const showOnSmoke = process.env['FORGEOPS_SMOKE_SHOW'] === '1';

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

function validateAllowedLocalPath(rawPath: unknown): string | null {
  if (!runtime || typeof rawPath !== 'string' || !rawPath.trim()) {
    return null;
  }
  const roots = [
    runtime.worktreesRoot,
    ...runtime.store.listRepositories().map(r => r.localPath),
  ];
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    try {
      const resolved = runtime.worktrees.resolveInside(root, rawPath, {
        allowDotGit: false,
      });
      if (existsSync(resolved)) {
        return resolved;
      }
    } catch {
      // Try next allowed root.
    }
  }
  return null;
}

async function tryLaunchVsCode(targetPath: string): Promise<boolean> {
  if (!runtime) return false;
  let exe = runtime.runner.resolveExecutable('code');
  if (
    exe &&
    process.platform === 'win32' &&
    exe.toLowerCase().endsWith('code.cmd')
  ) {
    const winExe = resolve(dirname(exe), '../Code.exe');
    exe = existsSync(winExe) ? winExe : null;
  }
  if (!exe) {
    return false;
  }
  return new Promise(resolveSpawn => {
    let settled = false;
    try {
      const child = spawn(exe, [targetPath], {
        shell: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', () => {
        if (!settled) {
          settled = true;
          resolveSpawn(false);
        }
      });
      child.unref();
      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolveSpawn(true);
        }
      }, 250);
    } catch {
      resolveSpawn(false);
    }
  });
}

function isTrustedSenderFrame(
  senderFrame: WebFrameMain | null,
  allowedFileUrl: string,
  allowedDevOrigin: string | null,
): boolean {
  const frameUrl = senderFrame?.url;
  if (!frameUrl) {
    return false;
  }
  if (allowedDevOrigin) {
    try {
      return new URL(frameUrl).origin === allowedDevOrigin;
    } catch {
      return false;
    }
  }
  const baseFrameUrl = frameUrl.split('#')[0] ?? frameUrl;
  if (process.platform === 'win32') {
    return baseFrameUrl.toLowerCase() === allowedFileUrl.toLowerCase();
  }
  return baseFrameUrl === allowedFileUrl;
}

async function stopRuntimeQuietly(): Promise<void> {
  if (!runtime) {
    return;
  }
  const toStop = runtime;
  runtime = null;
  await toStop.stop().catch(() => undefined);
}

async function bootstrapDesktop(): Promise<void> {
  const dataDir =
    process.env['FORGEOPS_DATA_DIR'] ??
    join(app.getPath('userData'), 'forgeops-v2.2');
  mkdirSync(dataDir, {recursive: true});
  const boundsPath = join(dataDir, 'window-bounds.json');

  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => {
    cb(false);
  });

  registerElectronSafeStorage(safeStorage);
  runtime = new ForgeRuntime({dataDir});
  await runtime.start();

  // Kick off non-blocking Environment Doctor probe in background.
  void runtime.steward.runEnvironmentDoctor().catch(() => undefined);

  const devUrl = process.env['FORGEOPS_RENDERER_DEV_URL'];
  const htmlPath = resolve(__dirname, '../renderer/index.html');
  const allowedFileUrl = pathToFileURL(htmlPath).href;
  const allowedDevOrigin = devUrl ? new URL(devUrl).origin : null;
  const useWinOverlay = process.platform === 'win32' && !isSmoke;

  ipcMain.on('forgeops:get-bridge-config', ev => {
    if (
      !runtime ||
      !isTrustedSenderFrame(ev.senderFrame, allowedFileUrl, allowedDevOrigin)
    ) {
      ev.returnValue = null;
      return;
    }
    ev.returnValue = {
      apiBaseUrl: runtime.httpServer.apiBaseUrl,
      sessionToken: runtime.httpServer.sessionToken,
      hasNativeTitlebarOverlay: useWinOverlay,
    };
  });

  ipcMain.handle('forgeops:pick-directory', async ev => {
    if (
      !mainWindow ||
      !isTrustedSenderFrame(ev.senderFrame, allowedFileUrl, allowedDevOrigin)
    ) {
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

  ipcMain.handle('forgeops:open-external', async (ev, rawUrl: unknown) => {
    if (
      !isTrustedSenderFrame(ev.senderFrame, allowedFileUrl, allowedDevOrigin) ||
      typeof rawUrl !== 'string' ||
      !isAllowedExternalUrl(rawUrl)
    ) {
      return false;
    }
    await shell.openExternal(rawUrl);
    return true;
  });

  ipcMain.handle('forgeops:open-path', async (ev, rawPath: unknown) => {
    if (
      !isTrustedSenderFrame(ev.senderFrame, allowedFileUrl, allowedDevOrigin)
    ) {
      return false;
    }
    const valid = validateAllowedLocalPath(rawPath);
    if (!valid) {
      return false;
    }
    const err = await shell.openPath(valid);
    return err === '';
  });

  ipcMain.handle('forgeops:open-in-editor', async (ev, rawPath: unknown) => {
    if (
      !isTrustedSenderFrame(ev.senderFrame, allowedFileUrl, allowedDevOrigin)
    ) {
      return {ok: false, editor: 'none'};
    }
    const valid = validateAllowedLocalPath(rawPath);
    if (!valid) {
      return {ok: false, editor: 'none'};
    }
    const openedCode = await tryLaunchVsCode(valid);
    if (openedCode) {
      return {ok: true, editor: 'vscode'};
    }
    const err = await shell.openPath(valid);
    return {ok: err === '', editor: 'explorer'};
  });

  ipcMain.handle(
    'forgeops:set-window-theme',
    (ev, rawTheme: unknown): boolean => {
      if (
        !mainWindow ||
        !isTrustedSenderFrame(ev.senderFrame, allowedFileUrl, allowedDevOrigin)
      ) {
        return false;
      }
      const dark = rawTheme === 'dark';
      mainWindow.setBackgroundColor(dark ? '#0B0B0A' : '#FFFFFF');
      if (
        useWinOverlay &&
        typeof mainWindow.setTitleBarOverlay === 'function'
      ) {
        mainWindow.setTitleBarOverlay({
          color: dark ? '#0B0B0A' : '#FFFFFF',
          symbolColor: dark ? '#ECEBE7' : '#3D3D3A',
          height: 36,
        });
      }
      return true;
    },
  );

  const preloadPath = resolve(__dirname, 'preload.cjs');
  const savedBounds = loadWindowBounds(boundsPath);

  mainWindow = new BrowserWindow({
    width: savedBounds.width,
    height: savedBounds.height,
    x: savedBounds.x,
    y: savedBounds.y,
    minWidth: 1180,
    minHeight: 720,
    show: !isSmoke || showOnSmoke,
    title: 'SDLC-Studio — ForgeOps Collaborative IDE',
    backgroundColor: '#FFFFFF',
    autoHideMenuBar: true,
    ...(useWinOverlay
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#FFFFFF',
            symbolColor: '#3D3D3A',
            height: 36,
          },
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
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

  // Quarantine external links to OS default browser; prevent webpage-like window navigation.
  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return {action: 'deny'};
  });

  mainWindow.webContents.on('will-navigate', (ev, targetUrl) => {
    if (allowedDevOrigin) {
      try {
        if (new URL(targetUrl).origin === allowedDevOrigin) {
          return;
        }
      } catch {
        // Fall through to prevent navigation.
      }
    } else if (
      process.platform === 'win32'
        ? (targetUrl.split('#')[0] ?? targetUrl).toLowerCase() ===
          allowedFileUrl.toLowerCase()
        : (targetUrl.split('#')[0] ?? targetUrl) === allowedFileUrl
    ) {
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

  const smokeHash = isSmoke
    ? (process.env['FORGEOPS_SMOKE_HASH'] ?? '').trim().replace(/^#/, '')
    : '';
  if (devUrl) {
    await mainWindow.loadURL(smokeHash ? `${devUrl}#${smokeHash}` : devUrl);
  } else {
    await mainWindow.loadFile(
      htmlPath,
      smokeHash ? {hash: smokeHash} : undefined,
    );
  }

  if (isSmoke) {
    const smokeDelayMs = Math.max(
      500,
      Math.min(
        15_000,
        Number.parseInt(process.env['FORGEOPS_SMOKE_DELAY_MS'] ?? '2000', 10) ||
          2000,
      ),
    );
    setTimeout(() => {
      void (async () => {
        try {
          const domText = (await mainWindow?.webContents.executeJavaScript(
            'document.body ? document.body.innerText : ""',
          )) as string;
          const loadedFonts = (await mainWindow?.webContents.executeJavaScript(
            'Array.from(new Set(Array.from(document.fonts).filter(f => f.status === "loaded").map(f => f.family))).join(",")',
          )) as string;
          process.stdout.write(`[forgeops:smoke] fonts=${loadedFonts}\n`);
          if (smokeScreenshotPath && mainWindow) {
            mkdirSync(dirname(smokeScreenshotPath), {recursive: true});
            const image = await mainWindow.webContents.capturePage();
            writeFileSync(smokeScreenshotPath, image.toPNG());
          }
          const ok =
            domText.includes('SDLC-Studio') ||
            domText.includes('ForgeOps') ||
            domText.includes('新建协同会话') ||
            domText.includes('团队角色');
          process.stdout.write(
            `FORGEOPS_ELECTRON_SMOKE_OK:${ok}:${domText.slice(0, 120).replace(/\s+/g, ' ')}\n`,
          );
          if (!ok) {
            await stopRuntimeQuietly();
            app.exit(2);
            return;
          }
        } finally {
          app.quit();
        }
      })();
    }, smokeDelayMs);
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
    void bootstrapDesktop().catch(async err => {
      const msg =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      process.stderr.write(`Fatal bootstrap error: ${msg}\n`);
      await stopRuntimeQuietly();
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
