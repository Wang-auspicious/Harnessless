import {
  renderUbiquitousLanguageSection,
  selectTermsForRepo,
} from '../core/ddd.ts';
import type {IAgentAdapterHub} from '../adapters/contracts.ts';
import type {HindsightEngine} from '../memory/hindsight-engine.ts';
import type {HamaEngine} from '../requirements/hama-engine.ts';
import type {
  PostRoomMessageRequest,
  PromoteThreadToChangeRequest,
  RoomDetailSnapshot,
} from '../shared/api.ts';
import {ForgeError} from '../shared/errors.ts';
import type {ChangeRecord, RoomMessage} from '../shared/types.ts';
import type {ForgeStore} from '../store/database.ts';
import type {SsePublisher} from '../engines/continuity.ts';
import type {RequirementClosureEngine} from '../engines/requirement-closure.ts';

export class EngineeringRoomsService {
  private readonly store: ForgeStore;
  private readonly adapters: IAgentAdapterHub;
  private readonly closure: RequirementClosureEngine;
  private readonly publish: SsePublisher;
  private readonly worktreesRoot: string;
  private readonly hindsight?: HindsightEngine;
  private readonly hama?: HamaEngine;

  constructor(deps: {
    readonly store: ForgeStore;
    readonly adapters: IAgentAdapterHub;
    readonly closure: RequirementClosureEngine;
    readonly publish: SsePublisher;
    readonly worktreesRoot: string;
    readonly hindsight?: HindsightEngine;
    readonly hama?: HamaEngine;
  }) {
    this.store = deps.store;
    this.adapters = deps.adapters;
    this.closure = deps.closure;
    this.publish = deps.publish;
    this.worktreesRoot = deps.worktreesRoot;
    this.hindsight = deps.hindsight;
    this.hama = deps.hama;
  }

  getRoomSnapshot(hubId: string, roomId?: string): RoomDetailSnapshot {
    const rooms = this.store.listRooms(hubId);
    const activeRoomId = roomId ?? rooms[0]?.id;
    const threads = activeRoomId ? this.store.listThreads(activeRoomId) : [];
    const messages = activeRoomId
      ? this.store.listRoomMessages(activeRoomId, 250)
      : [];
    return {rooms, threads, messages};
  }

  async postMessage(req: PostRoomMessageRequest): Promise<RoomMessage> {
    const room = this.store.listRooms().find(r => r.id === req.roomId);
    if (!room) {
      throw new ForgeError('NOT_FOUND', `Room "${req.roomId}" not found`, 404);
    }

    let threadId = req.threadId ?? null;
    if (!threadId && req.threadTitle && req.threadTitle.trim().length > 0) {
      const thd = this.store.createThread({
        roomId: room.id,
        title: req.threadTitle.trim(),
        mandateScope: `Room #${room.name} (${room.scenario}) bounded thread`,
      });
      threadId = thd.id;
    }

    const extractedMentions = Array.from(
      new Set([
        ...(req.mentions ?? []),
        ...Array.from(
          req.bodyMarkdown.matchAll(/@([a-z0-9][a-z0-9-_]{1,32})/gi),
          m => m[1]!.toLowerCase(),
        ),
      ]),
    );

    const humanMsg = this.store.appendRoomMessage({
      roomId: room.id,
      threadId,
      authorKind: 'human',
      authorId: 'human_operator',
      authorLabel: 'Principal Engineer',
      mentions: extractedMentions,
      bodyMarkdown: req.bodyMarkdown,
    });
    this.store.touchHubHumanAnchor(room.hubId, false);
    this.publish({type: 'room.message', roomId: room.id, message: humanMsg});

    if (room.scenario === 'req-grill' && this.hama) {
      const mMatch = /#mission:([a-z0-9-]+)/i.exec(req.bodyMarkdown);
      if (mMatch?.[1]) {
        try {
          this.hama.addComment(mMatch[1], {
            scopeKey: 'room-grill',
            authorKind: 'human',
            authorLabel: humanMsg.authorLabel,
            severity: req.bodyMarkdown.toLowerCase().includes('#blocking')
              ? 'blocking'
              : 'advisory',
            body: req.bodyMarkdown,
          });
        } catch {
          // Ignore unknown mission tag cleanly.
        }
      }
    }

    const shouldRespond =
      extractedMentions.length > 0 ||
      room.scenario === 'req-grill' ||
      room.scenario === 'arch-council' ||
      room.scenario === 'triage-ops';

    if (shouldRespond) {
      void this.dispatchAgentReply(
        room.hubId,
        room.id,
        room.scenario,
        threadId,
        extractedMentions,
        req.bodyMarkdown,
      );
    }

    return humanMsg;
  }

  async promoteThreadToChange(
    req: PromoteThreadToChangeRequest,
  ): Promise<ChangeRecord> {
    const thread = this.store.getThread(req.threadId);
    if (!thread) {
      throw new ForgeError(
        'NOT_FOUND',
        `Thread "${req.threadId}" not found`,
        404,
      );
    }
    const room = this.store.listRooms().find(r => r.id === thread.roomId);
    if (!room) {
      throw new ForgeError('NOT_FOUND', 'Parent room not found', 404);
    }
    const threadMessages = this.store
      .listRoomMessages(room.id, 200)
      .filter(m => m.threadId === thread.id);
    const transcriptSummary =
      threadMessages.length > 0
        ? threadMessages
            .map(m => `[${m.authorLabel}]: ${m.bodyMarkdown}`)
            .join('\n')
            .slice(0, 4000)
        : thread.mandateScope;

    const change = await this.closure.createAndPlanChange({
      hubId: room.hubId,
      repoId: req.repoId,
      title: req.title,
      summary: `Promoted from #${room.name} thread "${thread.title}":\n${transcriptSummary}`,
      permissionTier: req.permissionTier,
      worktreesRoot: this.worktreesRoot,
    });

    this.store.markThreadPromoted(thread.id, change.id);
    const sysMsg = this.store.appendRoomMessage({
      roomId: room.id,
      threadId: thread.id,
      authorKind: 'system',
      authorId: 'forgeops',
      authorLabel: 'ForgeOps Control Plane',
      bodyMarkdown: `Promoted thread consensus into **${change.code}: ${change.title}** on isolated branch \`${change.gitBranch}\`.`,
    });
    this.publish({type: 'room.message', roomId: room.id, message: sysMsg});
    this.publish({
      type: 'state.changed',
      scope: 'changes',
      at: new Date().toISOString(),
    });
    return change;
  }

  private async dispatchAgentReply(
    hubId: string,
    roomId: string,
    scenario: string,
    threadId: string | null,
    mentions: readonly string[],
    promptBody: string,
  ): Promise<void> {
    const hub = this.store.getHub(hubId);
    if (!hub) {
      return;
    }
    const profiles = this.store.listAdapterProfiles();
    const mentionedProfile = mentions
      .map(m => profiles.find(p => p.manifest.id === m))
      .find(Boolean);

    const role =
      mentions.includes('steward') || mentions.includes('infra')
        ? 'infra_steward'
        : scenario === 'arch-council'
          ? 'lead'
          : 'moderator';
    const targetProfile =
      mentionedProfile ?? this.store.pickHealthyAdapter(role, 'native-api');

    const repos = this.store.listRepositories(hub.id);
    const terms = selectTermsForRepo(
      this.store.listDomainTerms(hub.id),
      repos[0]?.id ?? '',
    );
    const recalled = this.hindsight
      ? this.hindsight.recall({
          hubId: hub.id,
          executionMode: 'live',
          query: promptBody,
          limit: 4,
        }).hits
      : [];

    const sess = this.store.startSession({
      hubId: hub.id,
      adapterId: targetProfile.manifest.id,
      model: targetProfile.manifest.defaultModel,
      role,
    });

    const memoryContext =
      recalled.length > 0
        ? `## Recalled Project Memory\n${recalled.map(h => `- [${h.authorityTier}] ${h.title}: ${h.content}`).join('\n')}`
        : '';
    const systemPrompt = [
      this.store.getConstitution().markdown,
      `You are collaborating in Engineering Room (${scenario}) for Hub "${hub.name}".`,
      hub.agentWikiSummary || hub.description,
      renderUbiquitousLanguageSection(terms),
      memoryContext,
    ]
      .filter(Boolean)
      .join('\n\n');

    let replyMarkdown = '';
    let failureDiagnostic = '';
    try {
      const res = await this.adapters.invoke({
        sessionId: sess.id,
        hubId: hub.id,
        changeId: null,
        nodeId: null,
        role,
        adapter: targetProfile.manifest,
        model: targetProfile.manifest.defaultModel,
        permissionTier: hub.permissionTier,
        cwd: hub.rootPath,
        systemPrompt,
        userPrompt: promptBody,
        readOnly: true,
        textOnly: true,
        prioritySlot: true,
        timeoutMs: 45_000,
      });
      this.store.finishSession(
        sess.id,
        res.outcome === 'completed' ? 'completed' : 'failed',
      );
      if (res.outcome === 'completed' && res.finalText.trim().length > 0) {
        replyMarkdown = res.finalText.trim();
      } else {
        failureDiagnostic = res.diagnostic;
      }
    } catch (err) {
      this.store.finishSession(sess.id, 'failed');
      failureDiagnostic = err instanceof Error ? err.message : String(err);
    }

    if (!replyMarkdown) {
      const memoryLines =
        recalled.length > 0
          ? [
              '- **Grounded Hindsight Memories:**',
              ...recalled.map(
                h => `  - [${h.authorityTier}] ${h.title}: ${h.content}`,
              ),
            ]
          : ['- **Grounded Hindsight Memories:** none matching query yet.'];

      const sysMsg = this.store.appendRoomMessage({
        roomId,
        threadId,
        authorKind: 'system',
        authorId: 'forgeops_degraded',
        authorLabel: 'ForgeOps Control Plane (Degraded Live Notice)',
        bodyMarkdown: [
          `### Live Agent Reply Unavailable (${scenario})`,
          `- **Reason:** ${failureDiagnostic || 'No live API key or healthy external CLI agent configured.'}`,
          `- **Repository Scope:** ${repos.map(r => `${r.name} (${r.boundedContext})`).join(', ') || 'none'}`,
          ...memoryLines,
          '- Configure a provider under Infra Providers or use a `simulation` Mission to run offline synthesis.',
        ].join('\n'),
      });
      this.publish({type: 'room.message', roomId, message: sysMsg});
      return;
    }

    const agentMsg = this.store.appendRoomMessage({
      roomId,
      threadId,
      authorKind: 'agent',
      authorId: targetProfile.manifest.id,
      authorLabel: `${targetProfile.manifest.label} (${role})`,
      bodyMarkdown: replyMarkdown,
    });
    this.publish({type: 'room.message', roomId, message: agentMsg});
  }
}
