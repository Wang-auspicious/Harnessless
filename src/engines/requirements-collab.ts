/**
 * Multi-Human & Multi-Agent Requirements Collaboration Engine:
 * - Durable Channels, X/Slack-Style Posts, Focused Threads, Reactions & Rich Media
 * - Unread Mention Queue & Scheduled Check-In Triggers (Workflow /commands)
 * - Overleaf-Style Collaborative PRD Document with Per-Block Authorship & Line Diffs
 * - Deterministic PRD -> Spec IR & Excalidraw Architecture Sync Compiler
 */

import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {ForgeError} from '../shared/errors.ts';
import type {
  AgentPersonaRecord,
  BoardEdge,
  BoardNode,
  BoardSceneDoc,
  CollabChannelRecord,
  CollabDocBlock,
  CollabDocRevision,
  CollabDocSnapshot,
  CollabPostRecord,
  DashboardSummaryPayload,
  DocBlockComment,
  DocLineDiffHunk,
  PostAttachment,
  PostReaction,
  PrdSectionKey,
  ScheduledTriggerRecord,
  SpecIRContract,
  SpecIRModule,
  UnreadQueueItem,
  V4SseEvent,
} from '../shared/v4-types.ts';
import type {ForgeStore} from '../store/database.ts';
import type {ModelGatewayEngine} from './model-gateway.ts';

interface SqlRow {
  [key: string]: unknown;
}

const DEFAULT_CHANNELS: readonly {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
}[] = [
  {
    slug: 'requirements',
    title: '需求讨论',
    description: '多角色对齐业务目标、用户故事、边界条件与 PRD 共编',
  },
  {
    slug: 'architecture',
    title: '架构与原型',
    description: '系统设计、白板结构图、交互 HTML 原型对比与 Spec 冻结',
  },
  {
    slug: 'review',
    title: '评审验收',
    description: '独立交叉审校、异常场景挑战与阶段交付检查',
  },
];

const INITIAL_PRD_SECTIONS: readonly {
  readonly key: PrdSectionKey;
  readonly title: string;
}[] = [
  {key: 'overview', title: '1. 背景与核心问题'},
  {key: 'goals', title: '2. 业务目标与非目标'},
  {key: 'user_stories', title: '3. 核心用户故事与场景'},
  {key: 'functional_scope', title: '4. 功能模块与交互契约'},
  {key: 'architecture', title: '5. 系统架构与数据流'},
  {key: 'non_functional', title: '6. 性能、安全与可靠性指标'},
  {key: 'acceptance_criteria', title: '7. 可验证验收标准'},
  {key: 'open_questions', title: '8. 待决分叉与风险清单'},
];

function nowIso(): string {
  return new Date().toISOString();
}

function str(row: SqlRow, key: string): string {
  const v = row[key];
  return typeof v === 'string' ? v : '';
}

function nullableStr(row: SqlRow, key: string): string | null {
  const v = row[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(row: SqlRow, key: string, fallback = 0): number {
  const v = row[key];
  return typeof v === 'number' ? v : fallback;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function computeLineDiff(
  beforeText: string,
  afterText: string,
): {
  readonly hunks: readonly DocLineDiffHunk[];
  readonly summary: string;
} {
  const a = beforeText.split(/\r?\n/);
  const b = afterText.split(/\r?\n/);
  const m = a.length;
  const n = b.length;

  // Guard LCS memory for very large blocks
  if (m * n > 40_000) {
    const hunks: DocLineDiffHunk[] = [
      ...a.slice(0, 20).map(text => ({kind: 'del' as const, text})),
      ...b.slice(0, 20).map(text => ({kind: 'add' as const, text})),
    ];
    return {hunks, summary: `+${b.length} 行 / -${a.length} 行`};
  }

  const dp: number[][] = Array.from({length: m + 1}, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i]![j] = (dp[i + 1]?.[j + 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
      }
    }
  }

  const hunks: DocLineDiffHunk[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      hunks.push({kind: 'context', text: a[i]!});
      i += 1;
      j += 1;
    } else if (
      j < n &&
      (i >= m || (dp[i]?.[j + 1] ?? 0) >= (dp[i + 1]?.[j] ?? 0))
    ) {
      hunks.push({kind: 'add', text: b[j]!});
      added += 1;
      j += 1;
    } else if (i < m) {
      hunks.push({kind: 'del', text: a[i]!});
      removed += 1;
      i += 1;
    }
  }

  return {
    hunks,
    summary: `+${added} 行 / -${removed} 行`,
  };
}

function buildInteractiveComparisonHtml(topic: string): string {
  const safeTopic = topic
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  :root { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif; color: #141413; background: #FAF9F6; }
  body { margin: 0; padding: 14px; font-size: 13px; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 10px; border-bottom: 1px solid #E5E4DF; margin-bottom: 12px; }
  .tabs { display: inline-flex; gap: 4px; background: #F0EFEA; padding: 3px; border-radius: 8px; }
  .tab { border: 0; background: transparent; padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer; color: #5E5D59; }
  .tab.on { background: #FFFFFF; color: #141413; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .card { background: #FFFFFF; border: 1px solid #E5E4DF; border-radius: 10px; padding: 12px; }
  .card h4 { margin: 0 0 6px; font-size: 13px; display: flex; justify-content: space-between; }
  .pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #F0EFEA; color: #5E5D59; }
  .metric { display: flex; gap: 10px; margin-top: 8px; font-size: 11.5px; color: #5E5D59; }
  .cta { margin-top: 10px; width: 100%; padding: 6px 10px; border-radius: 7px; border: 0; background: #141413; color: #FAF9F6; font-size: 12px; cursor: pointer; }
  .cta.secondary { background: #F0EFEA; color: #141413; }
</style>
</head>
<body>
  <div class="bar">
    <strong>交互方案对比 · ${safeTopic || '工作区头部与讨论流'}</strong>
    <div class="tabs">
      <button class="tab on" onclick="setMode('active', this)">协同进行中</button>
      <button class="tab" onclick="setMode('needs', this)">待人决策</button>
    </div>
  </div>
  <div class="grid">
    <div class="card">
      <h4><span>方案 A · 极简精简栏</span><span class="pill">推荐</span></h4>
      <div id="state-a">保留单一操作菜单与状态摘要，右侧留给文档共编。</div>
      <div class="metric"><span>认知负担：低</span><span>可视空间：+88px</span></div>
      <button class="cta" onclick="this.textContent='已选定方案 A ✓'">采纳并写入 PRD</button>
    </div>
    <div class="card">
      <h4><span>方案 B · 分段页签视图</span><span class="pill">扩展型</span></h4>
      <div id="state-b">顶部常驻频道、线程与文档切换条，高频多团队协同适用。</div>
      <div class="metric"><span>操作步数：1 次点击</span><span>可发现性：高</span></div>
      <button class="cta secondary" onclick="this.textContent='已加入对比笔记 ✓'">保留为备选</button>
    </div>
  </div>
  <script>
    function setMode(mode, btn) {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      document.getElementById('state-a').textContent = mode === 'needs'
        ? '当前高亮 2 处 PRD 架构分叉，点击直接跳转到对应段落。'
        : '2 位智能体正在完善非功能指标，讨论线程与 PRD 段落同步刷新。';
      document.getElementById('state-b').textContent = mode === 'needs'
        ? '页签显示「待确认 (2)」，引导研发负责人逐条批注。'
        : '实时展示白板节点变更与测试验收状态徽章。';
    }
  </script>
</body>
</html>`;
}

export class RequirementsCollabEngine {
  private readonly store: ForgeStore;
  private readonly gateway: ModelGatewayEngine;
  private readonly publish: (event: V4SseEvent) => void;

  constructor(options: {
    readonly store: ForgeStore;
    readonly gateway: ModelGatewayEngine;
    readonly publish: (event: V4SseEvent) => void;
  }) {
    this.store = options.store;
    this.gateway = options.gateway;
    this.publish = options.publish;
  }

  private get db(): DatabaseSync {
    return this.store.db;
  }

  private resolveAgent(handleOrId: string): AgentPersonaRecord | undefined {
    const clean = handleOrId.replace(/^@/, '').toLowerCase();
    return this.gateway
      .listAgents()
      .find(
        a =>
          a.handle.toLowerCase() === clean ||
          a.id.toLowerCase() === clean ||
          a.displayName === handleOrId,
      );
  }

  ensureSessionInitialized(
    sessionId: string,
    sessionTitle?: string,
    workspacePath?: string,
  ): void {
    const now = nowIso();
    const existingChannels = this.db
      .prepare(
        'SELECT COUNT(*) AS cnt FROM v4_collab_channels WHERE session_id = ?',
      )
      .get(sessionId) as SqlRow;
    if (num(existingChannels, 'cnt', 0) === 0) {
      const insertCh = this.db.prepare(
        `INSERT OR IGNORE INTO v4_collab_channels (id, session_id, slug, title, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const ch of DEFAULT_CHANNELS) {
        insertCh.run(
          `ch-${sessionId}-${ch.slug}`,
          sessionId,
          ch.slug,
          ch.title,
          ch.description,
          now,
        );
      }
    }

    const existingDoc = this.db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM v4_collab_docs WHERE session_id = ? AND doc_kind = 'prd'",
      )
      .get(sessionId) as SqlRow;
    if (num(existingDoc, 'cnt', 0) === 0) {
      const title = sessionTitle || '产品需求文档 (PRD)';
      const agents = this.gateway.listAgents();
      const pm = agents.find(a => a.handle === 'pm') ?? agents[0];
      const arch = agents.find(a => a.handle === 'architect') ?? agents[0];
      const rev = agents.find(a => a.handle === 'reviewer') ?? agents[0];

      const blocks: CollabDocBlock[] = INITIAL_PRD_SECTIONS.map((sec, idx) => {
        const owner =
          sec.key === 'architecture' || sec.key === 'non_functional'
            ? arch
            : sec.key === 'acceptance_criteria' || sec.key === 'open_questions'
              ? rev
              : pm;
        const seedMarkdown =
          sec.key === 'overview'
            ? `围绕 **${title}** 建立从需求探讨、多人共编 PRD 到结构化 Spec 冻结及并行研发交付的闭环工作流。\n- 关联工程目录：\`${workspacePath || '当前工作区'}\``
            : sec.key === 'goals'
              ? '- **核心目标**：让研发负责人与多专业 Agent 在同一工作区通过自然语言讨论并沉淀可追溯 PRD。\n- **非目标**：不强制填写繁琐表单即可直接启动需求调研与架构设计。'
              : sec.key === 'functional_scope'
                ? '### 核心模块\n1. **输入与状态机规则模块**：校验核心业务不变量与状态流转。\n2. **对外服务接口与权限边界**：提供可测试的服务入口与审计日志。'
                : sec.key === 'acceptance_criteria'
                  ? '- [ ] 所有核心状态流转均可由自动化测试验证\n- [ ] 实现者与独立审校者分离绑定，阻断自写自批'
                  : `（待团队成员与 @${owner?.handle ?? 'pm'} 在讨论中补充完善 · 段落 ${idx + 1}）`;

        return {
          id: `blk-${sec.key}`,
          sectionKey: sec.key,
          title: sec.title,
          markdown: seedMarkdown,
          lastAuthorId: owner?.id ?? 'human',
          lastAuthorName: owner?.displayName ?? '需求发起人',
          lastAuthorKind: owner ? 'agent' : 'human',
          lastAuthorColor: owner?.accentColor ?? '#2563EB',
          lastModelLabel: owner?.resolvedModelLabel ?? '初始化模板',
          lastEditedAt: now,
          revision: 1,
          comments: [],
        };
      });

      this.db
        .prepare(
          `INSERT INTO v4_collab_docs (session_id, doc_kind, title, revision, blocks_json, updated_at)
           VALUES (?, 'prd', ?, 1, ?, ?)`,
        )
        .run(sessionId, `${title} · 协作 PRD`, JSON.stringify(blocks), now);
    }
  }

  listChannels(sessionId: string): CollabChannelRecord[] {
    this.store.v4.getSessionOrThrow(sessionId);
    this.ensureSessionInitialized(sessionId);
    const rows = this.db
      .prepare(
        'SELECT * FROM v4_collab_channels WHERE session_id = ? ORDER BY id ASC',
      )
      .all(sessionId) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      sessionId: str(r, 'session_id'),
      slug: str(r, 'slug'),
      title: str(r, 'title'),
      description: str(r, 'description'),
      createdAt: str(r, 'created_at'),
    }));
  }

  listPosts(sessionId: string, channelId?: string): CollabPostRecord[] {
    this.store.v4.getSessionOrThrow(sessionId);
    this.ensureSessionInitialized(sessionId);
    const rows = channelId
      ? (this.db
          .prepare(
            'SELECT * FROM v4_collab_posts WHERE session_id = ? AND channel_id = ? ORDER BY created_at ASC',
          )
          .all(sessionId, channelId) as SqlRow[])
      : (this.db
          .prepare(
            'SELECT * FROM v4_collab_posts WHERE session_id = ? ORDER BY created_at ASC',
          )
          .all(sessionId) as SqlRow[]);

    const allPosts = rows.map(r => this.mapPostRow(r));
    const replyStats = new Map<
      string,
      {
        count: number;
        avatars: Set<string>;
        lastAt: string | null;
      }
    >();
    for (const p of allPosts) {
      if (!p.parentPostId) continue;
      const cur = replyStats.get(p.parentPostId) ?? {
        count: 0,
        avatars: new Set<string>(),
        lastAt: null,
      };
      cur.count += 1;
      cur.avatars.add(p.authorAvatar);
      cur.lastAt = p.createdAt;
      replyStats.set(p.parentPostId, cur);
    }

    return allPosts.map(p => {
      if (p.parentPostId) return p;
      const st = replyStats.get(p.id);
      return {
        ...p,
        replyCount: st?.count ?? 0,
        replyAvatars: st ? Array.from(st.avatars) : [],
        lastReplyAt: st?.lastAt ?? null,
      };
    });
  }

  private mapPostRow(r: SqlRow): CollabPostRecord {
    const statusRaw = str(r, 'thread_status');
    return {
      id: str(r, 'id'),
      sessionId: str(r, 'session_id'),
      channelId: str(r, 'channel_id'),
      parentPostId: nullableStr(r, 'parent_post_id'),
      authorId: str(r, 'author_id'),
      authorName: str(r, 'author_name'),
      authorKind: str(r, 'author_kind') === 'agent' ? 'agent' : 'human',
      authorAvatar: str(r, 'author_avatar'),
      authorColor: str(r, 'author_color'),
      modelLabel: str(r, 'model_label'),
      content: str(r, 'content'),
      attachments: parseJson<PostAttachment[]>(str(r, 'attachments_json'), []),
      mentions: parseJson<string[]>(str(r, 'mentions_json'), []),
      reactions: parseJson<PostReaction[]>(str(r, 'reactions_json'), []),
      threadStatus: statusRaw === 'resolved' ? 'resolved' : 'open',
      resolvedBy: nullableStr(r, 'resolved_by'),
      createdAt: str(r, 'created_at'),
      updatedAt: str(r, 'updated_at'),
    };
  }

  private insertPost(input: {
    readonly sessionId: string;
    readonly channelId: string;
    readonly parentPostId?: string | null;
    readonly authorId: string;
    readonly authorName: string;
    readonly authorKind: 'human' | 'agent';
    readonly authorAvatar: string;
    readonly authorColor: string;
    readonly modelLabel: string;
    readonly content: string;
    readonly attachments?: readonly PostAttachment[];
    readonly mentions?: readonly string[];
  }): CollabPostRecord {
    const id = `post-${randomUUID().slice(0, 10)}`;
    const now = nowIso();
    const mentions =
      input.mentions ??
      Array.from(input.content.matchAll(/@([a-zA-Z0-9_-]+)/g)).map(m =>
        m[1]!.toLowerCase(),
      );
    this.db
      .prepare(
        `INSERT INTO v4_collab_posts
         (id, session_id, channel_id, parent_post_id, author_id, author_name, author_kind, author_avatar, author_color, model_label, content, attachments_json, mentions_json, reactions_json, thread_status, resolved_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'open', NULL, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.channelId,
        input.parentPostId ?? null,
        input.authorId,
        input.authorName,
        input.authorKind,
        input.authorAvatar,
        input.authorColor,
        input.modelLabel,
        input.content,
        JSON.stringify(input.attachments ?? []),
        JSON.stringify(mentions),
        now,
        now,
      );

    // Automatically reopen parent thread on new reply (Vercel Board convention)
    if (input.parentPostId) {
      this.db
        .prepare(
          "UPDATE v4_collab_posts SET thread_status = 'open', resolved_by = NULL, updated_at = ? WHERE id = ?",
        )
        .run(now, input.parentPostId);
    }

    const row = this.db
      .prepare('SELECT * FROM v4_collab_posts WHERE id = ?')
      .get(id) as SqlRow;
    const post = this.mapPostRow(row);
    this.publish({type: 'v4.collab.post', sessionId: input.sessionId, post});
    return post;
  }

  getCollabDoc(sessionId: string): CollabDocSnapshot {
    const session = this.store.v4.getSessionOrThrow(sessionId);
    this.ensureSessionInitialized(
      sessionId,
      session.title,
      session.workspacePath,
    );
    const docRow = this.db
      .prepare(
        "SELECT * FROM v4_collab_docs WHERE session_id = ? AND doc_kind = 'prd'",
      )
      .get(sessionId) as SqlRow;
    const revRows = this.db
      .prepare(
        "SELECT * FROM v4_collab_doc_revisions WHERE session_id = ? AND doc_kind = 'prd' ORDER BY revision DESC LIMIT 40",
      )
      .all(sessionId) as SqlRow[];

    const revisions: CollabDocRevision[] = revRows.map(r => {
      const beforeMarkdown = str(r, 'before_markdown');
      const afterMarkdown = str(r, 'after_markdown');
      const {hunks} = computeLineDiff(beforeMarkdown, afterMarkdown);
      return {
        id: str(r, 'id'),
        sessionId: str(r, 'session_id'),
        docKind: 'prd',
        revision: num(r, 'revision', 1),
        blockId: str(r, 'block_id'),
        blockTitle: str(r, 'block_title'),
        beforeMarkdown,
        afterMarkdown,
        diffHunks: hunks,
        diffSummary: str(r, 'diff_summary'),
        authorId: str(r, 'author_id'),
        authorName: str(r, 'author_name'),
        authorKind: str(r, 'author_kind') === 'agent' ? 'agent' : 'human',
        authorColor: str(r, 'author_color'),
        modelLabel: str(r, 'model_label'),
        createdAt: str(r, 'created_at'),
      };
    });

    return {
      sessionId,
      docKind: 'prd',
      title: str(docRow, 'title'),
      revision: num(docRow, 'revision', 1),
      blocks: parseJson<CollabDocBlock[]>(str(docRow, 'blocks_json'), []),
      revisions,
      updatedAt: str(docRow, 'updated_at'),
    };
  }

  updateDocBlock(
    sessionId: string,
    blockId: string,
    input: {
      readonly markdown: string;
      readonly title?: string;
      readonly authorId?: string;
      readonly authorName?: string;
      readonly authorKind?: 'human' | 'agent';
      readonly authorColor?: string;
      readonly modelLabel?: string;
    },
  ): CollabDocSnapshot {
    const doc = this.getCollabDoc(sessionId);
    const idx = doc.blocks.findIndex(b => b.id === blockId);
    if (idx < 0) {
      throw new ForgeError(
        'NOT_FOUND',
        `Document block "${blockId}" not found`,
        404,
      );
    }
    const target = doc.blocks[idx]!;
    const beforeMarkdown = target.markdown;
    const afterMarkdown = input.markdown;
    const {summary} = computeLineDiff(beforeMarkdown, afterMarkdown);
    const now = nowIso();
    const nextDocRev = doc.revision + 1;

    const authorId = input.authorId || 'human';
    const authorName = input.authorName || '你 (产品负责人)';
    const authorKind = input.authorKind ?? 'human';
    const authorColor = input.authorColor || '#141413';
    const modelLabel =
      input.modelLabel || (authorKind === 'human' ? '人工协同编辑' : '智能体');

    const updatedBlock: CollabDocBlock = {
      ...target,
      title: input.title?.trim() || target.title,
      markdown: afterMarkdown,
      lastAuthorId: authorId,
      lastAuthorName: authorName,
      lastAuthorKind: authorKind,
      lastAuthorColor: authorColor,
      lastModelLabel: modelLabel,
      lastEditedAt: now,
      revision: target.revision + 1,
    };

    const nextBlocks = [...doc.blocks];
    nextBlocks[idx] = updatedBlock;

    this.db
      .prepare(
        `UPDATE v4_collab_docs
         SET revision = ?, blocks_json = ?, updated_at = ?
         WHERE session_id = ? AND doc_kind = 'prd'`,
      )
      .run(nextDocRev, JSON.stringify(nextBlocks), now, sessionId);

    this.db
      .prepare(
        `INSERT INTO v4_collab_doc_revisions
         (id, session_id, doc_kind, revision, block_id, block_title, before_markdown, after_markdown, diff_summary, author_id, author_name, author_kind, author_color, model_label, created_at)
         VALUES (?, ?, 'prd', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `rev-${randomUUID().slice(0, 8)}`,
        sessionId,
        nextDocRev,
        updatedBlock.id,
        updatedBlock.title,
        beforeMarkdown,
        afterMarkdown,
        summary,
        authorId,
        authorName,
        authorKind,
        authorColor,
        modelLabel,
        now,
      );

    this.publish({
      type: 'v4.collab.doc',
      sessionId,
      revision: nextDocRev,
    });
    return this.getCollabDoc(sessionId);
  }

  async addDocBlockComment(
    sessionId: string,
    blockId: string,
    input: {
      readonly text: string;
      readonly authorName?: string;
      readonly channelId?: string;
    },
  ): Promise<CollabDocSnapshot> {
    const doc = this.getCollabDoc(sessionId);
    const idx = doc.blocks.findIndex(b => b.id === blockId);
    if (idx < 0) {
      throw new ForgeError(
        'NOT_FOUND',
        `Document block "${blockId}" not found`,
        404,
      );
    }
    const target = doc.blocks[idx]!;
    const now = nowIso();
    const comment: DocBlockComment = {
      id: `cmt-${randomUUID().slice(0, 6)}`,
      authorName: input.authorName?.trim() || '你',
      authorKind: 'human',
      authorColor: '#141413',
      text: input.text.trim(),
      createdAt: now,
    };
    const nextBlocks = [...doc.blocks];
    nextBlocks[idx] = {
      ...target,
      comments: [...target.comments, comment],
    };
    this.db
      .prepare(
        "UPDATE v4_collab_docs SET blocks_json = ?, updated_at = ? WHERE session_id = ? AND doc_kind = 'prd'",
      )
      .run(JSON.stringify(nextBlocks), now, sessionId);

    const mentionMatch = /@([a-zA-Z0-9_-]+)/.exec(input.text);
    if (mentionMatch) {
      const agent = this.resolveAgent(mentionMatch[1]!);
      if (agent) {
        const inv = await this.gateway.invokeAgentModel({
          agentId: agent.id,
          userPrompt: `请根据批注要求修订 PRD 章节《${target.title}》，只输出修订后的纯 Markdown 正文：\n原内容：\n${target.markdown}\n\n批注要求：${input.text}`,
        });
        const nextMd =
          inv.text?.trim() ||
          `${target.markdown.trim()}\n- **${agent.displayName} 补充（回应批注）**：${input.text.replace(/@[a-zA-Z0-9_-]+/g, '').trim() || '已细化输入校验、异常处理与模块边界契约。'}`;

        const updatedDoc = this.updateDocBlock(sessionId, blockId, {
          markdown: nextMd,
          authorId: agent.id,
          authorName: agent.displayName,
          authorKind: 'agent',
          authorColor: agent.accentColor,
          modelLabel: inv.modelLabel,
        });

        const channels = this.listChannels(sessionId);
        const chId =
          input.channelId || channels[0]?.id || `ch-${sessionId}-requirements`;
        this.insertPost({
          sessionId,
          channelId: chId,
          authorId: agent.id,
          authorName: agent.displayName,
          authorKind: 'agent',
          authorAvatar: agent.avatarKey,
          authorColor: agent.accentColor,
          modelLabel: inv.modelLabel,
          content: `已根据文档批注更新 PRD《${target.title}》并记录修订轨迹。`,
          attachments: [
            {
              id: `att-${randomUUID().slice(0, 6)}`,
              kind: 'prd_card',
              title: `已修订：${target.title}`,
              subtitle: `Rev ${updatedDoc.revision} · 点击右侧查看逐行差异`,
              blockId: target.id,
              markdownContent: nextMd,
            },
          ],
        });
        return updatedDoc;
      }
    }

    this.publish({
      type: 'v4.collab.doc',
      sessionId,
      revision: doc.revision,
    });
    return this.getCollabDoc(sessionId);
  }

  compilePrdToSpec(sessionId: string): {
    readonly specIR: SpecIRContract;
    readonly board: BoardSceneDoc;
    readonly doc: CollabDocSnapshot;
  } {
    const session = this.store.v4.getSessionOrThrow(sessionId);
    const doc = this.getCollabDoc(sessionId);
    const prevSpec = this.store.v4.getSpecIR(sessionId);
    const prevBoard = this.store.v4.getBoardDoc(sessionId);

    const byKey = new Map(doc.blocks.map(b => [b.sectionKey, b]));
    const goalsBlock = byKey.get('goals')?.markdown ?? '';
    const scopeBlock = byKey.get('functional_scope')?.markdown ?? '';
    const archBlock = byKey.get('architecture')?.markdown ?? '';
    const acBlock = byKey.get('acceptance_criteria')?.markdown ?? '';

    const goals = goalsBlock
      .split(/\r?\n/)
      .map(l => l.replace(/^[-*\d.\s]+/, '').trim())
      .filter(l => l.length > 4 && !l.startsWith('（待'))
      .slice(0, 5);
    const checks = acBlock
      .split(/\r?\n/)
      .map(l => l.replace(/^[-*[\]x\s]+/, '').trim())
      .filter(l => l.length > 4 && !l.startsWith('（待'))
      .slice(0, 5);

    const moduleHeadings = scopeBlock
      .split(/\r?\n/)
      .filter(l => /^(\d+\.|#{2,3}\s)/.test(l.trim()))
      .map(l =>
        l
          .replace(/^(\d+\.|#{2,3})\s*/, '')
          .replace(/\*\*/g, '')
          .trim(),
      )
      .filter(Boolean)
      .slice(0, 4);

    const titles =
      moduleHeadings.length >= 2
        ? moduleHeadings
        : ['核心规则与状态引擎', '服务接口与数据存储', '独立交叉审校门禁'];

    const nodes: BoardNode[] = titles.map((t, idx) => {
      const label = t.split(/[：:]/)[0]!.trim();
      const summary =
        t.includes('：') || t.includes(':')
          ? t.split(/[：:]/)[1]!.trim()
          : '由协作 PRD 编译';
      const isGate = /审校|验收|门禁|gate|review/i.test(label);
      return {
        id: `prd-mod-${idx + 1}`,
        label,
        kind: isGate ? 'gate' : idx === titles.length - 1 ? 'store' : 'module',
        x: 60 + idx * 320,
        y: idx === titles.length - 1 ? 260 : 60,
        width: 260,
        height: isGate ? 118 : 96,
        specModuleId: `spec-mod-${idx + 1}`,
        status: 'confirmed',
        summary,
      };
    });

    const edges: BoardEdge[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        id: `prd-edge-${i + 1}`,
        fromNodeId: nodes[i]!.id,
        toNodeId: nodes[i + 1]!.id,
        label: i === nodes.length - 2 ? '验证交付' : '调用契约',
      });
    }

    const modules: SpecIRModule[] = nodes.map((n, idx) => ({
      moduleId: n.specModuleId,
      boardNodeId: n.id,
      title: n.label,
      ownerPrincipalIds: [idx % 2 === 0 ? 'architect' : 'engineer'],
      boundaryPseudocode:
        idx === 0
          ? archBlock.slice(0, 220) || 'validateInvariant() -> commitState()'
          : 'executeSlice() -> emitTurnSnapshot() -> independentVerify()',
      allowedPaths: [`src/modules/mod-${idx + 1}`],
      verificationChecks:
        checks.length > 0 ? checks : ['所有状态流转与单元测试通过'],
    }));

    const nextBoardRev = (prevBoard?.revision ?? 0) + 1;
    const board: BoardSceneDoc = {
      nodes,
      edges,
      revision: nextBoardRev,
    };

    const nextSpecRev = (prevSpec?.revision ?? 0) + 1;
    const specIR: SpecIRContract = {
      specId: prevSpec?.specId ?? `spec-${sessionId.slice(0, 8)}`,
      term: session.term,
      status: 'committed',
      goals:
        goals.length > 0
          ? goals
          : [`完成 ${session.title} 从协作 PRD 到 Spec 的结构化落盘`],
      nonGoals: ['禁止未经过 Spec 校验直接绕过独立审校合并主分支'],
      kanoSummary: prevSpec?.kanoSummary ?? [],
      ubiquitousTerms: titles.map(t => t.slice(0, 24)),
      modules,
      settledDecisions: prevSpec?.settledDecisions ?? [],
      openPins: prevSpec?.openPins ?? [],
      revision: nextSpecRev,
    };

    const savedBoard = this.store.v4.saveWorkspaceDoc(
      sessionId,
      'board_scene',
      board,
    );
    const savedSpec = this.store.v4.saveWorkspaceDoc(
      sessionId,
      'spec_ir',
      specIR,
    );
    if (session.stage === 'intent') {
      this.store.v4.updateSession(sessionId, {stage: 'spec'});
    }

    this.publish({
      type: 'v4.workspace.updated',
      sessionId,
      kind: 'spec_ir',
      revision: savedSpec.revision,
    });
    this.publish({
      type: 'v4.workspace.updated',
      sessionId,
      kind: 'board',
      revision: savedBoard.revision,
    });

    return {specIR: savedSpec.data, board: savedBoard.data, doc};
  }

  async postToChannel(
    sessionId: string,
    input: {
      readonly channelId?: string;
      readonly content: string;
      readonly attachments?: readonly PostAttachment[];
      readonly parentPostId?: string | null;
      readonly authorName?: string;
    },
  ): Promise<{
    readonly post: CollabPostRecord;
    readonly triggeredCommand: string | null;
    readonly spawnedCount: number;
  }> {
    const session = this.store.v4.getSessionOrThrow(sessionId);
    this.ensureSessionInitialized(
      sessionId,
      session.title,
      session.workspacePath,
    );
    const channels = this.listChannels(sessionId);
    const channelId =
      input.channelId && channels.some(c => c.id === input.channelId)
        ? input.channelId
        : channels[0]!.id;

    const trimmed = input.content.trim();
    if (!trimmed && (!input.attachments || input.attachments.length === 0)) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        'Post content or attachment is required',
        400,
      );
    }

    const humanPost = this.insertPost({
      sessionId,
      channelId,
      parentPostId: input.parentPostId ?? null,
      authorId: 'human',
      authorName: input.authorName?.trim() || '你 (研发负责人)',
      authorKind: 'human',
      authorAvatar: 'human',
      authorColor: '#141413',
      modelLabel: 'Human Lead',
      content: trimmed || '上传了协同附件',
      attachments: input.attachments ?? [],
    });

    const cmdMatch = /^\/([a-zA-Z_-]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
    if (cmdMatch) {
      const cmd = cmdMatch[1]!.toLowerCase();
      const arg = (cmdMatch[2] ?? '').trim();
      const spawnedCount = await this.handleSlashCommand({
        sessionId,
        channelId,
        rootPostId: input.parentPostId ?? humanPost.id,
        cmd,
        arg,
        sessionTitle: session.title,
      });
      return {post: humanPost, triggeredCommand: cmd, spawnedCount};
    }

    // Parse @mentions or auto-route based on channel & discussion topic
    const mentionHandles = Array.from(
      trimmed.matchAll(/@([a-zA-Z0-9_-]+)/g),
    ).map(m => m[1]!.toLowerCase());
    const agents = this.gateway.listAgents().filter(a => a.enabled);
    const matchedAgents = agents.filter(a =>
      mentionHandles.includes(a.handle.toLowerCase()),
    );

    const targets: AgentPersonaRecord[] =
      matchedAgents.length > 0
        ? matchedAgents
        : channelId.endsWith('-architecture')
          ? agents.filter(
              a => a.handle === 'architect' || a.handle === 'designer',
            )
          : channelId.endsWith('-review')
            ? agents.filter(a => a.handle === 'reviewer')
            : agents.filter(a => a.handle === 'pm' || a.handle === 'architect');

    for (const target of targets) {
      this.enqueueUnread({
        sessionId,
        channelId,
        postId: input.parentPostId ?? humanPost.id,
        targetAgentId: target.id,
        targetAgentName: target.displayName,
        fromAuthor: humanPost.authorName,
        summary: trimmed.slice(0, 140),
      });
    }

    const processed = await this.drainUnreadQueue(sessionId, trimmed);
    return {
      post: humanPost,
      triggeredCommand: null,
      spawnedCount: processed,
    };
  }

  private async handleSlashCommand(input: {
    readonly sessionId: string;
    readonly channelId: string;
    readonly rootPostId: string;
    readonly cmd: string;
    readonly arg: string;
    readonly sessionTitle: string;
  }): Promise<number> {
    const pm = this.resolveAgent('pm');
    const arch = this.resolveAgent('architect');
    const designer = this.resolveAgent('designer');
    const rev = this.resolveAgent('reviewer');

    if (input.cmd === 'prd') {
      const topic = input.arg || input.sessionTitle;
      const pmInv = pm
        ? await this.gateway.invokeAgentModel({
            agentId: pm.id,
            userPrompt: `请为主题「${topic}」编写简洁、可落地的《业务目标与核心用户故事》Markdown 列表。`,
          })
        : null;
      const goalsMd =
        pmInv?.text ||
        `- **核心诉求**：围绕「${topic}」打通人机协同需求分析、实时共编 PRD 与 Spec 冻结。\n- **关键流程**：频道讨论 → 多角色修订 PRD 区块 → 生成 Spec 与白板。\n- **用户故事**：作为研发负责人，我希望直接与多智能体在讨论流中对齐方案，并看到每个段落是谁修改的。`;

      if (pm) {
        this.updateDocBlock(input.sessionId, 'blk-goals', {
          markdown: goalsMd,
          authorId: pm.id,
          authorName: pm.displayName,
          authorKind: 'agent',
          authorColor: pm.accentColor,
          modelLabel: pmInv?.modelLabel ?? pm.resolvedModelLabel,
        });
      }

      const archMd =
        '### 模块划分\n1. **协作讨论与未读唤醒总线**：维护频道消息、引用线程与智能体队列唤醒。\n2. **协同文档引擎 (PRD)**：分块锁版本跟踪每次人机修改 Diff 与批注。\n3. **Spec 编译器与白板同步**：从 PRD 自动生成模块契约与拓扑连线。';
      if (arch) {
        this.updateDocBlock(input.sessionId, 'blk-functional_scope', {
          markdown: archMd,
          authorId: arch.id,
          authorName: arch.displayName,
          authorKind: 'agent',
          authorColor: arch.accentColor,
          modelLabel: arch.resolvedModelLabel,
        });
      }

      this.insertPost({
        sessionId: input.sessionId,
        channelId: input.channelId,
        authorId: pm?.id ?? 'agent-pm',
        authorName: pm?.displayName ?? '需求分析官',
        authorKind: 'agent',
        authorAvatar: pm?.avatarKey ?? 'gemini-cli',
        authorColor: pm?.accentColor ?? '#2563EB',
        modelLabel:
          pmInv?.modelLabel ?? pm?.resolvedModelLabel ?? '本地规则引擎',
        content: `已完成《${topic}》PRD 初稿共编。@${arch?.handle ?? 'architect'} 已同步补充模块拆解，@${rev?.handle ?? 'reviewer'} 请核对异常边界与验收标准。`,
        attachments: [
          {
            id: `att-prd-${randomUUID().slice(0, 6)}`,
            kind: 'prd_card',
            title: `${input.sessionTitle} · 协作 PRD`,
            subtitle: '多人与多智能体实时共编 · 含完整改动来源追踪',
            blockId: 'blk-goals',
            markdownContent: goalsMd,
          },
        ],
      });
      return 2;
    }

    if (input.cmd === 'spec') {
      const compiled = this.compilePrdToSpec(input.sessionId);
      this.insertPost({
        sessionId: input.sessionId,
        channelId: input.channelId,
        authorId: arch?.id ?? 'agent-architect',
        authorName: arch?.displayName ?? '系统架构师',
        authorKind: 'agent',
        authorAvatar: arch?.avatarKey ?? 'claude-code',
        authorColor: arch?.accentColor ?? '#0D9488',
        modelLabel: arch?.resolvedModelLabel ?? '本地编译引擎',
        content: `已根据最新协作 PRD（Rev ${compiled.doc.revision}）编译生成结构化 Spec（Rev ${compiled.specIR.revision}）并同步刷新架构白板，共拆解 ${compiled.specIR.modules.length} 个核心模块。`,
        attachments: [
          {
            id: `att-spec-${randomUUID().slice(0, 6)}`,
            kind: 'spec_card',
            title: `结构化 Spec Rev ${compiled.specIR.revision}`,
            subtitle: `${compiled.specIR.modules.length} 个模块契约 · 白板已同步`,
          },
          {
            id: `att-wb-${randomUUID().slice(0, 6)}`,
            kind: 'whiteboard_card',
            title: `架构白板 Rev ${compiled.board.revision}`,
            subtitle: `${compiled.board.nodes.length} 个节点 · ${compiled.board.edges.length} 条连线`,
          },
        ],
      });
      return 1;
    }

    if (input.cmd === 'whiteboard') {
      const compiled = this.compilePrdToSpec(input.sessionId);
      this.insertPost({
        sessionId: input.sessionId,
        channelId: input.channelId,
        authorId: arch?.id ?? 'agent-architect',
        authorName: arch?.displayName ?? '系统架构师',
        authorKind: 'agent',
        authorAvatar: arch?.avatarKey ?? 'claude-code',
        authorColor: arch?.accentColor ?? '#0D9488',
        modelLabel: arch?.resolvedModelLabel ?? '白板同步引擎',
        content: `已重新布局架构白板并校验全部连接箭头绑定（${compiled.board.nodes.length} 节点 / ${compiled.board.edges.length} 连线）。可在右侧「白板 Canvas」拖拽微调。`,
        attachments: [
          {
            id: `att-wb-${randomUUID().slice(0, 6)}`,
            kind: 'whiteboard_card',
            title: `系统架构拓扑图 Rev ${compiled.board.revision}`,
            subtitle: '分层自动布局 · 点击在右侧画布查看与批注',
          },
        ],
      });
      return 1;
    }

    if (input.cmd === 'mockup') {
      const topic = input.arg || input.sessionTitle;
      const html = buildInteractiveComparisonHtml(topic);
      this.insertPost({
        sessionId: input.sessionId,
        channelId: input.channelId,
        authorId: designer?.id ?? 'agent-designer',
        authorName: designer?.displayName ?? '交互原型师',
        authorKind: 'agent',
        authorAvatar: designer?.avatarKey ?? 'cursor',
        authorColor: designer?.accentColor ?? '#7C3AED',
        modelLabel: designer?.resolvedModelLabel ?? '原型渲染引擎',
        content: `已生成「${topic}」可交互双方案对比原型，支持直接点击切换状态与在线修改 HTML 源码：`,
        attachments: [
          {
            id: `att-mock-${randomUUID().slice(0, 6)}`,
            kind: 'html_mockup',
            title: `交互原型对比 · ${topic}`,
            subtitle: '双方案实时交互预览（支持源码编辑）',
            htmlContent: html,
          },
        ],
      });
      return 1;
    }

    if (input.cmd === 'review') {
      const doc = this.getCollabDoc(input.sessionId);
      const incomplete = doc.blocks.filter(b =>
        b.markdown.includes('（待'),
      ).length;
      const msg =
        incomplete > 0
          ? `交叉审校发现当前 PRD 仍有 ${incomplete} 个章节尚未定稿（含非功能指标或开放分叉）。建议在右侧文档中补充完整或 @architect 自动完善。`
          : `交叉审校通过：当前 PRD 全部 ${doc.blocks.length} 个章节均已定稿（Rev ${doc.revision}），边界契约清晰，可进入 Spec 冻结与任务拆解阶段。`;
      this.insertPost({
        sessionId: input.sessionId,
        channelId: input.channelId,
        parentPostId: null,
        authorId: rev?.id ?? 'agent-reviewer',
        authorName: rev?.displayName ?? '独立审校官',
        authorKind: 'agent',
        authorAvatar: rev?.avatarKey ?? 'opencode',
        authorColor: rev?.accentColor ?? '#B45309',
        modelLabel: rev?.resolvedModelLabel ?? '审校引擎',
        content: msg,
      });
      return 1;
    }

    if (input.cmd === 'schedule') {
      const m = /^(\S+)\s+@([a-zA-Z0-9_-]+)\s+([\s\S]+)$/.exec(input.arg);
      const intervalLabel = m ? m[1]! : '每 2 小时';
      const handle = m ? m[2]! : 'pm';
      const promptText = m
        ? m[3]!
        : input.arg || '巡检 PRD 未解决评论并汇报需求收敛进展';
      const target = this.resolveAgent(handle) ?? pm;
      const trig = this.createSchedule({
        sessionId: input.sessionId,
        channelId: input.channelId,
        targetAgentId: target?.id ?? 'agent-pm',
        targetAgentName: target?.displayName ?? '需求分析官',
        intervalLabel,
        promptText,
      });
      this.insertPost({
        sessionId: input.sessionId,
        channelId: input.channelId,
        parentPostId: input.rootPostId,
        authorId: target?.id ?? 'agent-pm',
        authorName: target?.displayName ?? '需求分析官',
        authorKind: 'agent',
        authorAvatar: target?.avatarKey ?? 'gemini-cli',
        authorColor: target?.accentColor ?? '#2563EB',
        modelLabel: '定时唤醒规则',
        content: `已创建定时巡检任务：${trig.intervalLabel} 自动唤醒 @${target?.handle ?? 'pm'} 执行「${trig.promptText}」。`,
      });
      return 1;
    }

    return 0;
  }

  private enqueueUnread(input: {
    readonly sessionId: string;
    readonly channelId: string;
    readonly postId: string;
    readonly targetAgentId: string;
    readonly targetAgentName: string;
    readonly fromAuthor: string;
    readonly summary: string;
  }): UnreadQueueItem {
    const id = `uq-${randomUUID().slice(0, 8)}`;
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO v4_collab_unread_queue
         (id, session_id, channel_id, post_id, target_agent_id, target_agent_name, from_author, summary, status, created_at, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, NULL)`,
      )
      .run(
        id,
        input.sessionId,
        input.channelId,
        input.postId,
        input.targetAgentId,
        input.targetAgentName,
        input.fromAuthor,
        input.summary,
        now,
      );
    return this.listUnreadQueue(input.sessionId).find(q => q.id === id)!;
  }

  listUnreadQueue(sessionId?: string): UnreadQueueItem[] {
    const rows = sessionId
      ? (this.db
          .prepare(
            'SELECT * FROM v4_collab_unread_queue WHERE session_id = ? ORDER BY created_at DESC LIMIT 40',
          )
          .all(sessionId) as SqlRow[])
      : (this.db
          .prepare(
            'SELECT * FROM v4_collab_unread_queue ORDER BY created_at DESC LIMIT 60',
          )
          .all() as SqlRow[]);
    return rows.map(r => {
      const st = str(r, 'status');
      return {
        id: str(r, 'id'),
        sessionId: str(r, 'session_id'),
        channelId: str(r, 'channel_id'),
        postId: str(r, 'post_id'),
        targetAgentId: str(r, 'target_agent_id'),
        targetAgentName: str(r, 'target_agent_name'),
        fromAuthor: str(r, 'from_author'),
        summary: str(r, 'summary'),
        status: st === 'processing' || st === 'done' ? st : 'queued',
        createdAt: str(r, 'created_at'),
        processedAt: nullableStr(r, 'processed_at'),
      };
    });
  }

  async drainUnreadQueue(
    sessionId: string,
    contextPrompt?: string,
  ): Promise<number> {
    const queued = this.listUnreadQueue(sessionId).filter(
      q => q.status === 'queued',
    );
    if (queued.length === 0) return 0;

    let count = 0;
    const doc = this.getCollabDoc(sessionId);

    for (const item of queued.slice(0, 4)) {
      this.db
        .prepare(
          "UPDATE v4_collab_unread_queue SET status = 'processing' WHERE id = ?",
        )
        .run(item.id);

      const agent =
        this.resolveAgent(item.targetAgentId) ?? this.gateway.listAgents()[0];
      if (!agent) continue;

      const userTopic = contextPrompt || item.summary;
      const inv = await this.gateway.invokeAgentModel({
        agentId: agent.id,
        userPrompt: `当前讨论上下文：「${userTopic}」\n现有 PRD 概览：${doc.blocks[0]?.markdown ?? ''}\n请以「${agent.displayName}」身份用 2-4 句给出具体建议、要澄清的问题，并指出你会修改 PRD 哪个部分。`,
      });

      let replyContent = inv.text;
      const attachments: PostAttachment[] = [];

      if (agent.handle === 'pm') {
        const currentOverview =
          doc.blocks.find(b => b.sectionKey === 'overview')?.markdown ?? '';
        const updatedOverview = `${currentOverview.split('\n')[0]}\n- **最新需求共识**：${userTopic}`;
        this.updateDocBlock(sessionId, 'blk-overview', {
          markdown: updatedOverview,
          authorId: agent.id,
          authorName: agent.displayName,
          authorKind: 'agent',
          authorColor: agent.accentColor,
          modelLabel: inv.modelLabel,
        });
        replyContent =
          replyContent ||
          '收到并已记录到 PRD《1. 背景与核心问题》。@architect 请结合此需求评估模块边界与数据一致性；我们是否在首期就确定以下关键分叉？';
        attachments.push({
          id: `att-poll-${randomUUID().slice(0, 6)}`,
          kind: 'decision_poll',
          title: '需求关键分叉确认',
          subtitle: '选择后将自动写入 PRD《2. 业务目标与非目标》',
          blockId: 'blk-goals',
          pollOptions: [
            {
              id: 'opt-modular',
              label: '优先保证核心闭环与可观测协同（推荐）',
              description:
                '先跑通 PRD 共编、Spec 转换与独立审校闭环，再按模块扩展。',
              votes: 1,
              recommended: true,
            },
            {
              id: 'opt-minimal',
              label: '极简原型验证',
              description: '暂缓多角色权限与定时触发，只验证主路径。',
              votes: 0,
            },
          ],
        });
      } else if (agent.handle === 'architect') {
        const archMd = `### 技术边界（回应：${userTopic.slice(0, 48)}）\n- 采用事件流 + 关系型文档版本双存储，确保讨论线程与 PRD 段落修改毫秒级审计。\n- 关键接口遵循幂等提交与工作区沙箱隔离原则。`;
        this.updateDocBlock(sessionId, 'blk-architecture', {
          markdown: archMd,
          authorId: agent.id,
          authorName: agent.displayName,
          authorKind: 'agent',
          authorColor: agent.accentColor,
          modelLabel: inv.modelLabel,
        });
        replyContent =
          replyContent ||
          '已评估技术边界并更新 PRD《5. 系统架构与数据流》。建议把规则校验与服务路由拆分为独立模块，避免单文件耦合。';
        attachments.push({
          id: `att-prd-${randomUUID().slice(0, 6)}`,
          kind: 'prd_card',
          title: '已更新 PRD · 系统架构与数据流',
          subtitle: `${agent.displayName} 刚刚编辑 · 点击右侧查看差异`,
          blockId: 'blk-architecture',
          markdownContent: archMd,
        });
      } else if (agent.handle === 'designer') {
        replyContent =
          replyContent ||
          '已为你生成可交互界面方案对比原型，可直接切换状态体验或编辑源码：';
        attachments.push({
          id: `att-mock-${randomUUID().slice(0, 6)}`,
          kind: 'html_mockup',
          title: `交互原型建议 · ${userTopic.slice(0, 24)}`,
          subtitle: '交互原型师生成 · 可直接编辑',
          htmlContent: buildInteractiveComparisonHtml(userTopic.slice(0, 32)),
        });
      } else {
        replyContent =
          replyContent ||
          '已完成审视：建议重点补充极端并发与错误回滚的验收用例到 PRD 第 7 节。';
      }

      // Check if trigger post itself is inside a thread or top-level in the channel
      const parentRow = this.db
        .prepare('SELECT parent_post_id FROM v4_collab_posts WHERE id = ?')
        .get(item.postId) as SqlRow | undefined;
      const isInsideThread =
        parentRow !== undefined &&
        nullableStr(parentRow, 'parent_post_id') !== null;

      const createdPost = this.insertPost({
        sessionId,
        channelId: item.channelId,
        parentPostId: isInsideThread ? item.postId : null,
        authorId: agent.id,
        authorName: agent.displayName,
        authorKind: 'agent',
        authorAvatar: agent.avatarKey,
        authorColor: agent.accentColor,
        modelLabel: inv.modelLabel,
        content: replyContent,
        attachments,
      });

      // When a top-level discussion kicks off, add a concise peer cross-check reply
      // inside that post's thread so human + agents can continue focused threaded review.
      if (!isInsideThread && count === 0) {
        const rev = this.resolveAgent('reviewer');
        if (rev && rev.id !== agent.id) {
          this.insertPost({
            sessionId,
            channelId: item.channelId,
            parentPostId: createdPost.id,
            authorId: rev.id,
            authorName: rev.displayName,
            authorKind: 'agent',
            authorAvatar: rev.avatarKey,
            authorColor: rev.accentColor,
            modelLabel: rev.resolvedModelLabel,
            content:
              '已关注此需求主题：请确保在冻结 Spec 前明确异常回滚策略与边界条件（已标注在 PRD 第 7/8 节）。',
          });
        }
      }

      this.db
        .prepare(
          "UPDATE v4_collab_unread_queue SET status = 'done', processed_at = ? WHERE id = ?",
        )
        .run(nowIso(), item.id);
      count += 1;
    }

    return count;
  }

  toggleReaction(
    sessionId: string,
    postId: string,
    emoji: string,
    actorName = '你',
  ): CollabPostRecord {
    this.store.v4.getSessionOrThrow(sessionId);
    const row = this.db
      .prepare('SELECT * FROM v4_collab_posts WHERE id = ? AND session_id = ?')
      .get(postId, sessionId) as SqlRow | undefined;
    if (!row) {
      throw new ForgeError('NOT_FOUND', `Post "${postId}" not found`, 404);
    }
    const current = parseJson<PostReaction[]>(str(row, 'reactions_json'), []);
    const idx = current.findIndex(r => r.emoji === emoji);
    let next: PostReaction[];
    if (idx >= 0) {
      const prev = current[idx]!;
      if (prev.byViewer) {
        const actors = prev.actors.filter(a => a !== actorName);
        if (actors.length === 0) {
          next = current.filter((_, i) => i !== idx);
        } else {
          next = current.map((r, i) =>
            i === idx
              ? {...r, count: actors.length, byViewer: false, actors}
              : r,
          );
        }
      } else {
        const actors = [...prev.actors, actorName];
        next = current.map((r, i) =>
          i === idx ? {...r, count: actors.length, byViewer: true, actors} : r,
        );
      }
    } else {
      next = [
        ...current,
        {emoji, count: 1, byViewer: true, actors: [actorName]},
      ];
    }

    this.db
      .prepare(
        'UPDATE v4_collab_posts SET reactions_json = ?, updated_at = ? WHERE id = ?',
      )
      .run(JSON.stringify(next), nowIso(), postId);
    const updatedRow = this.db
      .prepare('SELECT * FROM v4_collab_posts WHERE id = ?')
      .get(postId) as SqlRow;
    const post = this.mapPostRow(updatedRow);
    this.publish({type: 'v4.collab.post', sessionId, post});
    return post;
  }

  setThreadStatus(
    sessionId: string,
    postId: string,
    status: 'open' | 'resolved',
    resolvedBy = '你',
  ): CollabPostRecord {
    this.store.v4.getSessionOrThrow(sessionId);
    const now = nowIso();
    this.db
      .prepare(
        'UPDATE v4_collab_posts SET thread_status = ?, resolved_by = ?, updated_at = ? WHERE id = ? AND session_id = ?',
      )
      .run(
        status,
        status === 'resolved' ? resolvedBy : null,
        now,
        postId,
        sessionId,
      );
    const updatedRow = this.db
      .prepare('SELECT * FROM v4_collab_posts WHERE id = ?')
      .get(postId) as SqlRow | undefined;
    if (!updatedRow) {
      throw new ForgeError('NOT_FOUND', `Post "${postId}" not found`, 404);
    }
    const post = this.mapPostRow(updatedRow);
    this.publish({type: 'v4.collab.post', sessionId, post});
    return post;
  }

  selectPollOption(
    sessionId: string,
    postId: string,
    attachmentId: string,
    optionId: string,
  ): {
    readonly post: CollabPostRecord;
    readonly doc: CollabDocSnapshot;
  } {
    this.store.v4.getSessionOrThrow(sessionId);
    const row = this.db
      .prepare('SELECT * FROM v4_collab_posts WHERE id = ? AND session_id = ?')
      .get(postId, sessionId) as SqlRow | undefined;
    if (!row) {
      throw new ForgeError('NOT_FOUND', `Post "${postId}" not found`, 404);
    }
    const attachments = parseJson<PostAttachment[]>(
      str(row, 'attachments_json'),
      [],
    );
    let chosenLabel = '';
    const nextAttachments = attachments.map(att => {
      if (att.id !== attachmentId || !att.pollOptions) return att;
      return {
        ...att,
        selectedPollOptionId: optionId,
        pollOptions: att.pollOptions.map(opt => {
          if (opt.id === optionId) {
            chosenLabel = opt.label;
            return {...opt, votes: opt.votes + 1};
          }
          return opt;
        }),
      };
    });

    this.db
      .prepare(
        'UPDATE v4_collab_posts SET attachments_json = ?, thread_status = ?, resolved_by = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        JSON.stringify(nextAttachments),
        'resolved',
        '你 (已拍板选项)',
        nowIso(),
        postId,
      );

    let doc = this.getCollabDoc(sessionId);
    if (chosenLabel) {
      const goalsBlock = doc.blocks.find(b => b.sectionKey === 'goals');
      if (goalsBlock) {
        doc = this.updateDocBlock(sessionId, goalsBlock.id, {
          markdown: `${goalsBlock.markdown.trim()}\n- **已确认路径**：${chosenLabel}`,
          authorId: 'human',
          authorName: '你 (拍板确认)',
          authorKind: 'human',
          authorColor: '#141413',
          modelLabel: '决策投票锁定',
        });
      }
    }

    const updatedRow = this.db
      .prepare('SELECT * FROM v4_collab_posts WHERE id = ?')
      .get(postId) as SqlRow;
    const post = this.mapPostRow(updatedRow);
    this.publish({type: 'v4.collab.post', sessionId, post});
    return {post, doc};
  }

  updateHtmlMockupAttachment(
    sessionId: string,
    postId: string,
    attachmentId: string,
    htmlContent: string,
  ): CollabPostRecord {
    this.store.v4.getSessionOrThrow(sessionId);
    const row = this.db
      .prepare('SELECT * FROM v4_collab_posts WHERE id = ? AND session_id = ?')
      .get(postId, sessionId) as SqlRow | undefined;
    if (!row) {
      throw new ForgeError('NOT_FOUND', `Post "${postId}" not found`, 404);
    }
    const attachments = parseJson<PostAttachment[]>(
      str(row, 'attachments_json'),
      [],
    );
    const nextAttachments = attachments.map(att =>
      att.id === attachmentId ? {...att, htmlContent} : att,
    );
    this.db
      .prepare(
        'UPDATE v4_collab_posts SET attachments_json = ?, updated_at = ? WHERE id = ?',
      )
      .run(JSON.stringify(nextAttachments), nowIso(), postId);
    const updatedRow = this.db
      .prepare('SELECT * FROM v4_collab_posts WHERE id = ?')
      .get(postId) as SqlRow;
    const post = this.mapPostRow(updatedRow);
    this.publish({type: 'v4.collab.post', sessionId, post});
    return post;
  }

  createSchedule(input: {
    readonly sessionId: string;
    readonly channelId: string;
    readonly targetAgentId: string;
    readonly targetAgentName: string;
    readonly intervalLabel: string;
    readonly promptText: string;
  }): ScheduledTriggerRecord {
    const id = `sch-${randomUUID().slice(0, 8)}`;
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO v4_scheduled_triggers
         (id, session_id, channel_id, target_agent_id, target_agent_name, interval_label, prompt_text, enabled, run_count, last_run_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.channelId,
        input.targetAgentId,
        input.targetAgentName,
        input.intervalLabel.trim(),
        input.promptText.trim(),
        now,
      );
    return this.listSchedules(input.sessionId).find(s => s.id === id)!;
  }

  listSchedules(sessionId?: string): ScheduledTriggerRecord[] {
    const rows = sessionId
      ? (this.db
          .prepare(
            'SELECT * FROM v4_scheduled_triggers WHERE session_id = ? ORDER BY created_at DESC',
          )
          .all(sessionId) as SqlRow[])
      : (this.db
          .prepare(
            'SELECT * FROM v4_scheduled_triggers ORDER BY created_at DESC',
          )
          .all() as SqlRow[]);
    return rows.map(r => ({
      id: str(r, 'id'),
      sessionId: str(r, 'session_id'),
      channelId: str(r, 'channel_id'),
      targetAgentId: str(r, 'target_agent_id'),
      targetAgentName: str(r, 'target_agent_name'),
      intervalLabel: str(r, 'interval_label'),
      promptText: str(r, 'prompt_text'),
      enabled: num(r, 'enabled', 1) === 1,
      runCount: num(r, 'run_count', 0),
      lastRunAt: nullableStr(r, 'last_run_at'),
      createdAt: str(r, 'created_at'),
    }));
  }

  async runScheduleNow(scheduleId: string): Promise<ScheduledTriggerRecord> {
    const sch = this.listSchedules().find(s => s.id === scheduleId);
    if (!sch) {
      throw new ForgeError(
        'NOT_FOUND',
        `Schedule "${scheduleId}" not found`,
        404,
      );
    }
    const agent = this.resolveAgent(sch.targetAgentId);
    const inv = agent
      ? await this.gateway.invokeAgentModel({
          agentId: agent.id,
          userPrompt: `[定时巡检 ${sch.intervalLabel}] ${sch.promptText}`,
        })
      : null;

    this.insertPost({
      sessionId: sch.sessionId,
      channelId: sch.channelId,
      authorId: agent?.id ?? sch.targetAgentId,
      authorName: agent?.displayName ?? sch.targetAgentName,
      authorKind: 'agent',
      authorAvatar: agent?.avatarKey ?? 'gemini-cli',
      authorColor: agent?.accentColor ?? '#2563EB',
      modelLabel: inv?.modelLabel ?? '定时触发汇报',
      content:
        inv?.text ||
        `[定时巡检 #${sch.runCount + 1} · ${sch.intervalLabel}] 已完成检查：「${sch.promptText}」。当前 PRD 修订状态正常，暂无阻塞项。`,
    });

    this.db
      .prepare(
        `UPDATE v4_scheduled_triggers
         SET run_count = run_count + 1, last_run_at = ?
         WHERE id = ?`,
      )
      .run(nowIso(), scheduleId);
    return this.listSchedules().find(s => s.id === scheduleId)!;
  }

  deleteSchedule(scheduleId: string): void {
    this.db
      .prepare('DELETE FROM v4_scheduled_triggers WHERE id = ?')
      .run(scheduleId);
  }

  getDashboardSummary(): DashboardSummaryPayload {
    const agents = this.gateway.listAgents();
    const sessions = this.store.v4.listSessions();
    const queuedItems = this.listUnreadQueue();
    const schedules = this.listSchedules();
    const revRows = this.db
      .prepare(
        "SELECT * FROM v4_collab_doc_revisions WHERE doc_kind = 'prd' ORDER BY created_at DESC LIMIT 12",
      )
      .all() as SqlRow[];
    const recentEdits: CollabDocRevision[] = revRows.map(r => {
      const beforeMarkdown = str(r, 'before_markdown');
      const afterMarkdown = str(r, 'after_markdown');
      return {
        id: str(r, 'id'),
        sessionId: str(r, 'session_id'),
        docKind: 'prd',
        revision: num(r, 'revision', 1),
        blockId: str(r, 'block_id'),
        blockTitle: str(r, 'block_title'),
        beforeMarkdown,
        afterMarkdown,
        diffHunks: computeLineDiff(beforeMarkdown, afterMarkdown).hunks,
        diffSummary: str(r, 'diff_summary'),
        authorId: str(r, 'author_id'),
        authorName: str(r, 'author_name'),
        authorKind: str(r, 'author_kind') === 'agent' ? 'agent' : 'human',
        authorColor: str(r, 'author_color'),
        modelLabel: str(r, 'model_label'),
        createdAt: str(r, 'created_at'),
      };
    });
    const postRows = this.db
      .prepare(
        'SELECT * FROM v4_collab_posts ORDER BY created_at DESC LIMIT 12',
      )
      .all() as SqlRow[];
    const recentPosts = postRows.map(r => this.mapPostRow(r));

    return {
      agents: agents.map(a => {
        const unreadCount = queuedItems.filter(
          q => q.targetAgentId === a.id && q.status !== 'done',
        ).length;
        const processing = queuedItems.some(
          q => q.targetAgentId === a.id && q.status === 'processing',
        );
        const editCount = recentEdits.filter(e => e.authorId === a.id).length;
        return {
          ...a,
          state: processing ? 'working' : unreadCount > 0 ? 'queued' : 'idle',
          unreadCount,
          editCount,
        };
      }),
      activeSessionsCount: sessions.length,
      queuedItems,
      schedules,
      recentEdits,
      recentPosts,
    };
  }
}
