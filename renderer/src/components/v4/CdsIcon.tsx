import type {CSSProperties, ReactElement, ReactNode} from 'react';
import {
  CDS_ANIMATION_AXES,
  CDS_SIZE_SPECS,
  cdsCodepoint,
  cdsOpticalWeight,
  type CdsIconSize,
} from './cds-icons-data.ts';
import fileIconSet from './file-type-icons.json';

export interface CdsIconProps {
  readonly name: string;
  readonly size?: CdsIconSize;
  readonly strong?: boolean;
  readonly anim?: boolean | string;
  readonly className?: string;
  readonly title?: string;
}

export function CdsIcon({
  name,
  size = 'small',
  strong = false,
  anim = false,
  className,
  title,
}: CdsIconProps): ReactElement {
  const code = cdsCodepoint(name) ?? 0xe018;
  const spec = CDS_SIZE_SPECS[size];
  const stroke =
    strong && spec.strong !== undefined ? spec.strong : spec.regular;
  const wght = cdsOpticalWeight(spec.px, stroke);
  const animAttr =
    typeof anim === 'string'
      ? anim
      : anim
        ? (CDS_ANIMATION_AXES[name] ?? 'ANIM')
        : undefined;
  const glyph = String.fromCodePoint(code);
  const style = {
    '--cds-wght': String(wght),
    '--cds-opsz': String(spec.px),
  } as CSSProperties;

  return (
    <span
      className={className ? `cds-icon ${className}` : 'cds-icon'}
      data-size={size}
      data-weight={strong ? 'strong' : undefined}
      data-cds-anim={animAttr}
      data-glyph={glyph}
      style={style}
      title={title}
      aria-hidden="true"
    />
  );
}

export interface StarburstMarkProps {
  readonly size?: number;
  readonly spinning?: boolean;
  readonly className?: string;
}

/** Authentic Claude starburst SVG path extracted from activity_marks.ts. */
export function StarburstMark({
  size = 20,
  spinning = false,
  className,
}: StarburstMarkProps): ReactElement {
  return (
    <span
      className={[
        'sd-starburst',
        spinning ? 'is-spinning' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{width: size, height: size}}
      aria-hidden="true"
    >
      <svg
        data-cds="Spark"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        width={size}
        height={size}
        fill="currentColor"
        stroke="none"
        aria-hidden="true"
      >
        <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z" />
      </svg>
    </span>
  );
}

type RawFileIconNode = [string, Record<string, string>, RawFileIconNode[]?];

interface ParsedFileIconSet {
  readonly defaultIcon: string;
  readonly fileNames: Readonly<Record<string, string>>;
  readonly fileExtensions: Readonly<Record<string, string>>;
  readonly icons: Readonly<Record<string, string>>;
  readonly palette: Readonly<Record<string, readonly [string, string]>>;
}

const typedFileIcons = fileIconSet as unknown as ParsedFileIconSet;
const parsedNodesCache = new Map<string, readonly RawFileIconNode[]>();

const CATEGORY_CDS_ICON: Readonly<Record<string, string>> = {
  Archive: 'Archive',
  Code: 'Code',
  Database: 'Database',
  Globe: 'Globe',
  Image: 'Image',
  Note: 'Note',
  Scroll: 'Scroll',
  Slides: 'Slides',
  Spreadsheet: 'Spreadsheet',
};

const CODE_EXTENSIONS = new Set(
  (
    'js.jsx.gs.ts.tsx.py.rb.go.rs.c.cpp.h.hpp.java.kt.swift.sh.bash.zsh.json.yaml.yml.toml.xml.html.css.scss.sql.graphql.proto.lua.r.' +
    'cs.vue.pl.php.htm.xhtml.' +
    'python.javascript.typescript.csharp.rust.ruby.kotlin.dart.scala.perl.elixir.haskell.clojure.groovy.less.plaintext'
  ).split('.'),
);

function fallbackCategory(name: string): string | undefined {
  const extension = name.includes('.') ? (name.split('.').pop() ?? '') : '';
  if (name.includes('SKILL.md') || ['skill', 'plugin'].includes(extension)) {
    return 'Scroll';
  }
  if (['md', 'markdown'].includes(extension)) {
    return 'Note';
  }
  if (['html', 'htm', 'xhtml'].includes(extension)) {
    return 'Globe';
  }
  if (
    ['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'tgz'].includes(extension)
  ) {
    return 'Archive';
  }
  if (['ppt', 'pptx'].includes(extension)) {
    return 'Slides';
  }
  if (['jsonl', 'parquet', 'db', 'sqlite', 'sqlite3'].includes(extension)) {
    return 'Database';
  }
  if (['csv', 'tsv', 'xls', 'xlsx'].includes(extension)) {
    return 'Spreadsheet';
  }
  if (CODE_EXTENSIONS.has(extension)) {
    return 'Code';
  }
  if (
    [
      'ico',
      'svg',
      'png',
      'jpg',
      'jpeg',
      'gif',
      'bmp',
      'webp',
      'mermaid',
      'mmd',
    ].includes(extension)
  ) {
    return 'Image';
  }
  return undefined;
}

function resolveColorToken(raw: string): string {
  if (!raw.startsWith('$')) {
    return raw;
  }
  const pair = typedFileIcons.palette[raw.slice(1)];
  if (!pair) {
    return 'currentColor';
  }
  return `light-dark(${pair[0]}, ${pair[1]})`;
}

function renderSvgNode(node: RawFileIconNode, key: number): ReactNode {
  const [tag, attrs, children] = node;
  const reactProps: Record<string, string | number> = {};
  for (const [attr, val] of Object.entries(attrs)) {
    const resolved =
      attr === 'fill' || attr === 'stroke' ? resolveColorToken(val) : val;
    if (attr === 'fill-rule') {
      reactProps['fillRule'] = resolved;
    } else if (attr === 'clip-rule') {
      reactProps['clipRule'] = resolved;
    } else if (attr === 'stroke-width') {
      reactProps['strokeWidth'] = resolved;
    } else if (attr === 'stroke-linecap') {
      reactProps['strokeLinecap'] = resolved;
    } else if (attr === 'stroke-linejoin') {
      reactProps['strokeLinejoin'] = resolved;
    } else {
      reactProps[attr] = resolved;
    }
  }
  const childElements = children?.map((c, idx) => renderSvgNode(c, idx));
  if (tag === 'path') {
    return (
      <path key={key} {...reactProps}>
        {childElements}
      </path>
    );
  }
  if (tag === 'circle') {
    return (
      <circle key={key} {...reactProps}>
        {childElements}
      </circle>
    );
  }
  if (tag === 'rect') {
    return (
      <rect key={key} {...reactProps}>
        {childElements}
      </rect>
    );
  }
  if (tag === 'polygon') {
    return (
      <polygon key={key} {...reactProps}>
        {childElements}
      </polygon>
    );
  }
  return (
    <g key={key} {...reactProps}>
      {childElements}
    </g>
  );
}

export interface FileTypeIconProps {
  readonly filename: string;
  readonly size?: number;
}

export function FileTypeIcon({
  filename,
  size = 14,
}: FileTypeIconProps): ReactElement {
  const baseName = filename.replace(/\\/g, '/').split('/').pop() ?? filename;
  const lower = baseName.toLowerCase();
  let iconId = Object.hasOwn(typedFileIcons.fileNames, lower)
    ? (typedFileIcons.fileNames[lower] ?? '')
    : '';
  for (
    let dot = lower.indexOf('.');
    !iconId && dot !== -1;
    dot = lower.indexOf('.', dot + 1)
  ) {
    const ext = lower.slice(dot + 1);
    if (Object.hasOwn(typedFileIcons.fileExtensions, ext)) {
      iconId = typedFileIcons.fileExtensions[ext] ?? '';
    }
  }

  if (!iconId) {
    const category = fallbackCategory(
      baseName.includes('SKILL.md') ? baseName : lower,
    );
    if (category && CATEGORY_CDS_ICON[category]) {
      return (
        <CdsIcon
          name={CATEGORY_CDS_ICON[category]}
          size={size <= 13 ? 'xs' : 'small'}
        />
      );
    }
  }

  const finalId = iconId || typedFileIcons.defaultIcon;
  let nodes = parsedNodesCache.get(finalId);
  if (!nodes) {
    const rawJson =
      typedFileIcons.icons[finalId] ?? typedFileIcons.icons['default'];
    nodes = rawJson ? (JSON.parse(rawJson) as RawFileIconNode[]) : [];
    parsedNodesCache.set(finalId, nodes);
  }

  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="none"
      aria-hidden="true"
      style={{flex: 'none'}}
    >
      {nodes.map((node, idx) => renderSvgNode(node, idx))}
    </svg>
  );
}
