/**
 * Host-isolated Secret Vault:
 * Persists provider API keys outside SQLite transcripts and never returns raw
 * secret values to the Renderer or un-allowlisted child processes.
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import type {ProviderSecretResolved} from '../adapters/contracts.ts';
import type {ForgeStore} from '../store/database.ts';

interface VaultDiskPayload {
  readonly keys: Record<string, string>;
}

const ENV_FALLBACK_BY_PROVIDER: Readonly<Record<string, string>> = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

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
      delete this.keys[providerId];
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
    if (explicit && explicit.length > 0) {
      return explicit;
    }
    const envVar = ENV_FALLBACK_BY_PROVIDER[providerId];
    if (envVar && process.env[envVar]) {
      return process.env[envVar] ?? null;
    }
    return null;
  }

  resolveProviderForModel(
    store: ForgeStore,
    requestedModel: string,
  ): ProviderSecretResolved | null {
    const providers = store.listModelProviders(id => this.getKeyStatus(id));
    const matched =
      providers.find(p => p.models.some(m => m.id === requestedModel)) ??
      (requestedModel.startsWith('claude')
        ? providers.find(p => p.id === 'anthropic')
        : requestedModel.startsWith('gpt')
          ? providers.find(p => p.id === 'openai')
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
    };
  }
}
