/**
 * Hardened Electron Preload Bridge (`contextIsolation: true`, `sandbox: true`).
 * Exposes ONLY the authenticated loopback API base URL, per-launch session
 * token, and native directory picker IPC.
 */

import {contextBridge, ipcRenderer} from 'electron';
import type {ForgePreloadBridge} from '../shared/api.ts';

function readArgValue(prefix: string): string {
  const hit = process.argv.find(arg => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

const bridge: ForgePreloadBridge = {
  apiBaseUrl: readArgValue('--forgeops-api-url='),
  sessionToken: readArgValue('--forgeops-token='),
  hasNativeTitlebarOverlay: readArgValue('--forgeops-win-overlay=') === '1',
  pickDirectory: () => ipcRenderer.invoke('forgeops:pick-directory'),
  openExternal: (url: string) =>
    ipcRenderer.invoke('forgeops:open-external', url),
};

contextBridge.exposeInMainWorld('forgeops', bridge);
