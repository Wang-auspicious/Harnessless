import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import type {ProviderSecretResolved} from '../adapters/contracts.ts';
import type {ForgeStore} from '../store/database.ts';

export interface ElectronSafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

let registeredSafeStorage: ElectronSafeStorageAdapter | null = null;

export function registerElectronSafeStorage(
  adapter: ElectronSafeStorageAdapter | null,
): void {
  registeredSafeStorage = adapter;
}

interface VaultDiskPayload {
  readonly keys?: Record<string, string>;
  readonly encryptedKeys?: Record<string, string>;
}

const CLEARED_SENTINEL = '__CLEARED__';

const ENV_FALLBACK_BY_PROVIDER: Readonly<Record<string, string>> = {
  'opencode-go': 'OPENCODE_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

function readOpencodeAuthKey(): string | null {
  if (
    process.env['FORGEOPS_OFFLINE_VERIFY'] === '1' ||
    process.env['ORCH_OFFLINE_VERIFY'] === '1'
  ) {
    return null;
  }
  const dataRoot =
    process.env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share');
  const authPath = join(dataRoot, 'opencode', 'auth.json');
  if (!existsSync(authPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(authPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const goEntry = parsed['opencode-go'] ?? parsed['opencode'];
    if (goEntry && typeof goEntry === 'object') {
      const key =
        (goEntry as Record<string, unknown>)['key'] ??
        (goEntry as Record<string, unknown>)['apiKey'];
      if (typeof key === 'string' && key.trim().length > 0) {
        return key.trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

export class HostSecretVault {
  private readonly filePath: string;
  private keys: Record<string, string> = {};

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }
    try {
      const parsed = JSON.parse(
        readFileSync(this.filePath, 'utf8'),
      ) as Partial<VaultDiskPayload>;
      const loaded: Record<string, string> = {};
      if (parsed.keys && typeof parsed.keys === 'object') {
        Object.assign(loaded, parsed.keys);
      }
      if (
        parsed.encryptedKeys &&
        typeof parsed.encryptedKeys === 'object' &&
        registeredSafeStorage?.isEncryptionAvailable()
      ) {
        for (const [providerId, cipherB64] of Object.entries(
          parsed.encryptedKeys,
        )) {
          if (typeof cipherB64 !== 'string' || !cipherB64) {
            continue;
          }
          try {
            loaded[providerId] = registeredSafeStorage.decryptString(
              Buffer.from(cipherB64, 'base64'),
            );
          } catch {
            // Skip unreadable entry.
          }
        }
      }
      this.keys = loaded;
    } catch {
      this.keys = {};
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), {recursive: true});
    let payload: VaultDiskPayload;
    if (registeredSafeStorage?.isEncryptionAvailable()) {
      const encryptedKeys: Record<string, string> = {};
      for (const [providerId, value] of Object.entries(this.keys)) {
        encryptedKeys[providerId] = registeredSafeStorage
          .encryptString(value)
          .toString('base64');
      }
      payload = {encryptedKeys};
    } else {
      payload = {keys: this.keys};
    }
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(tmpPath, JSON.stringify(payload, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(tmpPath, this.filePath);
    } catch (err) {
      rmSync(tmpPath, {force: true});
      throw err;
    }
  }

  setApiKey(providerId: string, rawKey: string): void {
    const trimmed = rawKey.trim();
    if (trimmed.length === 0) {
      this.keys[providerId] = CLEARED_SENTINEL;
    } else {
      this.keys[providerId] = trimmed;
    }
    this.persist();
  }

  getKeyStatus(providerId: string): {
    readonly hasApiKey: boolean;
    readonly maskedKeyHint: string;
  } {
    const raw = this.getRawApiKey(providerId);
    if (!raw) {
      return {hasApiKey: false, maskedKeyHint: 'Not configured'};
    }
    const suffix = raw.slice(-4);
    const prefix = raw.slice(0, Math.min(4, raw.length));
    return {
      hasApiKey: true,
      maskedKeyHint: `${prefix}••••••••${suffix}`,
    };
  }

  getRawApiKey(providerId: string): string | null {
    const explicit = this.keys[providerId];
    if (explicit === CLEARED_SENTINEL) {
      return null;
    }
    if (explicit && explicit.length > 0) {
      return explicit;
    }
    const envVar = ENV_FALLBACK_BY_PROVIDER[providerId];
    if (envVar && process.env[envVar]) {
      return process.env[envVar] ?? null;
    }
    if (providerId === 'opencode-go') {
      return readOpencodeAuthKey();
    }
    return null;
  }

  resolveProviderForModel(
    store: ForgeStore,
    requestedModel: string,
  ): ProviderSecretResolved | null {
    const trimmed = requestedModel.trim();
    if (!trimmed) {
      return null;
    }
    const lower = trimmed.toLowerCase();
    const providers = store.listModelProviders(id => this.getKeyStatus(id));

    let matched =
      providers.find(p => p.id.toLowerCase() === lower) ??
      providers.find(p => p.models.some(m => m.id.toLowerCase() === lower));

    if (!matched && lower.includes('/')) {
      const [prefix, modelRest] = lower.split('/', 2);
      matched =
        providers.find(p => p.id.toLowerCase() === prefix) ??
        (modelRest
          ? providers.find(p =>
              p.models.some(m => m.id.toLowerCase() === modelRest),
            )
          : undefined);
      if (!matched) {
        return null;
      }
    }

    if (!matched) {
      if (lower.startsWith('claude')) {
        matched = providers.find(p => p.id === 'anthropic');
      } else if (lower.startsWith('gpt') || /^o[134](?:$|[-_])/i.test(lower)) {
        matched = providers.find(p => p.id === 'openai');
      } else if (lower.startsWith('glm') || lower.startsWith('kimi')) {
        matched = providers.find(p => p.id === 'opencode-go');
      } else if (lower.startsWith('deepseek')) {
        matched = providers.find(p => p.id === 'deepseek');
      }
    }

    if (!matched) {
      return null;
    }
    return {
      providerId: matched.id,
      protocol: matched.protocol,
      baseUrl: matched.baseUrl,
      apiKey: this.getRawApiKey(matched.id),
      models: matched.models,
    };
  }
}
