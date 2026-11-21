/**
 * Hardened Electron Preload Bridge (`contextIsolation: true`, `sandbox: true`).
 * Exposes ONLY the authenticated loopback API base URL, per-launch session
 * token, and native directory picker IPC.
 */

import {contextBridge, ipcRenderer} from 'electron';
import type {ForgePreloadBridge} from '../shared/api.ts';

interface BridgeConfigPayload {
  readonly apiBaseUrl?: string;
  readonly sessionToken?: string;
  readonly hasNativeTitlebarOverlay?: boolean;
}

const config = ipcRenderer.sendSync(
  'forgeops:get-bridge-config',
) as BridgeConfigPayload | null;

const bridge: ForgePreloadBridge = {
  apiBaseUrl: config?.apiBaseUrl ?? '',
  sessionToken: config?.sessionToken ?? '',
  hasNativeTitlebarOverlay: Boolean(config?.hasNativeTitlebarOverlay),
  pickDirectory: () => ipcRenderer.invoke('forgeops:pick-directory'),
  openExternal: (url: string) =>
    ipcRenderer.invoke('forgeops:open-external', url),
  openPath: (targetPath: string) =>
    ipcRenderer.invoke('forgeops:open-path', targetPath),
  openInEditor: (targetPath: string) =>
    ipcRenderer.invoke('forgeops:open-in-editor', targetPath),
};

contextBridge.exposeInMainWorld('forgeops', bridge);
