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
  decision: {bg: '#EDE9FE', stroke: '#5B21B6', type: 'diamond'},
  gate: {bg: '#EDE9FE', stroke: '#5B21B6', type: 'diamond'},
  task: {bg: '#DCFCE7', stroke: '#166534', type: 'rectangle'},
  outcome: {bg: '#DCFCE7', stroke: '#166534', type: 'rectangle'},
  sticky: {bg: '#FEF9C3', stroke: '#A16207', type: 'rectangle'},
  risk: {bg: '#FCE7F3', stroke: '#9D174D', type: 'rectangle'},
};

const DEFAULT_STARTER_NODES: readonly BoardNodeDoc[] = [
  {
    id: 'starter-intent',
    label: 'Human Intent & Constraints',
    kind: 'goal',
    x: 60,
    y: 48,
    width: 210,
    height: 68,
    specModuleId: 'mod-intent',
    status: 'settled',
    summary: 'Slack Thread · Grilling',
  },
  {
    id: 'starter-master',
    label: 'Master Orchestrator',
    kind: 'module',
    x: 330,
    y: 48,
    width: 210,
    height: 68,
    specModuleId: 'mod-master',
    status: 'active',
    summary: 'Spec IR · Task Graph',
  },
  {
    id: 'starter-kano',
    label: 'Kano-AHP CR < 0.10',
    kind: 'decision',
    x: 350,
    y: 165,
    width: 170,
    height: 92,
    specModuleId: 'mod-kano',
    status: 'verified',
    summary: 'Priority Matrix',
  },
  {
    id: 'starter-workers',
    label: 'Codex / Claude / Gemini Worktrees',
    kind: 'task',
    x: 60,
    y: 178,
    width: 230,
    height: 70,
    specModuleId: 'mod-workers',
    status: 'running',
    summary: 'Isolated Git Worktree',
  },
  {
    id: 'starter-note',
    label: 'Ship Rule: Coder ≠ Reviewer · Click Pin to ask @Master',
    kind: 'sticky',
    x: 60,
    y: 292,
    width: 480,
    height: 62,
    specModuleId: 'mod-ship-rule',
    status: 'settled',
  },
];

const DEFAULT_STARTER_EDGES: readonly BoardEdgeDoc[] = [
  {
    id: 'starter-e1',
    fromNodeId: 'starter-intent',
    toNodeId: 'starter-master',
    label: 'consensus',
  },
  {
    id: 'starter-e2',
    fromNodeId: 'starter-master',
    toNodeId: 'starter-kano',
    label: 'quantize',
  },
  {
    id: 'starter-e3',
    fromNodeId: 'starter-kano',
    toNodeId: 'starter-workers',
    label: 'dispatch',
  },
];

const DEFAULT_PALETTE = {
  bg: '#DBEAFE',
  stroke: '#1E40AF',
  type: 'rectangle' as const,
};

function computeLayoutBoxes(nodes: readonly BoardNodeDoc[]): Map<
  string,
  {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }
> {
  const out = new Map<
    string,
    {x: number; y: number; width: number; height: number}
  >();

  // Check if backend coordinates are cramped (< 140px gap between adjacent boxes)
  let needsSpread = false;
  for (let i = 0; i < nodes.length && !needsSpread; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const aw = Math.max(240, a.width || 240);
      const ah = Math.max(96, a.height || 96);
      const bw = Math.max(240, b.width || 240);
      const bh = Math.max(96, b.height || 96);
      const ox = Math.max(a.x, b.x) < Math.min(a.x + aw, b.x + bw) + 120;
      const oy = Math.max(a.y, b.y) < Math.min(a.y + ah, b.y + bh) + 80;
      if (ox && oy) {
        needsSpread = true;
        break;
      }
    }
  }

  nodes.forEach((node, index) => {
    const isDiamond = node.kind === 'decision' || node.kind === 'gate';
    const w = isDiamond ? 250 : Math.max(245, node.width || 245);
    const h = isDiamond ? 116 : Math.max(98, node.height || 98);
    if (needsSpread) {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const isLastCentered =
        nodes.length % 2 === 1 && index === nodes.length - 1;
      out.set(node.id, {
        x: isLastCentered ? 245 : 40 + col * 410,
        y: 50 + row * 195,
        width: w,
        height: h,
      });
    } else {
      out.set(node.id, {
        x: node.x ?? 48 + (index % 2) * 410,
        y: node.y ?? 48 + Math.floor(index / 2) * 195,
        width: w,
        height: h,
      });
    }
  });
  return out;
}

function buildSkeletons(board: BoardSceneDoc): ExcalidrawElementSkeleton[] {
  const nodes =
    board.nodes.length > 0 ? board.nodes : [...DEFAULT_STARTER_NODES];
  const edges =
    board.nodes.length > 0 ? board.edges : [...DEFAULT_STARTER_EDGES];
  const boxes = computeLayoutBoxes(nodes);

  const skeletons: ExcalidrawElementSkeleton[] = nodes.map(node => {
    const palette = NODE_PALETTE[node.kind] ?? DEFAULT_PALETTE;
    const box = boxes.get(node.id) ?? {
      x: node.x,
      y: node.y,
      width: 245,
      height: 98,
    };
    const shortTitle =
      node.label.length > 26 ? `${node.label.slice(0, 24)}…` : node.label;
    const shortSummary =
      node.summary && node.summary.length > 36
        ? `${node.summary.slice(0, 34)}…`
        : node.summary;
    const text = shortSummary ? `${shortTitle}\n${shortSummary}` : shortTitle;
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
      strokeWidth: 1.5,
      roughness: 1,
      roundness: {type: 3},
      label: {
        text,
        fontFamily: 1,
        fontSize: 14,
        strokeColor: '#1E1E1E',
      },
      customData: {
        kind: node.kind,
        specModuleId: node.specModuleId,
        status: node.status,
      },
    };
  });

  // Add subtle Excalidraw takeaway card at bottom like Buzz/Excalidraw boards
  if (nodes.length > 0 && nodes.length <= 4) {
    let maxY = 0;
    for (const b of boxes.values()) {
      maxY = Math.max(maxY, b.y + b.height);
    }
    skeletons.push({
      id: 'canvas-consensus-note',
      type: 'rectangle',
      x: 40,
      y: maxY + 42,
      width: 655,
      height: 64,
      backgroundColor: '#FEF9C3',
      strokeColor: '#A16207',
      fillStyle: 'solid',
      strokeWidth: 1.2,
      roughness: 1,
      roundness: {type: 3},
      label: {
        text: 'Spec IR · 拖拽节点实时同步契约 · 点击右上角「Pin 批注」锚点提问 @Master',
        fontFamily: 1,
        fontSize: 13,
        strokeColor: '#422006',
      },
      customData: {ephemeral: true},
    });
  }

  for (const edge of edges) {
    const fromBox = boxes.get(edge.fromNodeId);
    const toBox = boxes.get(edge.toNodeId);
    if (!fromBox || !toBox) {
      continue;
    }
    const fromCx = fromBox.x + fromBox.width / 2;
    const fromCy = fromBox.y + fromBox.height / 2;
    const toCx = toBox.x + toBox.width / 2;
    const toCy = toBox.y + toBox.height / 2;
    const horizontal = Math.abs(toCx - fromCx) > Math.abs(toCy - fromCy);

    const x1 = horizontal
      ? toCx >= fromCx
        ? fromBox.x + fromBox.width + 6
        : fromBox.x - 6
      : fromCx;
    const y1 = horizontal
      ? fromCy
      : toCy >= fromCy
        ? fromBox.y + fromBox.height + 6
        : fromBox.y - 6;
    const x2 = horizontal
      ? toCx >= fromCx
        ? toBox.x - 6
        : toBox.x + toBox.width + 6
      : toCx;
    const y2 = horizontal
      ? toCy
      : toCy >= fromCy
        ? toBox.y - 6
        : toBox.y + toBox.height + 6;
    const dx = x2 - x1;
    const dy = y2 - y1;

    skeletons.push({
      id: edge.id,
      type: 'arrow',
      x: x1,
      y: y1,
      width: dx,
      height: dy,
      points: [
        [0, 0],
        [dx, dy],
      ],
      start: {id: edge.fromNodeId},
      end: {id: edge.toNodeId},
      strokeColor: '#4B5563',
      strokeWidth: 1.5,
      roughness: 1,
      label: edge.label
        ? {text: edge.label, fontFamily: 1, fontSize: 12}
        : undefined,
    });
  }

  return skeletons;
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

  const storageKey = `forgeops.v4.excalidraw.scene.${sessionId}`;

  const initialElements = useMemo(() => {
    try {
      const cached = window.localStorage.getItem(storageKey);
      if (cached) {
        const parsed = JSON.parse(cached) as OrderedExcalidrawElement[];
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          board.revision === 0
        ) {
          return parsed;
        }
      }
    } catch {
      // Ignore storage error and rebuild from BoardSceneDoc.
    }
    return convertToExcalidrawElements(buildSkeletons(board), {
      regenerateIds: false,
    });
  }, [board, storageKey]);

  // Re-sync canvas if board revision advances externally (e.g., from Master Agent)
  useEffect(() => {
    if (board.revision === lastRevisionRef.current || !apiRef.current) {
      return;
    }
    lastRevisionRef.current = board.revision;
    const nextEls = convertToExcalidrawElements(buildSkeletons(board), {
      regenerateIds: false,
    });
    apiRef.current.updateScene({elements: nextEls});
    apiRef.current.scrollToContent(nextEls, {fitToContent: true});
  }, [board]);

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
                className={`sd-btn ${pinMode ? 'is-primary' : ''}`}
                title="开启评论 Pin 模式并在画布标注疑问"
                onClick={() => {
                  setPinMode(prev => !prev);
                  setPendingScenePt(null);
                }}
              >
                <CdsIcon name="Pin" size="xs" />
                <span>{pinMode ? '点击画布落点…' : 'Pin 批注'}</span>
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
                <span>Fit</span>
              </button>
            </div>
          )}
        />
      </CanvasErrorBoundary>

      {/* Transparent click catcher active only in Pin annotation mode */}
      {pinMode ? (
        <div
          className="sd-pin-capture"
          onClick={handlePinOverlayClick}
          title="点击画布任意位置添加评论 Pin"
        />
      ) : null}

      {/* Floating anchored Pin badges & popovers over Excalidraw scene */}
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
                      className={`sd-pill ${pin.status === 'resolved' ? 'is-success' : 'is-clay'}`}
                    >
                      {pin.status === 'resolved'
                        ? 'Resolved'
                        : 'Waiting on Agent'}
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
                        Ask @Master
                      </button>
                      <button
                        type="button"
                        className="sd-btn"
                        disabled={busy}
                        onClick={() => void onResolvePin(pin.id, false)}
                      >
                        Resolve
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
                <strong>新增画布评论 Pin</strong>
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
                placeholder="针对此节点提问或要求 @Master 修改…"
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
                  发送给 Master
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
