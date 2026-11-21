import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import type {ProviderSecretResolved} from '../adapters/contracts.ts';
import type {ForgeStore} from '../store/database.ts';

interface VaultDiskPayload {
  readonly keys: Record<string, string>;
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
      if (parsed.keys && typeof parsed.keys === 'object') {
        this.keys = {...parsed.keys};
      }
    } catch {
      this.keys = {};
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), {recursive: true});
    const payload: VaultDiskPayload = {keys: this.keys};
    writeFileSync(this.filePath, JSON.stringify(payload, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
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
    const providers = store.listModelProviders(id => this.getKeyStatus(id));
    const matched =
      providers.find(p => p.id === requestedModel) ??
      providers.find(p => p.models.some(m => m.id === requestedModel)) ??
      (requestedModel.startsWith('claude')
        ? providers.find(p => p.id === 'anthropic')
        : requestedModel.startsWith('gpt')
          ? providers.find(p => p.id === 'openai')
          : requestedModel.startsWith('glm') ||
              requestedModel.startsWith('kimi')
            ? providers.find(p => p.id === 'opencode-go')
            : providers.find(p => p.id === 'deepseek')) ??
      providers[0];
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
