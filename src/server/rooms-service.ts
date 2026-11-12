/**
 * Multi-Scenario Engineering Rooms Service:
 * Supports `#req-grill`, `#arch-council`, `#triage-ops`, `#direct-ops`, and
 * `#exec-briefing` with Thread Mandates, `@agent` routing over the Reserved
 * Human Priority Slot, and 1-click Promote-to-Change.
 */

import {
  renderUbiquitousLanguageSection,
  selectTermsForRepo,
} from '../core/ddd.ts';
import type {IAgentAdapterHub} from '../adapters/contracts.ts';
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

  constructor(deps: {
    readonly store: ForgeStore;
    readonly adapters: IAgentAdapterHub;
    readonly closure: RequirementClosureEngine;
    readonly publish: SsePublisher;
    readonly worktreesRoot: string;
  }) {
    this.store = deps.store;
    this.adapters = deps.adapters;
    this.closure = deps.closure;
    this.publish = deps.publish;
    this.worktreesRoot = deps.worktreesRoot;
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

    // Dispatch @agent or scenario moderator response asynchronously on Priority Slot.
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

    const sess = this.store.startSession({
      hubId: hub.id,
      adapterId: targetProfile.manifest.id,
      model: targetProfile.manifest.defaultModel,
      role,
    });

    const systemPrompt = [
      this.store.getConstitution().markdown,
      `You are collaborating in Engineering Room (${scenario}) for Hub "${hub.name}".`,
      hub.agentWikiSummary || hub.description,
      renderUbiquitousLanguageSection(terms),
    ].join('\n\n');

    let replyMarkdown = '';
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
        prioritySlot: true,
        timeoutMs: 45_000,
      });
      this.store.finishSession(
        sess.id,
        res.outcome === 'completed' ? 'completed' : 'failed',
      );
      if (res.outcome === 'completed' && res.finalText.trim().length > 0) {
        replyMarkdown = res.finalText.trim();
      }
    } catch {
      this.store.finishSession(sess.id, 'failed');
    }

    if (!replyMarkdown) {
      replyMarkdown = this.buildStructuredDomainReply(
        scenario,
        hub.name,
        repos.map(r => `${r.name} (${r.boundedContext})`),
        terms.map(t => t.canonicalTerm),
        promptBody,
      );
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

  private buildStructuredDomainReply(
    scenario: string,
    hubName: string,
    repoSummaries: readonly string[],
    canonicalTerms: readonly string[],
    userPrompt: string,
  ): string {
    const termsNote =
      canonicalTerms.length > 0
        ? `Canonical DDD identifiers locked: \`${canonicalTerms.join('`, `')}\`.`
        : 'No DDD terms locked yet; consider registering bounded-context terms in DDD Studio.';
    const repoNote =
      repoSummaries.length > 0
        ? `Scoped repositories: ${repoSummaries.join(', ')}.`
        : 'Register member repositories in Federation Hub to bind isolated worktrees.';

    switch (scenario) {
      case 'req-grill':
        return [
          `### Requirement Closure Assessment (${hubName})`,
          `- **Input Analyzed:** "${userPrompt.slice(0, 140)}"`,
          `- **Topology Alignment:** ${repoNote}`,
          `- **Ubiquitous Language Check:** ${termsNote}`,
          '- **Next Action:** Click **Promote Thread to Change** when scope is locked to compile the WBS & Twin Graph.',
        ].join('\n');
      case 'arch-council':
        return [
          '### Architecture Council Synthesis',
          `- **Bounded Context Impact:** ${repoNote}`,
          `- **Contract Invariants:** ${termsNote}`,
          '- **Recommendation:** Isolate cross-service schema mutations behind explicit repository verify gates before downstream rollout.',
        ].join('\n');
      default:
        return [
          `### Control Plane Response (${hubName})`,
          `- **Context:** ${repoNote}`,
          `- **DDD Grounding:** ${termsNote}`,
          '- **Ready:** Use `@steward` for Infra/Doctor actions or promote this thread directly into an executable Twin-Graph Change.',
        ].join('\n');
    }
  }
}
