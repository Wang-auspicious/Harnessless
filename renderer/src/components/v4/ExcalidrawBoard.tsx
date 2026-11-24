import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {Excalidraw, convertToExcalidrawElements} from '@excalidraw/excalidraw';
import type {ExcalidrawElementSkeleton} from '@excalidraw/excalidraw/data/transform';
import type {OrderedExcalidrawElement} from '@excalidraw/excalidraw/element/types';
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import type {
  ArtifactPin,
  BoardEdgeDoc,
  BoardNodeDoc,
  BoardSceneDoc,
} from '../../api/v4-types.ts';
import {CdsIcon} from './CdsIcon.tsx';

class CanvasErrorBoundary extends Component<
  {readonly children: ReactNode},
  {readonly error: string | null}
> {
  constructor(props: {readonly children: ReactNode}) {
    super(props);
    this.state = {error: null};
  }

  static getDerivedStateFromError(error: Error): {readonly error: string} {
    return {error: error.message};
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ExcalidrawBoard] render error:', error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="sd-excalidraw-fallback">
          <strong>白板画布加载降级</strong>
          <p>{this.state.error}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export interface ExcalidrawBoardProps {
  readonly sessionId: string;
  readonly board: BoardSceneDoc;
  readonly pins: readonly ArtifactPin[];
  readonly theme: 'light' | 'dark';
  readonly busy: boolean;
  readonly onSaveBoard: (nextBoard: BoardSceneDoc) => Promise<void>;
  readonly onCreatePin: (input: {
    readonly surfaceType: 'board';
    readonly anchorJson: string;
    readonly specNodeId?: string;
    readonly promptText: string;
  }) => Promise<void>;
  readonly onResolvePin: (pinId: string, askAgent: boolean) => Promise<void>;
}

const NODE_PALETTE: Readonly<
  Record<
    string,
    {
      readonly bg: string;
      readonly stroke: string;
      readonly type: 'rectangle' | 'diamond' | 'ellipse';
    }
  >
> = {
  goal: {bg: '#FEF3C7', stroke: '#92400E', type: 'rectangle'},
  user: {bg: '#FEF3C7', stroke: '#92400E', type: 'rectangle'},
  module: {bg: '#DBEAFE', stroke: '#1E40AF', type: 'rectangle'},
  service: {bg: '#DBEAFE', stroke: '#1E40AF', type: 'rectangle'},
  store: {bg: '#E0F2FE', stroke: '#0369A1', type: 'rectangle'},
  ui: {bg: '#F3E8FF', stroke: '#6B21A8', type: 'rectangle'},
  decision: {bg: '#EDE9FE', stroke: '#5B21B6', type: 'diamond'},
  gate: {bg: '#EDE9FE', stroke: '#5B21B6', type: 'diamond'},
  task: {bg: '#DCFCE7', stroke: '#166534', type: 'rectangle'},
  outcome: {bg: '#DCFCE7', stroke: '#166534', type: 'rectangle'},
  sticky: {bg: '#FEF9C3', stroke: '#A16207', type: 'rectangle'},
  risk: {bg: '#FCE7F3', stroke: '#9D174D', type: 'rectangle'},
  external: {bg: '#F1F5F9', stroke: '#475569', type: 'rectangle'},
};

const DEFAULT_PALETTE = {
  bg: '#DBEAFE',
  stroke: '#1E40AF',
  type: 'rectangle' as const,
};

const DEFAULT_STARTER_NODES: readonly BoardNodeDoc[] = [
  {
    id: 'starter-intent',
    label: '需求构思与多人讨论',
    kind: 'goal',
    x: 80,
    y: 40,
    width: 260,
    height: 92,
    specModuleId: 'mod-intent',
    status: 'confirmed',
    summary: '频道讨论 · 共编 PRD',
  },
  {
    id: 'starter-spec',
    label: '结构化 Spec 契约',
    kind: 'module',
    x: 380,
    y: 40,
    width: 260,
    height: 92,
    specModuleId: 'mod-spec',
    status: 'confirmed',
    summary: '模块边界 · 验收标准',
  },
  {
    id: 'starter-workers',
    label: '隔离工作区并行开发',
    kind: 'task',
    x: 80,
    y: 220,
    width: 260,
    height: 92,
    specModuleId: 'mod-workers',
    status: 'draft',
    summary: 'Git Worktree · 变更快照',
  },
  {
    id: 'starter-gate',
    label: '独立交叉审校门禁',
    kind: 'gate',
    x: 380,
    y: 220,
    width: 310,
    height: 144,
    specModuleId: 'mod-gate',
    status: 'confirmed',
    summary: '实现与审校角色物理分离',
  },
];

const DEFAULT_STARTER_EDGES: readonly BoardEdgeDoc[] = [
  {
    id: 'starter-e1',
    fromNodeId: 'starter-intent',
    toNodeId: 'starter-spec',
    label: '编译固化',
  },
  {
    id: 'starter-e2',
    fromNodeId: 'starter-spec',
    toNodeId: 'starter-workers',
    label: '任务拆解',
  },
  {
    id: 'starter-e3',
    fromNodeId: 'starter-workers',
    toNodeId: 'starter-gate',
    label: '提交审校',
  },
];

interface BoxGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly shapeType: 'rectangle' | 'diamond' | 'ellipse';
  readonly wrappedText: string;
}

function measureTextPx(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 255 ? 15.2 : 8.3;
  }
  return w;
}

function wrapTextToWidth(
  text: string,
  maxPx: number,
  maxLines: number,
): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const lines: string[] = [];
  let current = '';
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i]!;
    const candidate = current + ch;
    if (measureTextPx(candidate) > maxPx && current.length > 0) {
      lines.push(current);
      if (lines.length >= maxLines - 1) {
        const restStart = ch === ' ' ? i + 1 : i;
        const tail = clean.slice(restStart).trimStart();
        const tailW = measureTextPx(tail);
        lines.push(
          tailW > maxPx
            ? `${tail.slice(0, Math.max(6, Math.floor(tail.length * (maxPx / tailW)) - 1))}…`
            : tail,
        );
        return lines;
      }
      current = ch === ' ' ? '' : ch;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function measureNodeBox(node: BoardNodeDoc): {
  readonly width: number;
  readonly height: number;
  readonly shapeType: 'rectangle' | 'diamond' | 'ellipse';
  readonly wrappedText: string;
} {
  const palette = NODE_PALETTE[node.kind] ?? DEFAULT_PALETTE;
  const titleLines = wrapTextToWidth(node.label, 240, 2);
  const summaryLines = node.summary
    ? wrapTextToWidth(node.summary, 240, 2)
    : [];
  const allLines = [...titleLines, ...summaryLines];
  const longestPx = Math.max(140, ...allLines.map(l => measureTextPx(l)));
  const innerW = Math.min(340, Math.max(220, Math.ceil(longestPx + 48)));
  const innerH = Math.max(88, allLines.length * 22 + 34);

  if (palette.type === 'diamond') {
    return {
      width: Math.max(300, Math.round(innerW * 1.48)),
      height: Math.max(152, Math.round(innerH * 1.48)),
      shapeType: 'diamond',
      wrappedText: allLines.join('\n'),
    };
  }
  return {
    width: innerW,
    height: innerH,
    shapeType: palette.type,
    wrappedText: allLines.join('\n'),
  };
}

function computeLayeredLayout(
  nodes: readonly BoardNodeDoc[],
  edges: readonly BoardEdgeDoc[],
  forceRelayout = false,
): Map<string, BoxGeometry> {
  const measured = new Map<
    string,
    ReturnType<typeof measureNodeBox> & {readonly node: BoardNodeDoc}
  >();
  for (const node of nodes) {
    measured.set(node.id, {...measureNodeBox(node), node});
  }

  // Detect overlaps or cramped boxes from backend coordinates
  let needsRelayout = forceRelayout;
  if (!needsRelayout) {
    for (let i = 0; i < nodes.length && !needsRelayout; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const ma = measured.get(a.id)!;
        const mb = measured.get(b.id)!;
        const overlapX =
          Math.max(a.x, b.x) < Math.min(a.x + ma.width, b.x + mb.width) + 70;
        const overlapY =
          Math.max(a.y, b.y) < Math.min(a.y + ma.height, b.y + mb.height) + 65;
        if (overlapX && overlapY) {
          needsRelayout = true;
        }
      }
    }
  }

  const out = new Map<string, BoxGeometry>();
  if (!needsRelayout && nodes.length > 0) {
    for (const node of nodes) {
      const m = measured.get(node.id)!;
      out.set(node.id, {
        x: node.x ?? 80,
        y: node.y ?? 60,
        width: m.width,
        height: m.height,
        shapeType: m.shapeType,
        wrappedText: m.wrappedText,
      });
    }
    return out;
  }

  // Topological longest-path layer assignment with cycle guard
  const ranks = new Map<string, number>();
  nodes.forEach(n => ranks.set(n.id, 0));
  const maxIter = nodes.length;
  for (let pass = 0; pass < maxIter; pass++) {
    let changed = false;
    for (const edge of edges) {
      if (!ranks.has(edge.fromNodeId) || !ranks.has(edge.toNodeId)) continue;
      if (edge.fromNodeId === edge.toNodeId) continue;
      const fromRank = ranks.get(edge.fromNodeId)!;
      const toRank = ranks.get(edge.toNodeId)!;
      if (toRank <= fromRank) {
        ranks.set(edge.toNodeId, Math.min(nodes.length, fromRank + 1));
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group into balanced rows (max 3 nodes per visual rank)
  const layers = new Map<number, BoardNodeDoc[]>();
  for (const node of nodes) {
    const r = ranks.get(node.id) ?? 0;
    const list = layers.get(r) ?? [];
    list.push(node);
    layers.set(r, list);
  }

  const sortedRanks = Array.from(layers.keys()).sort((a, b) => a - b);
  const colGap = 110;
  const rowGap = 110;
  let maxRowWidth = 0;

  const rowMetrics = sortedRanks.map(r => {
    const items = layers.get(r)!;
    const widthSum =
      items.reduce((acc, n) => acc + measured.get(n.id)!.width, 0) +
      Math.max(0, items.length - 1) * colGap;
    const maxHeight = Math.max(...items.map(n => measured.get(n.id)!.height));
    maxRowWidth = Math.max(maxRowWidth, widthSum);
    return {items, widthSum, maxHeight};
  });

  let curY = 48;
  for (const row of rowMetrics) {
    let curX = Math.round((maxRowWidth - row.widthSum) / 2) + 60;
    for (const node of row.items) {
      const m = measured.get(node.id)!;
      const yOffset = Math.round((row.maxHeight - m.height) / 2);
      out.set(node.id, {
        x: curX,
        y: curY + yOffset,
        width: m.width,
        height: m.height,
        shapeType: m.shapeType,
        wrappedText: m.wrappedText,
      });
      curX += m.width + colGap;
    }
    curY += row.maxHeight + rowGap;
  }

  return out;
}

/**
 * Computes an exact boundary point on a rectangle, diamond, or ellipse along
 * the ray toward `(targetCx, targetCy)` plus a clean visual clearance gap.
 */
function computeShapeBoundaryPoint(
  box: BoxGeometry,
  targetCx: number,
  targetCy: number,
  gap = 6,
): {readonly x: number; readonly y: number} {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = targetCx - cx;
  const dy = targetCy - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) {
    return {x: cx, y: cy + box.height / 2 + gap};
  }
  const rx = box.width / 2;
  const ry = box.height / 2;

  let t = 1;
  if (box.shapeType === 'diamond') {
    const denom = Math.abs(dx) / rx + Math.abs(dy) / ry;
    t = denom > 1e-6 ? 1 / denom : 1;
  } else if (box.shapeType === 'ellipse') {
    const denom = Math.hypot(dx / rx, dy / ry);
    t = denom > 1e-6 ? 1 / denom : 1;
  } else {
    const denom = Math.max(Math.abs(dx) / rx, Math.abs(dy) / ry);
    t = denom > 1e-6 ? 1 / denom : 1;
  }

  const ux = dx / len;
  const uy = dy / len;
  return {
    x: cx + t * dx + ux * gap,
    y: cy + t * dy + uy * gap,
  };
}

function buildSkeletons(
  board: BoardSceneDoc,
  forceRelayout = false,
): {
  readonly skeletons: ExcalidrawElementSkeleton[];
  readonly boxes: Map<string, BoxGeometry>;
} {
  const nodes =
    board.nodes.length > 0 ? board.nodes : [...DEFAULT_STARTER_NODES];
  const edges =
    board.nodes.length > 0 ? board.edges : [...DEFAULT_STARTER_EDGES];
  const boxes = computeLayeredLayout(nodes, edges, forceRelayout);

  const skeletons: ExcalidrawElementSkeleton[] = nodes.map(node => {
    const palette = NODE_PALETTE[node.kind] ?? DEFAULT_PALETTE;
    const box = boxes.get(node.id)!;
    return {
      id: node.id,
      type: palette.type,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      backgroundColor: palette.bg,
      strokeColor: palette.stroke,
      fillStyle: 'solid',
      strokeWidth: 1.75,
      roughness: 1,
      roundness: {type: 3},
      label: {
        text: box.wrappedText,
        fontFamily: 1,
        fontSize: 15,
        strokeColor: '#1E1E1E',
      },
      customData: {
        kind: node.kind,
        specModuleId: node.specModuleId,
        status: node.status,
      },
    };
  });

  for (const edge of edges) {
    const fromBox = boxes.get(edge.fromNodeId);
    const toBox = boxes.get(edge.toNodeId);
    if (!fromBox || !toBox || edge.fromNodeId === edge.toNodeId) {
      continue;
    }

    const fromCx = fromBox.x + fromBox.width / 2;
    const fromCy = fromBox.y + fromBox.height / 2;
    const toCx = toBox.x + toBox.width / 2;
    const toCy = toBox.y + toBox.height / 2;

    const p1 = computeShapeBoundaryPoint(fromBox, toCx, toCy, 8);
    const p2 = computeShapeBoundaryPoint(toBox, fromCx, fromCy, 8);

    // Crucial: pass clean local relative points [[0, 0], [dx, dy]] without
    // negative width/height fields so Excalidraw never shifts arrowheads off-target.
    skeletons.push({
      id: edge.id,
      type: 'arrow',
      x: p1.x,
      y: p1.y,
      points: [
        [0, 0],
        [p2.x - p1.x, p2.y - p1.y],
      ],
      start: {id: edge.fromNodeId},
      end: {id: edge.toNodeId},
      startArrowhead: null,
      endArrowhead: 'arrow',
      strokeColor: '#475569',
      strokeWidth: 1.75,
      roughness: 1,
      roundness: {type: 2},
      label: edge.label
        ? {
            text: edge.label,
            fontFamily: 1,
            fontSize: 13,
            strokeColor: '#334155',
          }
        : undefined,
    });
  }

  return {skeletons, boxes};
}

export function ExcalidrawBoard({
  sessionId,
  board,
  pins,
  theme,
  busy,
  onSaveBoard,
  onCreatePin,
  onResolvePin,
}: ExcalidrawBoardProps): ReactElement {
  const [pinMode, setPinMode] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [pendingScenePt, setPendingScenePt] = useState<{
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const [pinPrompt, setPinPrompt] = useState('');
  const [camera, setCamera] = useState({scrollX: 0, scrollY: 0, zoom: 1});

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastRevisionRef = useRef<number>(board.revision);
  const dirtyByUserRef = useRef<boolean>(false);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const storageKey = `forgeops.v61.excalidraw.scene.${sessionId}`;

  const initialElements = useMemo(() => {
    const {skeletons} = buildSkeletons(board, false);
    return convertToExcalidrawElements(skeletons, {
      regenerateIds: false,
    });
  }, [board]);

  useEffect(() => {
    if (board.revision === lastRevisionRef.current || !apiRef.current) {
      return;
    }
    lastRevisionRef.current = board.revision;
    const {skeletons} = buildSkeletons(board, false);
    const nextEls = convertToExcalidrawElements(skeletons, {
      regenerateIds: false,
    });
    apiRef.current.updateScene({elements: nextEls});
    apiRef.current.scrollToContent(nextEls, {fitToContent: true});
  }, [board]);

  const handleAutoArrange = (): void => {
    const {skeletons, boxes} = buildSkeletons(board, true);
    const nextEls = convertToExcalidrawElements(skeletons, {
      regenerateIds: false,
    });
    apiRef.current?.updateScene({elements: nextEls});
    apiRef.current?.scrollToContent(nextEls, {fitToContent: true});
    if (board.nodes.length > 0) {
      const updatedNodes = board.nodes.map(n => {
        const b = boxes.get(n.id);
        return b
          ? {
              ...n,
              x: Math.round(b.x),
              y: Math.round(b.y),
              width: Math.round(b.width),
              height: Math.round(b.height),
            }
          : n;
      });
      void onSaveBoard({...board, nodes: updatedNodes});
    }
  };

  const handleChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState) => {
      const nextZoom = appState.zoom?.value ?? 1;
      setCamera(prev => {
        if (
          Math.abs(prev.scrollX - appState.scrollX) < 0.8 &&
          Math.abs(prev.scrollY - appState.scrollY) < 0.8 &&
          Math.abs(prev.zoom - nextZoom) < 0.005
        ) {
          return prev;
        }
        return {
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          zoom: nextZoom,
        };
      });

      const active = elements.filter(el => !el.isDeleted);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(active));
      } catch {
        // Ignore quota errors.
      }

      if (!dirtyByUserRef.current) {
        return;
      }

      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        if (!dirtyByUserRef.current) {
          return;
        }
        dirtyByUserRef.current = false;
        const textMap = new Map<string, string>();
        for (const el of active) {
          if (el.type === 'text' && el.containerId) {
            textMap.set(el.containerId, el.text);
          }
        }
        const semanticNodes: BoardNodeDoc[] = active
          .filter(el => {
            const custom = (el.customData ?? {}) as {ephemeral?: boolean};
            if (custom.ephemeral) return false;
            return (
              el.type === 'rectangle' ||
              el.type === 'diamond' ||
              el.type === 'ellipse'
            );
          })
          .map((el, idx) => {
            const rawText = (textMap.get(el.id) ?? `Module ${idx + 1}`).trim();
            const [firstLine, ...rest] = rawText.split('\n');
            const custom = (el.customData ?? {}) as {
              kind?: string;
              specModuleId?: string;
              status?: string;
            };
            return {
              id: el.id,
              label: (firstLine || `Module ${idx + 1}`).slice(0, 64),
              kind:
                custom.kind ?? (el.type === 'diamond' ? 'decision' : 'module'),
              x: Math.round(el.x),
              y: Math.round(el.y),
              width: Math.round(el.width),
              height: Math.round(el.height),
              specModuleId: custom.specModuleId ?? `mod-${el.id.slice(0, 12)}`,
              status: custom.status ?? 'draft',
              summary: rest.join(' · ') || undefined,
            };
          });
        if (semanticNodes.length > 0) {
          lastRevisionRef.current = board.revision + 1;
          void onSaveBoard({
            ...board,
            nodes: semanticNodes,
          });
        }
      }, 900);
    },
    [board, onSaveBoard, storageKey],
  );

  const handlePinOverlayClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (!pinMode || !hostRef.current) {
      return;
    }
    const rect = hostRef.current.getBoundingClientRect();
    const viewX = e.clientX - rect.left;
    const viewY = e.clientY - rect.top;
    const sceneX = Math.round(viewX / camera.zoom - camera.scrollX);
    const sceneY = Math.round(viewY / camera.zoom - camera.scrollY);
    setPendingScenePt({x: sceneX, y: sceneY});
    setSelectedPinId(null);
  };

  const submitPin = async (): Promise<void> => {
    if (!pendingScenePt || !pinPrompt.trim()) {
      return;
    }
    await onCreatePin({
      surfaceType: 'board',
      anchorJson: JSON.stringify(pendingScenePt),
      promptText: pinPrompt.trim(),
    });
    setPendingScenePt(null);
    setPinPrompt('');
    setPinMode(false);
  };

  const boardPins = pins.filter(
    p => p.surfaceType === 'board' || p.surfaceType === 'spec_ir',
  );
  const selectedPin = boardPins.find(p => p.id === selectedPinId) ?? null;

  return (
    <div
      className="sd-excalidraw-host"
      ref={hostRef}
      data-testid="v4-excalidraw-board"
      onPointerDownCapture={() => {
        dirtyByUserRef.current = true;
      }}
      onKeyDownCapture={() => {
        dirtyByUserRef.current = true;
      }}
    >
      <CanvasErrorBoundary>
        <Excalidraw
          theme={theme}
          initialData={{
            elements: initialElements,
            appState: {
              viewBackgroundColor: theme === 'dark' ? '#121211' : '#FFFFFF',
              currentItemRoughness: 1,
              currentItemFontFamily: 1,
            },
            scrollToContent: true,
          }}
          excalidrawAPI={api => {
            apiRef.current = api;
            window.setTimeout(() => {
              const els = api.getSceneElements();
              if (els.length > 0) {
                api.scrollToContent(els, {fitToContent: true});
              }
            }, 60);
          }}
          onChange={handleChange}
          UIOptions={{
            canvasActions: {
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              toggleTheme: null,
            },
          }}
          renderTopRightUI={() => (
            <div className="sd-board-top-right">
              <button
                type="button"
                className="sd-btn"
                title="自动层次重排节点与连线"
                onClick={handleAutoArrange}
              >
                <span>整理布局</span>
              </button>
              <button
                type="button"
                className={`sd-btn ${pinMode ? 'is-primary' : ''}`}
                title="开启评论批注模式并在画布任意节点提问"
                onClick={() => {
                  setPinMode(prev => !prev);
                  setPendingScenePt(null);
                }}
              >
                <CdsIcon name="Pin" size="xs" />
                <span>{pinMode ? '点击画布落点…' : '画布批注'}</span>
              </button>
              <button
                type="button"
                className="sd-btn"
                title="适配画布内容居中显示"
                onClick={() => {
                  const els = apiRef.current?.getSceneElements() ?? [];
                  apiRef.current?.scrollToContent(els, {fitToContent: true});
                }}
              >
                <span>居中</span>
              </button>
            </div>
          )}
        />
      </CanvasErrorBoundary>

      {pinMode ? (
        <div
          className="sd-pin-capture"
          onClick={handlePinOverlayClick}
          title="点击画布任意位置添加批注"
        />
      ) : null}

      <div className="sd-pin-layer">
        {boardPins.map(pin => {
          let sceneX = 80 + pin.pinNumber * 38;
          let sceneY = 64;
          try {
            const coords = JSON.parse(pin.anchorJson) as {
              x?: number;
              y?: number;
            };
            if (typeof coords.x === 'number') sceneX = coords.x;
            if (typeof coords.y === 'number') sceneY = coords.y;
          } catch {
            // Keep fallback position.
          }
          const left = (sceneX + camera.scrollX) * camera.zoom;
          const top = (sceneY + camera.scrollY) * camera.zoom;
          const isOpen = selectedPin?.id === pin.id;

          return (
            <div key={pin.id} className="sd-pin-anchor" style={{left, top}}>
              <button
                type="button"
                className={`sd-pin-badge ${pin.status === 'resolved' ? 'is-resolved' : ''} ${isOpen ? 'is-active' : ''}`}
                title={`#${pin.pinNumber} ${pin.promptText}`}
                onClick={() =>
                  setSelectedPinId(prev => (prev === pin.id ? null : pin.id))
                }
              >
                {pin.pinNumber}
              </button>

              {isOpen ? (
                <div className="sd-pin-popover" role="dialog">
                  <div className="sd-pin-popover-head">
                    <span
                      className={`sd-pill ${pin.status === 'resolved' ? 'is-success' : ''}`}
                    >
                      {pin.status === 'resolved' ? '已解决' : '待处理'}
                    </span>
                    <button
                      type="button"
                      className="sd-thread-action-link"
                      onClick={() => setSelectedPinId(null)}
                    >
                      收起
                    </button>
                  </div>
                  <p className="sd-pin-popover-text">{pin.promptText}</p>
                  {pin.replyText ? (
                    <div className="sd-pin-popover-reply">{pin.replyText}</div>
                  ) : null}
                  {pin.status !== 'resolved' ? (
                    <div className="sd-toolbar-row" style={{marginTop: 8}}>
                      <button
                        type="button"
                        className="sd-btn is-primary"
                        disabled={busy}
                        onClick={() => void onResolvePin(pin.id, true)}
                      >
                        唤醒架构师处理
                      </button>
                      <button
                        type="button"
                        className="sd-btn"
                        disabled={busy}
                        onClick={() => void onResolvePin(pin.id, false)}
                      >
                        标记已解决
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {pendingScenePt ? (
          <div
            className="sd-pin-anchor"
            style={{
              left: (pendingScenePt.x + camera.scrollX) * camera.zoom,
              top: (pendingScenePt.y + camera.scrollY) * camera.zoom,
            }}
          >
            <div className="sd-pin-popover" role="dialog">
              <div className="sd-pin-popover-head">
                <strong>新增画布批注</strong>
                <button
                  type="button"
                  className="sd-thread-action-link"
                  onClick={() => setPendingScenePt(null)}
                >
                  取消
                </button>
              </div>
              <textarea
                rows={2}
                className="sd-input"
                style={{width: '100%', height: 'auto', padding: '6px 8px'}}
                value={pinPrompt}
                onChange={e => setPinPrompt(e.target.value)}
                placeholder="针对此模块提问或建议修订架构边界…"
                autoFocus
              />
              <div
                className="sd-toolbar-row"
                style={{marginTop: 8, justifyContent: 'flex-end'}}
              >
                <button
                  type="button"
                  className="sd-btn is-primary"
                  disabled={busy || !pinPrompt.trim()}
                  onClick={() => void submitPin()}
                >
                  提交批注
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
