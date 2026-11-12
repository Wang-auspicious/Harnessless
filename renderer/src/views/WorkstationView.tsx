import {useEffect, useMemo, useState, type ReactElement} from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  BootstrapSnapshot,
  ChangeDetailSnapshot,
} from '../../../src/shared/api.ts';
import type {
  DomainTermEntry,
  GraphNode,
  GraphNodeKind,
  GraphNodeStatus,
  TranscriptMessage,
} from '../../../src/shared/types.ts';
import {forgeApi} from '../api/client.ts';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  EyeIcon,
  FileTextIcon,
  GitBranchIcon,
  GridIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
} from '../components/Icons.tsx';
import {formatStatusLabel, tr, type UiLang} from '../i18n.ts';

export type WorkstationTab = 'details' | 'monitor' | 'activity' | 'graph';

interface StageNodeData extends Record<string, unknown> {
  readonly node: GraphNode;
  readonly isSelected: boolean;
  readonly lang: UiLang;
}

interface PhaseNodeData extends Record<string, unknown> {
  readonly node: GraphNode;
  readonly doneCount: number;
  readonly totalCount: number;
  readonly lang: UiLang;
  readonly onToggleCollapse: (nodeId: string, nextCollapsed: boolean) => void;
}

interface TaskMiniNodeData extends Record<string, unknown> {
  readonly node: GraphNode;
  readonly isSelected: boolean;
  readonly lang: UiLang;
}

function localizeStageTitle(lang: UiLang, node: GraphNode): string {
  if (lang === 'EN') {
    return node.title;
  }
  switch (node.kind) {
    case 'start':
      return '开始 (Start)';
    case 'end':
      return '认证完结 (End)';
    case 'verify':
      return '规格与 DDD 完整性守卫';
    case 'gates':
      return '确定性硬门禁 (Lint/Test)';
    case 'selfcheck':
      return '提审前自检 (Selfcheck)';
    case 'audit_jqa':
      return 'JQA 一致性初审';
    case 'audit_sqa':
      return 'SQA 架构与逻辑终审';
    case 'decision':
      if (node.title.includes('JQA')) return '裁决：JQA 初审';
      if (node.title.includes('SQA')) return '裁决：SQA 终审';
      return '门禁裁决节点';
    case 'restore':
      return node.title.includes('DEV')
        ? '物理回退恢复 (DEV)'
        : '物理回退恢复 (Restore)';
    case 'checkpoint':
      return node.code === 'CP-0'
        ? '准备阶段 (基线检查点)'
        : '质量锚点检查点 (QA CP)';
    default:
      return node.title;
  }
}

function getKindMeta(kind: GraphNodeKind): {
  readonly upperLabel: string;
  readonly kindIcon: ReactElement;
  readonly badgeIcon: ReactElement;
} {
  switch (kind) {
    case 'start':
    case 'end':
      return {
        upperLabel: 'PASSNODE',
        kindIcon: <PlayIcon size={11} />,
        badgeIcon: <PlayIcon size={13} />,
      };
    case 'verify':
      return {
        upperLabel: 'VERIFYNODE',
        kindIcon: <ShieldIcon size={11} />,
        badgeIcon: <ShieldIcon size={13} />,
      };
    case 'gates':
      return {
        upperLabel: 'GATESNODE',
        kindIcon: <ShieldIcon size={11} />,
        badgeIcon: <SearchIcon size={13} />,
      };
    case 'selfcheck':
      return {
        upperLabel: 'SELFCHECKNODE',
        kindIcon: <PlayIcon size={11} />,
        badgeIcon: <FileTextIcon size={13} />,
      };
    case 'audit_jqa':
      return {
        upperLabel: 'TQLAJQANODE',
        kindIcon: <SearchIcon size={11} />,
        badgeIcon: <SearchIcon size={13} />,
      };
    case 'audit_sqa':
      return {
        upperLabel: 'TQLASQANODE',
        kindIcon: <EyeIcon size={11} />,
        badgeIcon: <EyeIcon size={13} />,
      };
    case 'decision':
      return {
        upperLabel: 'DECISIONNODE',
        kindIcon: <AlertTriangleIcon size={11} />,
        badgeIcon: <AlertTriangleIcon size={13} />,
      };
    case 'restore':
      return {
        upperLabel: 'RESTORENODE',
        kindIcon: <GitBranchIcon size={11} />,
        badgeIcon: <GitBranchIcon size={13} />,
      };
    case 'checkpoint':
      return {
        upperLabel: 'CHECKPOINTNODE',
        kindIcon: <ShieldIcon size={11} />,
        badgeIcon: <ShieldIcon size={13} />,
      };
    case 'ghost':
      return {
        upperLabel: 'GHOSTNODE',
        kindIcon: <PlusIcon size={11} />,
        badgeIcon: <PlusIcon size={13} />,
      };
    default:
      return {
        upperLabel: 'TASKNODE',
        kindIcon: <FileTextIcon size={11} />,
        badgeIcon: <FileTextIcon size={13} />,
      };
  }
}

function getBorderClass(node: GraphNode): string {
  if (node.kind === 'ghost') {
    return 'border-ghost';
  }
  if (node.kind === 'start') {
    return 'border-indigo';
  }
  if (node.status === 'certified' || node.status === 'waived') {
    return 'border-green';
  }
  if (
    node.status === 'running' ||
    node.status === 'ready' ||
    node.status === 'blocked_human' ||
    node.status === 'rewound'
  ) {
    return 'border-amber';
  }
  if (node.status === 'failed' || node.kind === 'restore') {
    return 'border-red';
  }
  return '';
}

function ForgeStageNode({data}: NodeProps): ReactElement {
  const {node, isSelected, lang} = data as StageNodeData;
  const meta = getKindMeta(node.kind);
  const borderClass = getBorderClass(node);
  const isDone = node.status === 'certified' || node.status === 'waived';
  const isActive =
    node.status === 'running' ||
    node.status === 'ready' ||
    node.status === 'rewound';
  const displayTitle = localizeStageTitle(lang, node);

  return (
    <div
      className={`tg-node-card ${borderClass} ${isSelected ? 'selected' : ''}`}
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Right} id="right-in" />
      <div className="tg-node-kind-row">
        <span style={{color: isDone ? '#16a34a' : '#64748b', display: 'flex'}}>
          {meta.kindIcon}
        </span>
        <span>{meta.upperLabel}</span>
        {isDone && <span style={{color: '#16a34a', fontWeight: 800}}>✓</span>}
        {isActive && (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#eab308',
              display: 'inline-block',
            }}
          />
        )}
      </div>
      <div className="tg-node-title-row" title={displayTitle}>
        <span
          style={{
            color:
              node.kind === 'restore' || node.status === 'failed'
                ? '#dc2626'
                : isDone
                  ? '#16a34a'
                  : '#4f46e5',
            display: 'flex',
          }}
        >
          {meta.badgeIcon}
        </span>
        <span>{displayTitle}</span>
      </div>
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </div>
  );
}

function ForgePhaseNode({data}: NodeProps): ReactElement {
  const {node, doneCount, totalCount, onToggleCollapse} = data as PhaseNodeData;
  const allDone = totalCount > 0 && doneCount === totalCount;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  if (node.collapsed) {
    return (
      <div
        className={`tg-phase-collapsed ${allDone ? '' : 'pending'}`}
        onClick={e => {
          e.stopPropagation();
          onToggleCollapse(node.id, false);
        }}
      >
        <Handle type="target" position={Position.Top} id="top" />
        <Handle type="target" position={Position.Left} id="left" />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              color: '#1e293b',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            <span style={{color: allDone ? '#16a34a' : '#64748b'}}>
              {allDone ? '☑' : '☐'}
            </span>
            <span style={{overflow: 'hidden', textOverflow: 'ellipsis'}}>
              {node.title}
            </span>
          </div>
          <span style={{color: '#64748b', fontSize: 11}}>▸</span>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <span style={{fontSize: 11, fontWeight: 600, color: '#475569'}}>
            {doneCount}/{totalCount}
          </span>
          <div
            style={{
              flex: 1,
              height: 5,
              borderRadius: 999,
              background: '#e2e8f0',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: allDone ? '#4ade80' : '#6366f1',
              }}
            />
          </div>
        </div>
        <Handle type="source" position={Position.Right} id="right" />
        <Handle type="source" position={Position.Bottom} id="bottom" />
      </div>
    );
  }

  return (
    <div className={`tg-phase-expanded ${allDone ? 'done' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <div className="tg-phase-header">
        <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
          <span style={{color: allDone ? '#16a34a' : '#4f46e5'}}>☐</span>
          <span>{node.title}</span>
        </span>
        <button
          type="button"
          className="tg-phase-toggle"
          onClick={e => {
            e.stopPropagation();
            onToggleCollapse(node.id, true);
          }}
        >
          {doneCount}/{totalCount} ▾
        </button>
      </div>
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </div>
  );
}

function ForgeTaskMiniNode({data}: NodeProps): ReactElement {
  const {node, isSelected, lang} = data as TaskMiniNodeData;
  const isDone = node.status === 'certified' || node.status === 'waived';
  const isRunning = node.status === 'running';
  const dotColor = isDone ? '#22c55e' : isRunning ? '#eab308' : '#94a3b8';

  return (
    <div
      className={`tg-task-mini ${isDone ? 'done' : ''} ${isSelected ? 'selected' : ''}`}
      title={`${node.code}: ${node.title}`}
    >
      <Handle type="target" position={Position.Left} id="left" />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11.5,
          fontWeight: 700,
          color: '#1e293b',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
          }}
        />
        <span style={{overflow: 'hidden', textOverflow: 'ellipsis'}}>
          T{node.code} {node.title}
        </span>
      </div>
      <div style={{fontSize: 10, color: '#64748b', paddingLeft: 13}}>
        {formatStatusLabel(lang, node.status)}
      </div>
      <Handle type="source" position={Position.Right} id="right" />
    </div>
  );
}

const NODE_TYPES = {
  forgeStage: ForgeStageNode,
  forgePhase: ForgePhaseNode,
  forgeTaskMini: ForgeTaskMiniNode,
};

function renderWbsStatusIcon(status: GraphNodeStatus): ReactElement {
  if (status === 'certified' || status === 'waived') {
    return (
      <span style={{color: '#22c55e', display: 'flex', marginTop: 1}}>
        <CheckCircleIcon size={15} />
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span style={{color: '#eab308', display: 'flex', marginTop: 1}}>
        <CircleIcon size={15} />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span style={{color: '#ef4444', display: 'flex', marginTop: 1}}>
        <AlertTriangleIcon size={15} />
      </span>
    );
  }
  return (
    <span style={{color: '#cbd5e1', display: 'flex', marginTop: 1}}>
      <CircleIcon size={15} />
    </span>
  );
}

export function WorkstationView(props: {
  readonly lang: UiLang;
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly activeChangeId: string | null;
  readonly onSelectChange: (changeId: string) => void;
  readonly onOpenChangeDashboard: (changeId: string) => void;
  readonly onOpenCreateChangeModal: (repoId?: string) => void;
  readonly liveChunks: readonly TranscriptMessage[];
  readonly refreshTick: number;
  readonly onRefresh: () => void;
}): ReactElement {
  const {
    lang,
    snapshot,
    activeHubId,
    activeChangeId,
    onSelectChange,
    onOpenChangeDashboard,
    onOpenCreateChangeModal,
    liveChunks,
    refreshTick,
    onRefresh,
  } = props;

  const hubRepos = useMemo(
    () => snapshot.repositories.filter(r => r.hubId === activeHubId),
    [snapshot.repositories, activeHubId],
  );
  const hubChanges = useMemo(
    () => snapshot.changes.filter(c => c.hubId === activeHubId),
    [snapshot.changes, activeHubId],
  );

  const selectedChangeRecord =
    hubChanges.find(c => c.id === activeChangeId) ?? hubChanges[0] ?? null;

  const [selectedRepoId, setSelectedRepoId] = useState<string>(
    selectedChangeRecord?.repoId ?? hubRepos[0]?.id ?? '',
  );
  const [activeTab, setActiveTab] = useState<WorkstationTab>('graph');
  const [detail, setDetail] = useState<ChangeDetailSnapshot | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useState(true);
  const [collapsedSidebarPhases, setCollapsedSidebarPhases] = useState<
    Record<string, boolean>
  >({});
  const [diffText, setDiffText] = useState<string | null>(null);
  const [showGhostModal, setShowGhostModal] = useState(false);
  const [ghostTitle, setGhostTitle] = useState('');
  const [ghostDesc, setGhostDesc] = useState('');
  const [sessionMessages, setSessionMessages] = useState<
    readonly TranscriptMessage[]
  >([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selectedChangeRecord) {
      setSelectedRepoId(selectedChangeRecord.repoId);
    } else if (hubRepos[0] && !selectedRepoId) {
      setSelectedRepoId(hubRepos[0].id);
    }
  }, [selectedChangeRecord, hubRepos, selectedRepoId]);

  const repoChanges = useMemo(() => {
    const filtered = hubChanges.filter(c => c.repoId === selectedRepoId);
    return filtered.length > 0 ? filtered : hubChanges;
  }, [hubChanges, selectedRepoId]);

  const effectiveChangeId =
    selectedChangeRecord?.id ?? repoChanges[0]?.id ?? null;

  useEffect(() => {
    if (!effectiveChangeId) {
      setDetail(null);
      return;
    }
    void forgeApi.getChangeDetail(effectiveChangeId).then(d => {
      setDetail(d);
      setSelectedNodeId(prev => {
        if (prev && d.nodes.some(n => n.id === prev)) {
          return prev;
        }
        const firstTask = d.nodes.find(n => n.kind === 'task');
        return firstTask?.id ?? d.nodes[0]?.id ?? null;
      });
    });
  }, [effectiveChangeId, refreshTick]);

  useEffect(() => {
    const latestSession = detail?.sessions[0];
    if (!latestSession) {
      setSessionMessages([]);
      return;
    }
    void forgeApi
      .getSessionMessages(latestSession.id)
      .then(msgs => setSessionMessages(msgs));
  }, [detail?.sessions, refreshTick]);

  const phaseContainers = useMemo(
    () => (detail?.nodes ?? []).filter(n => n.kind === 'phase_container'),
    [detail?.nodes],
  );

  const allTaskNodes = useMemo(
    () =>
      (detail?.nodes ?? []).filter(
        n => n.kind === 'task' || n.kind === 'ghost',
      ),
    [detail?.nodes],
  );

  const doneTaskCount = useMemo(
    () =>
      allTaskNodes.filter(
        n => n.status === 'certified' || n.status === 'waived',
      ).length,
    [allTaskNodes],
  );

  const progressPct =
    allTaskNodes.length > 0
      ? Math.round((doneTaskCount / allTaskNodes.length) * 100)
      : 0;

  const selectedNode = useMemo(
    () =>
      detail?.nodes.find(n => n.id === selectedNodeId) ??
      allTaskNodes[0] ??
      detail?.nodes[0] ??
      null,
    [detail?.nodes, selectedNodeId, allTaskNodes],
  );

  const activeRepo = useMemo(
    () =>
      snapshot.repositories.find(r => r.id === detail?.change.repoId) ??
      hubRepos.find(r => r.id === selectedRepoId) ??
      null,
    [snapshot.repositories, detail?.change.repoId, hubRepos, selectedRepoId],
  );

  const boundDddTerms = useMemo((): readonly DomainTermEntry[] => {
    if (!activeRepo) return [];
    return snapshot.domainTerms.filter(
      t =>
        t.hubId === activeHubId &&
        (t.boundedContext === activeRepo.boundedContext ||
          t.owningRepoIds.includes(activeRepo.id)),
    );
  }, [snapshot.domainTerms, activeHubId, activeRepo]);

  const handleToggleContainerCollapse = async (
    nodeId: string,
    nextCollapsed: boolean,
  ): Promise<void> => {
    await forgeApi.setNodeCollapsed(nodeId, nextCollapsed);
    if (effectiveChangeId) {
      const updated = await forgeApi.getChangeDetail(effectiveChangeId);
      setDetail(updated);
    }
  };

  // Build dynamic React Flow nodes & orthogonal smoothstep edges with zero overlap
  const {rfNodes, rfEdges} = useMemo((): {
    readonly rfNodes: Node[];
    readonly rfEdges: Edge[];
  } => {
    if (!detail) {
      return {rfNodes: [], rfEdges: []};
    }

    const collapsedPhaseIds = new Set(
      detail.nodes
        .filter(n => n.kind === 'phase_container' && n.collapsed)
        .map(n => n.id),
    );

    const sortedContainers = detail.nodes
      .filter(n => n.kind === 'phase_container')
      .sort((a, b) => a.positionY - b.positionY);

    const shiftBeforeY = (rawY: number): number => {
      let delta = 0;
      for (const c of sortedContainers) {
        if (c.collapsed && rawY > c.positionY + 10) {
          delta -= Math.max(0, c.height - 68);
        }
      }
      return rawY + delta;
    };

    const effectivePos = new Map<
      string,
      {
        readonly x: number;
        readonly y: number;
        readonly w: number;
        readonly h: number;
      }
    >();

    const nodesOut: Node[] = [];
    for (const n of detail.nodes) {
      if (n.containerNodeId && collapsedPhaseIds.has(n.containerNodeId)) {
        continue;
      }

      if (n.kind === 'phase_container') {
        const children = detail.nodes.filter(c => c.containerNodeId === n.id);
        const doneChildren = children.filter(
          c => c.status === 'certified' || c.status === 'waived',
        ).length;
        const y = shiftBeforeY(n.positionY);
        const w = n.collapsed ? 228 : n.width;
        const h = n.collapsed ? 66 : n.height;
        effectivePos.set(n.id, {x: n.positionX, y, w, h});

        nodesOut.push({
          id: n.id,
          type: 'forgePhase',
          position: {x: n.positionX, y},
          width: w,
          height: h,
          style: {width: w, height: h},
          data: {
            node: n,
            doneCount: doneChildren,
            totalCount: children.length,
            lang,
            onToggleCollapse: (id: string, col: boolean) => {
              void handleToggleContainerCollapse(id, col);
            },
          } satisfies PhaseNodeData,
        });
        continue;
      }

      if (n.containerNodeId) {
        effectivePos.set(n.id, {
          x: n.positionX,
          y: n.positionY,
          w: n.width,
          h: n.height,
        });
        nodesOut.push({
          id: n.id,
          type: 'forgeTaskMini',
          parentId: n.containerNodeId,
          extent: 'parent',
          position: {x: n.positionX, y: n.positionY},
          width: n.width,
          height: n.height,
          style: {width: n.width, height: n.height},
          data: {
            node: n,
            isSelected: n.id === selectedNodeId,
            lang,
          } satisfies TaskMiniNodeData,
        });
        continue;
      }

      let x = n.positionX;
      let y = shiftBeforeY(n.positionY);
      if (
        n.parentWbsId &&
        collapsedPhaseIds.has(n.parentWbsId) &&
        (n.kind === 'gates' || n.code.endsWith('-DECISION-GATES'))
      ) {
        const parentPos = effectivePos.get(n.parentWbsId);
        if (parentPos) {
          x = parentPos.x + parentPos.w + 72;
          y = n.kind === 'gates' ? parentPos.y : parentPos.y + 88;
        }
      }

      effectivePos.set(n.id, {x, y, w: n.width, h: n.height});
      nodesOut.push({
        id: n.id,
        type: 'forgeStage',
        position: {x, y},
        width: n.width,
        height: n.height,
        style: {width: n.width, height: n.height},
        data: {
          node: n,
          isSelected: n.id === selectedNodeId,
          lang,
        } satisfies StageNodeData,
      });
    }

    const visibleIds = new Set(nodesOut.map(n => n.id));
    const edgesOut: Edge[] = detail.edges
      .filter(
        e => visibleIds.has(e.sourceNodeId) && visibleIds.has(e.targetNodeId),
      )
      .map(e => {
        const src = effectivePos.get(e.sourceNodeId);
        const tgt = effectivePos.get(e.targetNodeId);
        const isInternalDep = e.kind === 'dep';
        const isFailPill = e.kind === 'fail' && e.label === 'FAIL';
        const isRollbackReturn = e.kind === 'fail' && e.label !== 'FAIL';
        const isPassPill = e.label === 'PASS';

        let sourceHandle = 'bottom';
        let targetHandle = 'top';

        if (isInternalDep) {
          sourceHandle = 'right';
          targetHandle = 'left';
        } else if (isRollbackReturn) {
          sourceHandle = 'right';
          targetHandle = 'right-in';
        } else if (src && tgt) {
          const sameRow = Math.abs(src.y - tgt.y) < 42;
          if (sameRow && tgt.x > src.x) {
            sourceHandle = 'right';
            targetHandle = 'left';
          } else if (tgt.x > src.x + 140 && tgt.y <= src.y + 90) {
            sourceHandle = 'right';
            targetHandle = 'left';
          } else {
            sourceHandle = 'bottom';
            targetHandle = 'top';
          }
        }

        const stroke = isInternalDep
          ? '#cbd5e1'
          : isFailPill
            ? '#ef4444'
            : '#7c86f8';

        return {
          id: e.id,
          source: e.sourceNodeId,
          target: e.targetNodeId,
          sourceHandle,
          targetHandle,
          type: 'smoothstep',
          label: isInternalDep ? undefined : e.label || undefined,
          labelStyle: isPassPill
            ? {fill: '#4ade80', fontSize: 9.5, fontWeight: 700}
            : isFailPill
              ? {fill: '#fca5a5', fontSize: 9.5, fontWeight: 700}
              : {fill: '#64748b', fontSize: 9.5, fontWeight: 600},
          labelShowBg: !isInternalDep && Boolean(e.label),
          labelBgPadding: [5, 2.5] as [number, number],
          labelBgBorderRadius: 4,
          labelBgStyle: isPassPill
            ? {fill: '#14532d', fillOpacity: 0.95}
            : isFailPill
              ? {fill: '#334155', fillOpacity: 0.95}
              : {fill: '#f8fafc', fillOpacity: 0.92},
          markerEnd: isInternalDep
            ? undefined
            : {
                type: MarkerType.ArrowClosed,
                color: stroke,
                width: 15,
                height: 15,
              },
          style: {
            stroke,
            strokeWidth: isInternalDep ? 1.1 : 1.65,
            strokeDasharray: isInternalDep ? '3 3' : '5 4',
          },
        };
      });

    return {rfNodes: nodesOut, rfEdges: edgesOut};
  }, [detail, selectedNodeId, lang]);

  const handleRunResume = async (): Promise<void> => {
    if (!detail) {
      return;
    }
    setBusy(true);
    try {
      await forgeApi.executeChange(detail.change.id);
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitGhost = async (): Promise<void> => {
    if (!detail || !selectedNode || !ghostTitle.trim()) {
      return;
    }
    const targetId =
      selectedNode.kind === 'start'
        ? (detail.nodes.find(n => n.kind === 'task')?.id ?? selectedNode.id)
        : selectedNode.id;
    setBusy(true);
    try {
      await forgeApi.proposeGhostNode({
        changeId: detail.change.id,
        title: ghostTitle.trim(),
        description:
          ghostDesc.trim() ||
          tr(
            lang,
            '运行时动态插入的 GhostNode 前置修订切片。',
            'Runtime GhostNode plan amendment slice.',
          ),
        insertBeforeNodeId: targetId,
      });
      setGhostTitle('');
      setGhostDesc('');
      setShowGhostModal(false);
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleInspectDiff = async (): Promise<void> => {
    if (!detail) {
      return;
    }
    const d = await forgeApi.getChangeDiff(detail.change.id);
    setDiffText(`${d.summary}\n\n${d.patch || '(Clean working tree)'}`);
  };

  if (hubChanges.length === 0) {
    return (
      <div className="page-scroll">
        <div className="surface-card">
          <div
            className="surface-card-body"
            style={{textAlign: 'center', padding: 40}}
          >
            <div style={{fontSize: 16, fontWeight: 700, marginBottom: 6}}>
              {tr(lang, '当前联邦中枢暂无在途变更', 'No Active Changes in Hub')}
            </div>
            <p style={{color: '#64748b', marginBottom: 16}}>
              {tr(
                lang,
                '创建一份受控变更单，自动编译同步 WBS 与双生执行图，并开辟物理隔离的 Git Worktree。',
                'Create a governed Change to compile a synchronized WBS + Twin Graph and isolate a physical Git worktree.',
              )}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onOpenCreateChangeModal(hubRepos[0]?.id)}
            >
              <PlusIcon size={14} /> {tr(lang, '新建变更单', 'New Change')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tierTagLabel = activeRepo?.tier === 'infra' ? 'T5 · P1' : 'T3 · P2';

  const changeAuditItems = snapshot.recentAuditLogs.filter(
    a => !detail || a.changeId === detail.change.id || a.changeId === null,
  );

  return (
    <div className="workstation-root">
      {/* Top Workstation Control Strip */}
      <div className="workstation-strip">
        <div className="workstation-strip-left">
          <span className="workstation-brand">
            <span style={{color: '#3b82f6', display: 'flex'}}>
              <GridIcon size={15} />
            </span>
            {tr(lang, 'ForgeOps 工作台', 'ForgeOps Workstation')}
          </span>

          <select
            className="workstation-select"
            value={selectedRepoId}
            onChange={e => {
              const nextRepoId = e.target.value;
              setSelectedRepoId(nextRepoId);
              const matching = hubChanges.find(c => c.repoId === nextRepoId);
              if (matching) {
                onSelectChange(matching.id);
              }
            }}
          >
            {hubRepos.map(r => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          <select
            className="workstation-select"
            value={detail?.change.id ?? ''}
            onChange={e => {
              setDiffText(null);
              onSelectChange(e.target.value);
            }}
          >
            {repoChanges.map(c => {
              const shortTitle =
                c.title.length > 36
                  ? `${c.title.slice(0, 35).replace(/\s+\S*$/, '')}…`
                  : c.title;
              const stLabel =
                c.status === 'certified'
                  ? tr(lang, '已完成', 'completed')
                  : tr(lang, '在途', 'active');
              return (
                <option key={c.id} value={c.id}>
                  {c.code.toLowerCase()} · {shortTitle} ({stLabel})
                </option>
              );
            })}
          </select>

          {detail && (
            <button
              type="button"
              className="tag tag-blue"
              style={{cursor: 'pointer', height: 25, padding: '0 9px'}}
              title={tr(
                lang,
                '打开变更编组与 TQLA 双级门禁治理台',
                'Open Change Team & TQLA Dashboard',
              )}
              onClick={() => onOpenChangeDashboard(detail.change.id)}
            >
              {tierTagLabel}
            </button>
          )}
        </div>

        <div className="workstation-strip-right">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !detail}
            onClick={() => void handleRunResume()}
          >
            <PlayIcon size={12} /> {tr(lang, '启动 / 续跑', 'Run / Resume')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!detail}
            onClick={() => setShowGhostModal(true)}
          >
            <PlusIcon size={13} /> {tr(lang, '计划修订', 'Amendment')}
          </button>
          <button type="button" className="btn btn-sm" onClick={onRefresh}>
            <RefreshIcon size={13} /> {tr(lang, '刷新', 'Refresh')}
          </button>
        </div>
      </div>

      {/* 2-Column Workstation Body */}
      <div className="workstation-body">
        {/* Left Column: Progress + Collapsible Phase & White Task Cards */}
        <aside className="wbs-sidebar">
          <div className="wbs-progress-box">
            <div className="wbs-progress-header">
              <span>{tr(lang, '总体进度', 'Progress')}</span>
              <span className="wbs-progress-pct">{progressPct}%</span>
            </div>
            <div className="wbs-progress-track">
              <div
                className="wbs-progress-fill"
                style={{width: `${progressPct}%`}}
              />
            </div>
            <div className="wbs-progress-sub">
              {doneTaskCount} / {allTaskNodes.length}{' '}
              {tr(lang, '个切片任务', 'tasks')}
            </div>
          </div>

          <div className="wbs-phase-list">
            {phaseContainers.map((phase, idx) => {
              const tasks = (detail?.nodes ?? []).filter(
                n => n.containerNodeId === phase.id,
              );
              const doneInPhase = tasks.filter(
                t => t.status === 'certified' || t.status === 'waived',
              ).length;
              const pct =
                tasks.length > 0
                  ? Math.round((doneInPhase / tasks.length) * 100)
                  : 0;
              const isCollapsed = Boolean(collapsedSidebarPhases[phase.id]);

              return (
                <div key={phase.id}>
                  <button
                    type="button"
                    className="wbs-phase-header"
                    onClick={() =>
                      setCollapsedSidebarPhases(prev => ({
                        ...prev,
                        [phase.id]: !prev[phase.id],
                      }))
                    }
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      {isCollapsed ? (
                        <ChevronRightIcon size={13} />
                      ) : (
                        <ChevronDownIcon size={13} />
                      )}
                      <span>
                        {tr(lang, `阶段 ${idx + 1}`, `Phase ${idx + 1}`)}
                      </span>
                    </span>
                    <span
                      className={`wbs-phase-count ${pct === 100 ? 'done' : ''}`}
                    >
                      {doneInPhase}/{tasks.length} ({pct}%)
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="wbs-task-stack">
                      {tasks.map(t => (
                        <div
                          key={t.id}
                          className={`wbs-task-card ${
                            selectedNode?.id === t.id ? 'selected' : ''
                          }`}
                          onClick={() => {
                            setSelectedNodeId(t.id);
                            setShowInspector(true);
                          }}
                          onDoubleClick={() => {
                            setSelectedNodeId(t.id);
                            setActiveTab('details');
                          }}
                        >
                          {renderWbsStatusIcon(t.status)}
                          <div style={{minWidth: 0, flex: 1}}>
                            <div className="wbs-task-title">
                              {tr(lang, '任务', 'Task')} {t.code}: {t.title}
                            </div>
                            <div
                              className="wbs-task-code"
                              style={{
                                display: 'flex',
                                gap: 6,
                                alignItems: 'center',
                              }}
                            >
                              <span>T{t.code}</span>
                              {t.kind === 'ghost' && (
                                <span className="tag tag-indigo">
                                  {tr(lang, '动态修订', 'Ghost')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Right Column: Task Details | Flow Monitor | Activity | Twin Graph */}
        <section className="workstation-main">
          <div className="workstation-tabs-bar">
            <div className="underline-tabs" style={{borderBottom: 'none'}}>
              {(
                [
                  ['details', tr(lang, '任务详情', 'Task Details')],
                  ['monitor', tr(lang, '实时执行流', 'Flow Monitor')],
                  ['activity', tr(lang, '演进活动', 'Activity')],
                  ['graph', tr(lang, '双生执行图', 'Twin Graph')],
                ] as const
              ).map(([tabKey, label]) => (
                <button
                  key={tabKey}
                  type="button"
                  className={`underline-tab ${activeTab === tabKey ? 'active' : ''}`}
                  onClick={() => setActiveTab(tabKey)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {activeTab === 'details' && (
            <div
              className="workstation-tab-panel"
              style={{padding: '20px 24px'}}
            >
              {selectedNode ? (
                <div className="surface-card">
                  <div className="surface-card-header">
                    <span>
                      {tr(
                        lang,
                        '任务与认知契约信息',
                        'Task & Epistemic Contract Information',
                      )}
                    </span>
                    <div style={{display: 'flex', gap: 8}}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void handleInspectDiff()}
                      >
                        {tr(
                          lang,
                          '检视 Worktree 代码差异',
                          'Inspect Worktree Diff',
                        )}
                      </button>
                      {detail && (
                        <button
                          type="button"
                          className="btn btn-soft btn-sm"
                          onClick={() =>
                            onOpenChangeDashboard(detail.change.id)
                          }
                        >
                          {tr(lang, '编组与门禁配置', 'Configure Team')}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="surface-card-body">
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '16px 32px',
                        marginBottom: 18,
                      }}
                    >
                      <div>
                        <div className="field-label">
                          {tr(lang, '节点编号', 'Task ID')}
                        </div>
                        <div
                          className="selectable"
                          style={{fontWeight: 700, fontSize: 13.5}}
                        >
                          {selectedNode.kind === 'task'
                            ? `T${selectedNode.code}`
                            : selectedNode.code}
                        </div>
                      </div>
                      <div>
                        <div className="field-label">
                          {tr(lang, '所属阶段', 'Phase')}
                        </div>
                        <div style={{fontWeight: 600}}>
                          {(() => {
                            const idx = phaseContainers.findIndex(
                              p =>
                                p.id === selectedNode.containerNodeId ||
                                p.id === selectedNode.parentWbsId,
                            );
                            return idx >= 0
                              ? tr(lang, `阶段 ${idx + 1}`, `Phase ${idx + 1}`)
                              : tr(lang, '全局控制脊柱', 'Global Spine');
                          })()}
                        </div>
                      </div>
                      <div>
                        <div className="field-label">
                          {tr(lang, '认证状态', 'Status')}
                        </div>
                        <span
                          className={`tag ${
                            selectedNode.status === 'certified'
                              ? 'tag-green'
                              : selectedNode.status === 'running'
                                ? 'tag-amber'
                                : selectedNode.status === 'failed'
                                  ? 'tag-red'
                                  : ''
                          }`}
                        >
                          {formatStatusLabel(lang, selectedNode.status)}
                        </span>
                      </div>
                      <div>
                        <div className="field-label">
                          {tr(lang, '指派执行智能体', 'Assignee')}
                        </div>
                        <div style={{color: '#334155', fontWeight: 500}}>
                          {selectedNode.assignedAdapterId
                            ? `${selectedNode.assignedAdapterId} (${selectedNode.assignedModel ?? 'default'})`
                            : '-'}
                        </div>
                      </div>
                    </div>

                    <div style={{marginBottom: 16}}>
                      <div className="field-label">
                        {tr(lang, '切片职责与边界说明', 'Description')}
                      </div>
                      <div
                        className="selectable"
                        style={{color: '#1e293b', lineHeight: 1.65}}
                      >
                        {selectedNode.code}: {selectedNode.title} —{' '}
                        {selectedNode.description}
                      </div>
                    </div>

                    {boundDddTerms.length > 0 && (
                      <div style={{marginBottom: 16}}>
                        <div className="field-label">
                          {tr(
                            lang,
                            '挂载 DDD 领域通用语言约束（严禁混用黑名单同义词）',
                            'Grounded DDD Ubiquitous Language Invariants',
                          )}
                        </div>
                        <div
                          style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}
                        >
                          {boundDddTerms.map(term => (
                            <span
                              key={term.id}
                              className="tag tag-indigo"
                              title={`${term.definition} | 禁用: ${term.forbiddenAliases.join(', ')}`}
                            >
                              {term.canonicalTerm} ({term.localLabel})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedNode.fileScope.length > 0 && (
                      <div style={{marginBottom: 16}}>
                        <div className="field-label">
                          {tr(
                            lang,
                            '受控文件修改边界 (File Scope)',
                            'File Scope',
                          )}
                        </div>
                        <div
                          style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}
                        >
                          {selectedNode.fileScope.map(f => (
                            <span
                              key={f}
                              className="tag selectable"
                              style={{fontFamily: 'var(--font-mono)'}}
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedNode.outputSummary && (
                      <div
                        className="selectable"
                        style={{
                          padding: '10px 14px',
                          borderRadius: 8,
                          background: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          color: '#166534',
                          fontSize: 12.5,
                        }}
                      >
                        <strong>
                          {tr(
                            lang,
                            '已认证交付证据：',
                            'Certified Deliverable: ',
                          )}
                        </strong>
                        {selectedNode.outputSummary}
                      </div>
                    )}

                    {diffText !== null && (
                      <div style={{marginTop: 18}}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 6,
                          }}
                        >
                          <span
                            className="field-label"
                            style={{marginBottom: 0}}
                          >
                            {tr(
                              lang,
                              '物理隔离 Git Worktree 差异',
                              'Isolated Git Worktree Diff',
                            )}{' '}
                            ({detail?.change.gitBranch})
                          </span>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setDiffText(null)}
                          >
                            {tr(lang, '收起差异', 'Close Diff')}
                          </button>
                        </div>
                        <pre
                          className="selectable"
                          style={{
                            margin: 0,
                            padding: 14,
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: 8,
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11.5,
                            maxHeight: 260,
                            overflow: 'auto',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {diffText}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {activeTab === 'monitor' && detail && (
            <div
              className="workstation-tab-panel"
              style={{padding: '20px 24px'}}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 14,
                  marginBottom: 18,
                }}
              >
                <div className="surface-card">
                  <div className="surface-card-body">
                    <div className="field-label">
                      {tr(lang, '变更状态', 'Execution Status')}
                    </div>
                    <div style={{fontSize: 15, fontWeight: 700}}>
                      {formatStatusLabel(lang, detail.change.status)}
                    </div>
                  </div>
                </div>
                <div className="surface-card">
                  <div className="surface-card-body">
                    <div className="field-label">
                      {tr(lang, '隔离工作树分支', 'Git Worktree Branch')}
                    </div>
                    <div
                      className="selectable"
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {detail.change.gitBranch}
                    </div>
                  </div>
                </div>
                <div className="surface-card">
                  <div className="surface-card-body">
                    <div className="field-label">
                      {tr(lang, '门禁质量分', 'Quality Score')}
                    </div>
                    <div
                      style={{fontSize: 15, fontWeight: 700, color: '#16a34a'}}
                    >
                      {Math.round(detail.change.qualityScore * 100)}%
                    </div>
                  </div>
                </div>
                <div className="surface-card">
                  <div className="surface-card-body">
                    <div className="field-label">
                      {tr(lang, '独立切片会话数', 'Sessions Recorded')}
                    </div>
                    <div style={{fontSize: 15, fontWeight: 700}}>
                      {detail.sessions.length}
                    </div>
                  </div>
                </div>
              </div>

              <div className="surface-card">
                <div className="surface-card-header">
                  <span>
                    {tr(
                      lang,
                      '实时智能体执行与工具输出流',
                      'Live Execution Transcript Stream',
                    )}
                  </span>
                  <span className="tag tag-indigo">
                    {tr(lang, 'SSE 实时流已连接', 'SSE Connected')}
                  </span>
                </div>
                <div className="surface-card-body">
                  {[...sessionMessages, ...liveChunks].length === 0 ? (
                    <div style={{color: '#64748b', padding: '12px 0'}}>
                      {tr(
                        lang,
                        '暂无切片会话轨迹。点击右上角「启动 / 续跑」开始无人值守推进。',
                        'No execution transcripts yet. Click Run / Resume in the top bar to launch autonomous slice execution.',
                      )}
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      {[...sessionMessages, ...liveChunks].slice(-24).map(m => (
                        <div
                          key={m.id}
                          style={{
                            padding: '10px 14px',
                            borderRadius: 8,
                            border: '1px solid #e2e8f0',
                            background:
                              m.role === 'assistant' ? '#f8fafc' : '#ffffff',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              marginBottom: 4,
                              fontSize: 11,
                              fontWeight: 700,
                              color: '#4f46e5',
                            }}
                          >
                            <span>
                              {m.role.toUpperCase()}
                              {m.toolName ? ` · ${m.toolName}` : ''}
                            </span>
                            <span style={{color: '#94a3b8'}}>
                              {new Date(m.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                          <div
                            className="selectable"
                            style={{
                              fontSize: 12.5,
                              color: '#1e293b',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {m.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'activity' && (
            <div
              className="workstation-tab-panel"
              style={{padding: '20px 24px'}}
            >
              <div className="surface-card">
                <div className="surface-card-header">
                  <span>
                    {tr(
                      lang,
                      '变更治理与审计时间轴',
                      'Change Activity & Governance Timeline',
                    )}
                  </span>
                  <span className="tag">
                    {changeAuditItems.length} {tr(lang, '条记录', 'events')}
                  </span>
                </div>
                <div className="surface-card-body">
                  {changeAuditItems.length === 0 ? (
                    <div style={{color: '#64748b'}}>
                      {tr(lang, '暂无活动记录。', 'No activity recorded yet.')}
                    </div>
                  ) : (
                    changeAuditItems.map(item => (
                      <div key={item.id} className="evo-log-row">
                        <span className="evo-time-pill">
                          {new Date(item.createdAt).toTimeString().slice(0, 5)}
                        </span>
                        <div style={{fontWeight: 700, color: '#1e293b'}}>
                          {item.title}
                        </div>
                        <div className="selectable" style={{color: '#475569'}}>
                          {item.detail}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'graph' && (
            <div className="workstation-tab-panel graph-mode">
              <div className="tg-floating-pill">
                {tr(
                  lang,
                  '双生执行图 (Phase 阶段容器 + Task 切片嵌套 + TQLA 双级门禁)',
                  'Twin Graph (Phase Container + Nested Tasks + TQLA Gates)',
                )}
              </div>

              {!showInspector && selectedNode && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{
                    position: 'absolute',
                    top: 12,
                    right: 14,
                    zIndex: 6,
                    background: '#ffffff',
                  }}
                  onClick={() => setShowInspector(true)}
                >
                  <EyeIcon size={12} />{' '}
                  {tr(lang, '展开认知检视器', 'Show Node Inspector')}
                </button>
              )}

              {/* SDD §7.2 Floating Node & 4-Section Epistemic Rollover Inspector */}
              {showInspector && selectedNode && (
                <div className="tg-inspector-card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <span style={{fontWeight: 700, color: '#0f172a'}}>
                      {selectedNode.code} ·{' '}
                      {localizeStageTitle(lang, selectedNode)}
                    </span>
                    <button
                      type="button"
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        color: '#94a3b8',
                      }}
                      title={tr(lang, '收起浮层', 'Minimize')}
                      onClick={() => setShowInspector(false)}
                    >
                      ✕
                    </button>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      flexWrap: 'wrap',
                      marginBottom: 8,
                    }}
                  >
                    <span className="tag tag-blue">
                      {formatStatusLabel(lang, selectedNode.status)}
                    </span>
                    <span className="tag">
                      {tr(lang, '尝试', 'Attempts')}:{' '}
                      {selectedNode.attemptCount}/{selectedNode.maxAttempts}
                    </span>
                    {selectedNode.assignedModel && (
                      <span className="tag tag-indigo">
                        {selectedNode.assignedModel}
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      color: '#475569',
                      lineHeight: 1.5,
                      marginBottom: 10,
                    }}
                  >
                    {selectedNode.description}
                  </div>

                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: 7,
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: '#4f46e5',
                        marginBottom: 4,
                      }}
                    >
                      {tr(
                        lang,
                        'SDD 四段式认知移交摘要 (Epistemic Rollover)',
                        'SDD Epistemic Rollover Ledger',
                      )}
                    </div>
                    <div style={{fontSize: 11.5, color: '#334155'}}>
                      <div>
                        •{' '}
                        <strong>
                          {tr(lang, '已证实事实：', 'Confirmed: ')}
                        </strong>
                        {selectedNode.outputSummary ||
                          tr(
                            lang,
                            '遵循限界上下文契约与文件边界',
                            'Grounded to Bounded Context contract',
                          )}
                      </div>
                      <div style={{marginTop: 3}}>
                        •{' '}
                        <strong>
                          {tr(lang, 'DDD 术语锚点：', 'DDD Terms: ')}
                        </strong>
                        {boundDddTerms.length > 0
                          ? boundDddTerms.map(t => t.canonicalTerm).join(', ')
                          : tr(lang, '全局标准词典', 'Hub Standard Glossary')}
                      </div>
                    </div>
                  </div>

                  <div style={{display: 'flex', gap: 6}}>
                    <button
                      type="button"
                      className="btn btn-soft btn-sm"
                      style={{flex: 1}}
                      onClick={() => setActiveTab('details')}
                    >
                      {tr(lang, '完整详情', 'Full Details')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{flex: 1}}
                      onClick={() => setShowGhostModal(true)}
                    >
                      + GhostNode
                    </button>
                  </div>
                </div>
              )}

              {detail ? (
                <ReactFlow
                  key={detail.change.id}
                  nodes={rfNodes}
                  edges={rfEdges}
                  nodeTypes={NODE_TYPES}
                  onNodeClick={(_ev, node) => {
                    setSelectedNodeId(node.id);
                    setShowInspector(true);
                  }}
                  defaultViewport={{x: 42, y: 18, zoom: 0.76}}
                  fitViewOptions={{padding: 0.14}}
                  minZoom={0.25}
                  maxZoom={1.6}
                  colorMode="light"
                  proOptions={{hideAttribution: false}}
                >
                  <Background
                    variant={BackgroundVariant.Dots}
                    gap={20}
                    size={1}
                    color="#cbd5e1"
                  />
                  <Controls showInteractive />
                  <MiniMap
                    pannable
                    zoomable
                    nodeStrokeWidth={2}
                    maskColor="rgba(241, 245, 249, 0.68)"
                    style={{
                      bottom: 48,
                      right: 14,
                      width: 152,
                      height: 98,
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                    }}
                    nodeColor={n => {
                      if (n.type === 'forgePhase') return '#86efac';
                      if (n.type === 'forgeTaskMini') return '#a5b4fc';
                      const st = (n.data as StageNodeData | undefined)?.node
                        ?.status;
                      if (st === 'certified') return '#4ade80';
                      if (st === 'running' || st === 'ready') return '#eab308';
                      if (st === 'failed') return '#f87171';
                      return '#94a3b8';
                    }}
                  />
                </ReactFlow>
              ) : (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#64748b',
                    fontSize: 13,
                  }}
                >
                  {tr(lang, '正在编译加载双生执行图…', 'Loading Twin Graph...')}
                </div>
              )}

              {/* Bottom-left Physical Git Checkpoints Bar */}
              <div className="tg-checkpoints-bar">
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontWeight: 600,
                    color: '#dc2626',
                    flexShrink: 0,
                  }}
                >
                  <ShieldIcon size={13} />{' '}
                  {tr(lang, '物理检查点:', 'Checkpoints:')}
                </span>
                {(detail?.checkpoints ?? []).length === 0 ? (
                  <span style={{color: '#94a3b8', whiteSpace: 'nowrap'}}>
                    {tr(
                      lang,
                      '运行变更后自动锚定 Git 快照（支持零丢码回滚）',
                      'Run Change to anchor QA Checkpoints',
                    )}
                  </span>
                ) : (
                  detail?.checkpoints.map((cp, idx) => {
                    const shortLabel =
                      idx === 0
                        ? tr(lang, '基线快照', 'Baseline')
                        : `${tr(lang, '质量锚点', 'QA CP')} #${idx}`;
                    return (
                      <button
                        key={cp.id}
                        type="button"
                        className="tg-cp-pill"
                        title={tr(
                          lang,
                          `物理回滚工作树至 ${cp.gitCommitSha.slice(0, 8)}（自动创建 refs/forgeops-backup 救援引用）`,
                          `Rollback worktree to ${cp.gitCommitSha.slice(0, 8)} (saves rescue ref)`,
                        )}
                        onClick={() => {
                          if (!detail) return;
                          void forgeApi
                            .restoreToCheckpoint(detail.change.id, cp.id)
                            .then(() => onRefresh());
                        }}
                      >
                        <ShieldIcon size={11} /> {shortLabel} (
                        {cp.gitCommitSha.slice(0, 7)})
                      </button>
                    );
                  })
                )}
              </div>

              {/* Bottom-right Legend Bar */}
              <div className="tg-legend-bar">
                <span className="tg-legend-item">
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      border: '1.5px solid #6366f1',
                      borderRadius: 2,
                      display: 'inline-block',
                    }}
                  />
                  {tr(lang, 'Phase 容器', 'Phase Container')}
                </span>
                <span className="tg-legend-item">
                  <span className="tg-dot" style={{background: '#4ade80'}} />
                  {tr(lang, '已完成', 'Completed')}
                </span>
                <span className="tg-legend-item">
                  <span className="tg-dot" style={{background: '#eab308'}} />
                  {tr(lang, '执行中', 'In Progress')}
                </span>
                <span className="tg-legend-item">
                  <span className="tg-dot" style={{background: '#94a3b8'}} />
                  {tr(lang, '待执行', 'Pending')}
                </span>
                <span className="tg-legend-item">
                  <span
                    className="tg-dot"
                    style={{
                      border: '1.5px dashed #a855f7',
                      background: '#faf5ff',
                    }}
                  />
                  {tr(lang, 'Ghost 计划修订', 'Ghost (Amendment)')}
                </span>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Light Modal for GhostNode Amendment */}
      {showGhostModal && detail && (
        <div
          className="modal-backdrop"
          onClick={() => setShowGhostModal(false)}
        >
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>
                {tr(
                  lang,
                  '提议动态插入 GhostNode 计划修订切片',
                  'Propose GhostNode Plan Amendment',
                )}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowGhostModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div style={{marginBottom: 12}}>
                <label className="field-label">
                  {tr(
                    lang,
                    `在所选节点 (${selectedNode?.code ?? 'Task'}) 之前无环插入前置任务`,
                    `Insert Before Selected Node (${selectedNode?.code ?? 'Task'})`,
                  )}
                </label>
                <input
                  placeholder={tr(
                    lang,
                    '例如：补齐 SettlementVoucher 幂等唯一索引迁移脚本',
                    'e.g. Backfill SettlementVoucher idempotency index',
                  )}
                  value={ghostTitle}
                  onChange={e => setGhostTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">
                  {tr(lang, '切片职责与门禁说明', 'Slice Mandate Description')}
                </label>
                <textarea
                  rows={3}
                  placeholder={tr(
                    lang,
                    '说明涉及文件、不变量约束与验收标准…',
                    'Describe files, invariants, and verification expectation...',
                  )}
                  value={ghostDesc}
                  onChange={e => setGhostDesc(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => setShowGhostModal(false)}
              >
                {tr(lang, '取消', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !ghostTitle.trim()}
                onClick={() => void handleSubmitGhost()}
              >
                {tr(lang, '无环注入双生图', 'Splice GhostNode into DAG')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
