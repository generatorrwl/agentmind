import path from "node:path";
import { appendFile, writeFile } from "node:fs/promises";
import { paths, writeEpisode, writeProposal } from "./store.js";
import { AgentHarness, WorkCheckpoint, WorkEvent, WorkHandoff, WorkItem, WorkLease, WorkPriority, WorkSession, WorkStatus } from "./types.js";
import { ensureDir, nowIso, readJson, slugify, stableId, writeJson } from "./utils.js";

interface WorkItemsFile { items: WorkItem[] }
interface SessionsFile { sessions: WorkSession[] }
interface LeasesFile { leases: WorkLease[] }

export async function onlineStart(root: string, input: { harness?: AgentHarness; session?: string; focus?: string; staleMinutes?: number }): Promise<Record<string, unknown>> {
  const p = paths(root);
  const sessionsFile = await readSessions(root);
  const now = nowIso();
  const id = input.session ?? stableId("session", `${input.harness ?? "unknown"}:${now}`);
  const existing = sessionsFile.sessions.find((session) => session.id === id);
  const session: WorkSession = existing
    ? { ...existing, status: "active", heartbeat_at: now, focus: input.focus ?? existing.focus }
    : {
      id,
      harness: input.harness ?? "unknown",
      status: "active",
      focus: input.focus,
      owned_work: [],
      started_at: now,
      heartbeat_at: now,
    };
  sessionsFile.sessions = [...sessionsFile.sessions.filter((item) => item.id !== id), session];
  await writeJson(p.onlineSessions, sessionsFile);
  await writeJson(path.join(p.onlineHeartbeats, `${id}.json`), { session_id: id, heartbeat_at: now });
  return onlineStatus(root, { currentSession: id, staleMinutes: input.staleMinutes });
}

export async function onlineStatus(root: string, input: { currentSession?: string; staleMinutes?: number } = {}): Promise<Record<string, unknown>> {
  const sessions = (await readSessions(root)).sessions;
  const leases = (await readLeases(root)).leases;
  const items = (await readWorkItems(root)).items;
  const thresholdMinutes = input.staleMinutes ?? 24 * 60;
  const nowMs = Date.now();
  const activeSessions = sessions.filter((session) => session.status === "active");
  const staleSessions = activeSessions
    .map((session) => ({ ...session, stale_age_minutes: Math.floor((nowMs - Date.parse(session.heartbeat_at)) / 60000) }))
    .filter((session) => session.stale_age_minutes >= thresholdMinutes);
  const staleSessionIds = new Set(staleSessions.map((session) => session.id));
  const activeLeases = leases.filter((lease) => lease.status === "active");
  const recoverableLeases = activeLeases.filter((lease) => staleSessionIds.has(lease.session_id));
  return {
    current_session: input.currentSession,
    stale_threshold_minutes: thresholdMinutes,
    active_sessions: activeSessions,
    stale_sessions: staleSessions,
    active_leases: activeLeases,
    recoverable_leases: recoverableLeases,
    doing: items.filter((item) => item.status === "doing"),
    resumable: items.filter((item) => item.status === "todo" || item.status === "paused"),
    pending_handoffs_dir: path.relative(root, paths(root).workHandoffs),
    recovery_guidance: recoverableLeases.length > 0
      ? "Ask the user whether to take over, pause, or abandon recoverable work before changing ownership."
      : undefined,
  };
}

export async function onlineEnd(root: string, sessionId: string): Promise<WorkSession> {
  const sessionsFile = await readSessions(root);
  const now = nowIso();
  const session = sessionsFile.sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error(`Unknown session: ${sessionId}`);
  const ended: WorkSession = { ...session, status: "ended", heartbeat_at: now, ended_at: now, owned_work: [] };
  sessionsFile.sessions = [...sessionsFile.sessions.filter((item) => item.id !== sessionId), ended];
  await writeJson(paths(root).onlineSessions, sessionsFile);

  const leasesFile = await readLeases(root);
  leasesFile.leases = leasesFile.leases.map((lease) => lease.session_id === sessionId && lease.status === "active"
    ? { ...lease, status: "released", released_at: now }
    : lease);
  await writeJson(paths(root).onlineLeases, leasesFile);
  return ended;
}

export async function workAdd(root: string, input: { title: string; priority?: WorkPriority; goal?: string; next?: string }): Promise<WorkItem> {
  const file = await readWorkItems(root);
  const now = nowIso();
  const item: WorkItem = {
    id: stableId("work", `${now}:${input.title}`),
    title: input.title,
    status: "todo",
    priority: input.priority ?? "medium",
    owner: null,
    goal: input.goal,
    next: input.next ?? "Clarify the next concrete step.",
    blockers: [],
    assumptions: [],
    dont_touch: [],
    links: { episodes: [], rewards: [], proposals: [], references: [], wiki: [] },
    created_at: now,
    updated_at: now,
  };
  file.items.push(item);
  await writeWorkItems(root, file.items);
  await writeWorkEvent(root, { type: "created", work_id: item.id, summary: item.title });
  return item;
}

export async function workList(root: string, status?: WorkStatus): Promise<WorkItem[]> {
  const items = (await readWorkItems(root)).items;
  return status ? items.filter((item) => item.status === status) : items;
}

export async function workClaim(root: string, workId: string, input: { session: string; scope?: string[] }): Promise<{ item: WorkItem; lease: WorkLease }> {
  const file = await readWorkItems(root);
  const now = nowIso();
  const item = findWork(file.items, workId);
  const updated: WorkItem = { ...item, status: "doing", owner: input.session, updated_at: now };
  await writeWorkItems(root, file.items.map((entry) => entry.id === workId ? updated : entry));

  const leasesFile = await readLeases(root);
  const lease: WorkLease = {
    id: stableId("lease", `${workId}:${input.session}:${now}`),
    work_id: workId,
    session_id: input.session,
    status: "active",
    scope: input.scope ?? [],
    created_at: now,
  };
  leasesFile.leases = [...leasesFile.leases.filter((entry) => !(entry.work_id === workId && entry.status === "active")), lease];
  await writeJson(paths(root).onlineLeases, leasesFile);
  await attachWorkToSession(root, input.session, workId);
  await writeWorkEvent(root, { type: "claimed", work_id: workId, session_id: input.session });
  return { item: updated, lease };
}

export async function workCheckpoint(root: string, workId: string, input: { session?: string; summary: string; next?: string; blockers?: string[]; changedFiles?: string[]; verification?: string[] }): Promise<WorkCheckpoint> {
  const now = nowIso();
  const checkpoint: WorkCheckpoint = {
    id: stableId("checkpoint", `${workId}:${now}`),
    work_id: workId,
    session_id: input.session,
    summary: input.summary,
    next: input.next,
    blockers: input.blockers ?? [],
    changed_files: input.changedFiles ?? [],
    verification: input.verification ?? [],
    created_at: now,
  };
  const checkpointPath = path.join(paths(root).work, "checkpoints", `${checkpoint.id}.json`);
  await writeJson(checkpointPath, checkpoint);
  const file = await readWorkItems(root);
  const item = findWork(file.items, workId);
  const updated: WorkItem = {
    ...item,
    next: input.next ?? item.next,
    blockers: checkpoint.blockers,
    updated_at: now,
    last_checkpoint: checkpoint.id,
  };
  await writeWorkItems(root, file.items.map((entry) => entry.id === workId ? updated : entry));
  await writeWorkEvent(root, { type: "checkpointed", work_id: workId, session_id: input.session, summary: input.summary });
  return checkpoint;
}

export async function workPause(root: string, workId: string, input: { session?: string; summary?: string; next?: string }): Promise<WorkHandoff> {
  return closeWork(root, workId, "paused", input);
}

export async function workFinish(root: string, workId: string, input: { session?: string; summary?: string; next?: string }): Promise<WorkHandoff> {
  return closeWork(root, workId, "finished", input);
}

export async function workAbandon(root: string, workId: string, input: { session?: string; summary?: string; next?: string }): Promise<WorkHandoff> {
  return closeWork(root, workId, "abandoned", input);
}

export async function specCreate(root: string, input: { title: string; workId?: string }): Promise<{ path: string; content: string }> {
  const now = nowIso();
  const slug = slugify(input.title);
  const filePath = path.join(paths(root).plans, `${slug}.md`);
  const content = `---
slug: ${slug}
title: ${input.title}
status: draft
created: ${now.slice(0, 10)}
updated: ${now.slice(0, 10)}
work_id: ${input.workId ?? ""}
---

# ${input.title}

## Goal
Define the successful outcome in one sentence.

## Non-goals
- Explicitly list what is out of scope.

## Context
- Why this work matters now.
- Relevant constraints, references, and prior decisions.

## Approach
1. Phase A.
2. Phase B.
3. Phase C.

## Open Questions
- [ ] Question to resolve before or during execution.

## Acceptance Criteria
- [ ] Concrete completion signal.

## Notes
Append execution notes and deviations here.
`;
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, { encoding: "utf8", flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
    throw new Error(`Spec already exists: ${path.relative(root, filePath)}`);
  });
  return { path: path.relative(root, filePath), content };
}

async function closeWork(root: string, workId: string, status: "paused" | "finished" | "abandoned", input: { session?: string; summary?: string; next?: string }): Promise<WorkHandoff> {
  const now = nowIso();
  const file = await readWorkItems(root);
  const item = findWork(file.items, workId);
  const itemStatus: WorkStatus = status === "finished" ? "done" : status;
  const updated: WorkItem = {
    ...item,
    status: itemStatus,
    owner: null,
    next: input.next ?? item.next,
    updated_at: now,
    completed_at: status === "finished" ? now : item.completed_at,
  };
  await writeWorkItems(root, file.items.map((entry) => entry.id === workId ? updated : entry));
  await releaseLease(root, workId, input.session);
  await detachWorkFromSession(root, workId, input.session);
  const handoff: WorkHandoff = {
    id: stableId("handoff", `${workId}:${status}:${now}`),
    work_id: workId,
    session_id: input.session,
    status,
    summary: input.summary ?? item.title,
    next: input.next ?? item.next,
    created_at: now,
  };
  await writeJson(path.join(paths(root).workHandoffs, `${handoff.id}.json`), handoff);
  await writeHandoffMarkdown(root, handoff);
  const eventType = status === "finished" ? "finished" : status;
  await writeWorkEvent(root, { type: eventType, work_id: workId, session_id: input.session, summary: handoff.summary });
  await createCloseArtifacts(root, updated, handoff);
  return handoff;
}

async function createCloseArtifacts(root: string, item: WorkItem, handoff: WorkHandoff): Promise<void> {
  const latestCheckpoint = item.last_checkpoint ? await readJson<WorkCheckpoint | null>(path.join(paths(root).work, "checkpoints", `${item.last_checkpoint}.json`), null) : null;
  const episode = await writeEpisode(root, {
    id: stableId("episode", `${item.id}:${handoff.id}`),
    goal: item.goal ?? item.title,
    agent: handoff.session_id,
    outcome: handoff.status === "finished" ? "success" : "unknown",
    actions: {
      files_read: [],
      files_modified: latestCheckpoint?.changed_files ?? [],
      commands: (latestCheckpoint?.verification ?? []).map((summary) => ({ command: "verification", summary })),
    },
    verification: {
      checkpoint: latestCheckpoint?.id,
      status: handoff.status,
      summary: handoff.summary,
    },
    assets_used: [],
  });
  const proposalIds: string[] = [];

  if (handoff.status === "abandoned") {
    await linkCloseArtifactsToWork(root, item.id, episode.id, proposalIds);
    return;
  }
  const target = handoff.status === "finished" ? ".agent-context/wiki/workflows.md" : ".agent-context/work/index.md";
  const proposal = await writeProposal(root, {
    id: stableId("proposal", `${item.id}:${handoff.id}:close`),
    asset: target,
    operation: "update",
    reason: handoff.status === "finished"
      ? "Completed work may contain reusable workflow, wiki, memory, or skill knowledge."
      : "Paused work created a handoff that may need follow-up or memory updates.",
    evidence: [item.id, handoff.id, episode.id, latestCheckpoint?.id].filter((value): value is string => Boolean(value)),
    risk: "low",
    status: "pending_review",
    patch: buildCloseProposalPatch(item, handoff, latestCheckpoint),
    created_at: nowIso(),
  });
  proposalIds.push(proposal.id);
  await linkCloseArtifactsToWork(root, item.id, episode.id, proposalIds);
}

function buildCloseProposalPatch(item: WorkItem, handoff: WorkHandoff, checkpoint: WorkCheckpoint | null): string {
  const lines = [
    `Work item: ${item.title}`,
    `Status: ${handoff.status}`,
    `Summary: ${handoff.summary}`,
    handoff.next ? `Next: ${handoff.next}` : undefined,
    checkpoint?.changed_files.length ? `Changed files: ${checkpoint.changed_files.join(", ")}` : undefined,
    checkpoint?.verification.length ? `Verification: ${checkpoint.verification.join("; ")}` : undefined,
    "Review whether this should update project wiki, memory, or a capability skill.",
  ];
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

async function linkCloseArtifactsToWork(root: string, workId: string, episodeId: string, proposalIds: string[]): Promise<void> {
  const file = await readWorkItems(root);
  const items = file.items.map((item) => item.id === workId
    ? {
      ...item,
      links: {
        ...item.links,
        episodes: Array.from(new Set([...item.links.episodes, episodeId])),
        proposals: Array.from(new Set([...item.links.proposals, ...proposalIds])),
      },
    }
    : item);
  await writeWorkItems(root, items);
}

async function writeHandoffMarkdown(root: string, handoff: WorkHandoff): Promise<void> {
  const filePath = path.join(paths(root).workHandoffs, `${handoff.id}.md`);
  const content = `# Handoff: ${handoff.work_id}

- status: ${handoff.status}
- session: ${handoff.session_id ?? ""}
- created: ${handoff.created_at}

## Summary
${handoff.summary}

## Next
${handoff.next ?? ""}
`;
  await writeFile(filePath, content, "utf8");
}

async function releaseLease(root: string, workId: string, sessionId?: string): Promise<void> {
  const leasesFile = await readLeases(root);
  const now = nowIso();
  leasesFile.leases = leasesFile.leases.map((lease) => {
    const sameWork = lease.work_id === workId;
    const sameSession = !sessionId || lease.session_id === sessionId;
    return sameWork && sameSession && lease.status === "active" ? { ...lease, status: "released", released_at: now } : lease;
  });
  await writeJson(paths(root).onlineLeases, leasesFile);
}

async function attachWorkToSession(root: string, sessionId: string, workId: string): Promise<void> {
  const sessionsFile = await readSessions(root);
  const now = nowIso();
  sessionsFile.sessions = sessionsFile.sessions.map((session) => session.id === sessionId
    ? { ...session, owned_work: Array.from(new Set([...session.owned_work, workId])), heartbeat_at: now }
    : session);
  await writeJson(paths(root).onlineSessions, sessionsFile);
}

async function detachWorkFromSession(root: string, workId: string, sessionId?: string): Promise<void> {
  const sessionsFile = await readSessions(root);
  const now = nowIso();
  sessionsFile.sessions = sessionsFile.sessions.map((session) => {
    if (sessionId && session.id !== sessionId) return session;
    if (!session.owned_work.includes(workId)) return session;
    return { ...session, owned_work: session.owned_work.filter((id) => id !== workId), heartbeat_at: now };
  });
  await writeJson(paths(root).onlineSessions, sessionsFile);
}

async function readWorkItems(root: string): Promise<WorkItemsFile> {
  return readJson(paths(root).workItems, { items: [] });
}

async function writeWorkItems(root: string, items: WorkItem[]): Promise<void> {
  await writeJson(paths(root).workItems, { items });
}

async function readSessions(root: string): Promise<SessionsFile> {
  return readJson(paths(root).onlineSessions, { sessions: [] });
}

async function readLeases(root: string): Promise<LeasesFile> {
  return readJson(paths(root).onlineLeases, { leases: [] });
}

function findWork(items: WorkItem[], workId: string): WorkItem {
  const item = items.find((entry) => entry.id === workId);
  if (!item) throw new Error(`Unknown work item: ${workId}`);
  return item;
}

async function writeWorkEvent(root: string, input: Omit<WorkEvent, "id" | "created_at">): Promise<void> {
  const event: WorkEvent = {
    id: stableId("event", `${input.type}:${input.work_id ?? ""}:${input.session_id ?? ""}:${nowIso()}`),
    created_at: nowIso(),
    ...input,
  };
  await ensureDir(path.dirname(paths(root).workEvents));
  await appendFile(paths(root).workEvents, `${JSON.stringify(event)}\n`, "utf8");
}
