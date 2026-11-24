import type {ReactElement} from 'react';
import agyLogo from '../../assets/agents/agy.svg';
import aiderLogo from '../../assets/agents/aider.svg';
import claudeCodeLogo from '../../assets/agents/claude-code.svg';
import claudeLogo from '../../assets/agents/claude.svg';
import codexLogo from '../../assets/agents/codex.svg';
import copilotDarkLogo from '../../assets/agents/copilot-dark.svg';
import copilotLightLogo from '../../assets/agents/copilot-light.svg';
import cursorDarkLogo from '../../assets/agents/cursor-dark.svg';
import cursorLightLogo from '../../assets/agents/cursor-light.svg';
import deepseekDarkLogo from '../../assets/agents/deepseek-harness-dark.svg';
import deepseekLightLogo from '../../assets/agents/deepseek-harness-light.svg';
import geminiLogo from '../../assets/agents/gemini.svg';
import opencodeDarkLogo from '../../assets/agents/opencode-dark.svg';
import opencodeLightLogo from '../../assets/agents/opencode-light.svg';
import piDarkLogo from '../../assets/agents/pi-dark.svg';
import piLightLogo from '../../assets/agents/pi-light.svg';
import qwenDarkLogo from '../../assets/agents/qwen-dark.svg';
import qwenLightLogo from '../../assets/agents/qwen-light.svg';
import antigravityAppLogo from '../../assets/apps/antigravity.svg';
import figmaAppLogo from '../../assets/apps/figma-icon.svg';
import linearAppLogo from '../../assets/apps/linear-icon.svg';
import slackAppLogo from '../../assets/apps/slack-icon.svg';
import vscodeAppLogo from '../../assets/apps/vscode.svg';
import type {KernelId} from '../../api/v4-types.ts';
import {StarburstMark} from './CdsIcon.tsx';

export type AgentBrandId =
  | KernelId
  | 'human'
  | 'cursor'
  | 'agy'
  | 'aider'
  | 'copilot'
  | 'deepseek'
  | 'qwen';

export type AppBrandId =
  'vscode' | 'cursor' | 'antigravity' | 'slack' | 'linear' | 'figma' | 'github';

const GITHUB_MARK_PATH =
  'M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.38 7.86 10.9.58.1.79-.25.79-.56v-2.15c-3.2.7-3.88-1.37-3.88-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.29 1.19-3.1-.12-.3-.52-1.47.11-3.05 0 0 .97-.31 3.18 1.18A10.96 10.96 0 0 1 12 5.99c.98 0 1.97.13 2.9.38 2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.07.78 2.16v3.2c0 .31.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z';

export function GitHubIcon({
  size = 16,
  className = '',
}: {
  readonly size?: number;
  readonly className?: string;
}): ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={GITHUB_MARK_PATH} />
    </svg>
  );
}

function resolveAgentAsset(
  id: AgentBrandId,
  theme: 'light' | 'dark',
): string | null {
  switch (id) {
    case 'claude-code':
      return claudeCodeLogo;
    case 'codex':
      return codexLogo;
    case 'gemini-cli':
      return geminiLogo;
    case 'opencode':
      return theme === 'dark' ? opencodeDarkLogo : opencodeLightLogo;
    case 'pi':
      return theme === 'dark' ? piDarkLogo : piLightLogo;
    case 'native-api':
    case 'agy':
      return agyLogo;
    case 'cursor':
      return theme === 'dark' ? cursorDarkLogo : cursorLightLogo;
    case 'aider':
      return aiderLogo;
    case 'copilot':
      return theme === 'dark' ? copilotDarkLogo : copilotLightLogo;
    case 'deepseek':
      return theme === 'dark' ? deepseekDarkLogo : deepseekLightLogo;
    case 'qwen':
      return theme === 'dark' ? qwenDarkLogo : qwenLightLogo;
    default:
      return null;
  }
}

export interface AgentBrandIconProps {
  readonly kernelId: AgentBrandId;
  readonly theme?: 'light' | 'dark';
  readonly size?: number;
  readonly status?:
    | 'ready'
    | 'builtin'
    | 'running'
    | 'awaiting'
    | 'degraded'
    | 'missing'
    | 'offline';
  readonly framed?: boolean;
  readonly className?: string;
}

export function AgentBrandIcon({
  kernelId,
  theme = 'light',
  size = 18,
  status,
  framed = false,
  className = '',
}: AgentBrandIconProps): ReactElement {
  if (kernelId === 'human') {
    return (
      <span
        className={`sd-agent-avatar is-human ${className}`}
        style={{width: size, height: size, fontSize: Math.round(size * 0.46)}}
        aria-hidden="true"
      >
        Z
      </span>
    );
  }

  const innerSize = framed ? Math.max(12, Math.round(size * 0.68)) : size;
  const asset = resolveAgentAsset(kernelId, theme);

  const glyph =
    kernelId === 'master' ? (
      <img
        src={claudeLogo}
        alt=""
        width={innerSize}
        height={innerSize}
        className="sd-agent-svg"
        draggable={false}
      />
    ) : asset ? (
      <img
        src={asset}
        alt=""
        width={innerSize}
        height={innerSize}
        className="sd-agent-svg"
        draggable={false}
      />
    ) : (
      <StarburstMark size={innerSize} />
    );

  const statusColor =
    status === 'ready' || status === 'builtin'
      ? 'var(--mp-git-added)'
      : status === 'running'
        ? 'var(--mp-clay)'
        : status === 'awaiting' || status === 'degraded'
          ? '#D99B00'
          : status === 'missing' || status === 'offline'
            ? 'var(--mp-text-muted)'
            : null;

  return (
    <span
      className={`sd-agent-avatar ${framed ? 'is-framed' : ''} ${className}`}
      style={{width: size, height: size}}
      aria-hidden="true"
    >
      {glyph}
      {statusColor ? (
        <span
          className="sd-agent-status-dot"
          style={{background: statusColor}}
        />
      ) : null}
    </span>
  );
}

export function AppBrandIcon({
  app,
  theme = 'light',
  size = 18,
}: {
  readonly app: AppBrandId;
  readonly theme?: 'light' | 'dark';
  readonly size?: number;
}): ReactElement {
  if (app === 'github') {
    return <GitHubIcon size={size} />;
  }
  const srcMap: Record<Exclude<AppBrandId, 'github'>, string> = {
    vscode: vscodeAppLogo,
    cursor: theme === 'dark' ? cursorDarkLogo : cursorLightLogo,
    antigravity: antigravityAppLogo,
    slack: slackAppLogo,
    linear: linearAppLogo,
    figma: figmaAppLogo,
  };
  return (
    <img
      src={srcMap[app]}
      alt=""
      width={size}
      height={size}
      className="sd-agent-svg"
      draggable={false}
    />
  );
}
