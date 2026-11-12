import type {ReactElement} from 'react';

interface IconProps {
  readonly size?: number;
  readonly className?: string;
}

const baseProps = (size = 15, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.85,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
});

export function CpuIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
    </svg>
  );
}

export function BriefcaseIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

export function GridIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function ZapIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

export function SparklesIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
      <path d="M5 3v4M3 5h4M19 17v4M17 19h4" />
    </svg>
  );
}

export function BoxIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  );
}

export function PlugIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12 22v-5" />
      <path d="M9 8V2M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );
}

export function WifiIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <circle cx="12" cy="20" r="1" fill="currentColor" />
    </svg>
  );
}

export function RadioIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="2" />
      <path d="M4.93 19.07a10 10 0 0 1 0-14.14M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M7.76 16.24a6 6 0 0 1 0-8.49M16.24 7.76a6 6 0 0 1 0 8.49" />
    </svg>
  );
}

export function UsersIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function CalendarIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <circle cx="16" cy="16" r="2" />
    </svg>
  );
}

export function ActivityIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

export function SettingsIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.02 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function GlobeIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
    </svg>
  );
}

export function ShieldIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  );
}

export function SearchIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function EyeIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function PlayIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

export function AlertTriangleIcon({
  size = 14,
  className,
}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export function GitBranchIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

export function CheckCircleIcon({
  size = 15,
  className,
}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="m8.5 12.5 2.3 2.3 4.8-5" />
    </svg>
  );
}

export function CircleIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function ChevronDownIcon({
  size = 14,
  className,
}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({
  size = 14,
  className,
}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function ChevronUpIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

export function PanelLeftCloseIcon({
  size = 15,
  className,
}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M9 3v18M15 15l-3-3 3-3" />
    </svg>
  );
}

export function RefreshIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export function FileTextIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

export function BookOpenIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

export function HelpCircleIcon({
  size = 14,
  className,
}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
    </svg>
  );
}

export function GithubIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

export function TrashIcon({size = 13, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function InfoIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

export function SlidersIcon({size = 13, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="2" y1="14" x2="6" y2="14" />
      <line x1="10" y1="8" x2="14" y2="8" />
      <line x1="18" y1="16" x2="22" y2="16" />
    </svg>
  );
}

export function PlusIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ArchiveIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="2" y="4" width="20" height="5" rx="1" />
      <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M10 13h4" />
    </svg>
  );
}

export function ArrowLeftIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function TerminalIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

/**
 * Cute geometric robot avatars matching the Agents Market cards & Profile view.
 */
export function RobotAvatar(props: {
  readonly seed: string;
  readonly size?: number;
}): ReactElement {
  const {seed, size = 64} = props;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const variant = hash % 5;

  if (variant === 0) {
    // Lavender-indigo bot (Alice style)
    return (
      <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
        <circle cx="40" cy="42" r="34" fill="#eef2ff" />
        <rect x="14" y="34" width="6" height="14" rx="3" fill="#6366f1" />
        <rect x="60" y="34" width="6" height="14" rx="3" fill="#6366f1" />
        <rect
          x="18"
          y="22"
          width="44"
          height="38"
          rx="11"
          fill="#7c83db"
          stroke="#5b62b8"
          strokeWidth="2"
        />
        <path
          d="M28 36l5 5m0-5-5 5M47 36l5 5m0-5-5 5"
          stroke="#1e1b4b"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M31 50h18M34 48v4M38 48v4M42 48v4M46 48v4"
          stroke="#1e1b4b"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (variant === 1) {
    // Mint-cyan twin-antenna bot (Timi style)
    return (
      <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
        <circle cx="40" cy="42" r="34" fill="#ecfeff" />
        <path
          d="M28 22l-3-8M52 22l3-8"
          stroke="#5eead4"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx="25" cy="13" r="3" fill="#2dd4bf" />
        <circle cx="55" cy="13" r="3" fill="#2dd4bf" />
        <rect x="13" y="35" width="6" height="12" rx="3" fill="#5eead4" />
        <rect x="61" y="35" width="6" height="12" rx="3" fill="#5eead4" />
        <rect
          x="18"
          y="22"
          width="44"
          height="38"
          rx="11"
          fill="#81e6d9"
          stroke="#38b2ac"
          strokeWidth="2"
        />
        <circle
          cx="31"
          cy="38"
          r="5"
          fill="#ffffff"
          stroke="#134e4a"
          strokeWidth="2"
        />
        <circle cx="31" cy="38" r="2" fill="#134e4a" />
        <circle
          cx="49"
          cy="38"
          r="5"
          fill="#ffffff"
          stroke="#134e4a"
          strokeWidth="2"
        />
        <circle cx="49" cy="38" r="2" fill="#134e4a" />
        <rect x="35" y="48" width="10" height="5" rx="2.5" fill="#134e4a" />
      </svg>
    );
  }

  if (variant === 2) {
    // Teal cyber-visor QA bot (Bob style)
    return (
      <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
        <circle cx="40" cy="42" r="34" fill="#f0fdfa" />
        <rect x="31" y="16" width="18" height="6" rx="3" fill="#5eead4" />
        <rect x="14" y="35" width="6" height="13" rx="3" fill="#64748b" />
        <rect x="60" y="35" width="6" height="13" rx="3" fill="#64748b" />
        <rect
          x="18"
          y="22"
          width="44"
          height="38"
          rx="10"
          fill="#88d8d0"
          stroke="#4fd1c5"
          strokeWidth="2"
        />
        <rect
          x="23"
          y="31"
          width="34"
          height="14"
          rx="4"
          fill="#334155"
          stroke="#e2e8f0"
          strokeWidth="1.6"
        />
        <circle cx="32" cy="38" r="2.3" fill="#38bdf8" />
        <circle cx="48" cy="38" r="2.3" fill="#38bdf8" />
        <path
          d="M36 51h8"
          stroke="#1e293b"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (variant === 3) {
    // Amber-gold sovereign bot with glowing crimson visor (Profile Yellow style)
    return (
      <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
        <circle cx="40" cy="42" r="34" fill="#fefce8" />
        <polygon points="40,11 34,23 45,23" fill="#eab308" />
        <rect x="13" y="34" width="6" height="14" rx="3" fill="#ca8a04" />
        <rect x="61" y="34" width="6" height="14" rx="3" fill="#ca8a04" />
        <rect
          x="18"
          y="22"
          width="44"
          height="38"
          rx="11"
          fill="#e3b341"
          stroke="#b7791f"
          strokeWidth="2"
        />
        <rect x="23" y="31" width="34" height="13" rx="4" fill="#3f2e21" />
        <rect x="26" y="34" width="28" height="7" rx="2.5" fill="#ef4444" />
        <path
          d="M32 51v3M36 51v3M40 51v3M44 51v3M48 51v3"
          stroke="#451a03"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  // Emerald design bot (三公公 style)
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      <circle cx="40" cy="42" r="34" fill="#f0fdf4" />
      <line x1="40" y1="13" x2="40" y2="22" stroke="#4ade80" strokeWidth="3" />
      <circle cx="40" cy="12" r="3.5" fill="#86efac" />
      <rect x="14" y="35" width="6" height="12" rx="3" fill="#4ade80" />
      <rect x="60" y="35" width="6" height="12" rx="3" fill="#4ade80" />
      <rect
        x="18"
        y="22"
        width="44"
        height="38"
        rx="11"
        fill="#5cc96e"
        stroke="#2f9e44"
        strokeWidth="2"
      />
      <rect x="25" y="32" width="30" height="11" rx="5.5" fill="#14532d" />
      <circle cx="33" cy="37.5" r="3.2" fill="#ffffff" />
      <circle cx="33" cy="37.5" r="1.4" fill="#14532d" />
      <circle cx="47" cy="37.5" r="3.2" fill="#ffffff" />
      <circle cx="47" cy="37.5" r="1.4" fill="#14532d" />
      <path
        d="M34 50v3M38 50v3M42 50v3M46 50v3"
        stroke="#14532d"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
