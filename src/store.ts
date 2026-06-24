import path from "node:path";
import { readdir, writeFile } from "node:fs/promises";
import { CapabilityRecord, EpisodeRecord, RewardEvent, UpdateProposal } from "./types.js";
import { ensureDir, exists, listMarkdownFiles, nowIso, readJson, readText, stableId, writeIfMissing, writeJson } from "./utils.js";

export const STORE_DIR = ".agent-context";

export interface StorePaths {
  root: string;
  store: string;
  memory: string;
  wiki: string;
  skills: string;
  tools: string;
  episodes: string;
  rewards: string;
  proposals: string;
  proposalsPending: string;
  proposalsAccepted: string;
  proposalsRejected: string;
  capabilities: string;
  capabilityRegistry: string;
  adapters: string;
  work: string;
  workItems: string;
  workEvents: string;
  workHandoffs: string;
  online: string;
  onlineSessions: string;
  onlineLeases: string;
  onlineHeartbeats: string;
  plans: string;
}

export function paths(root: string): StorePaths {
  const store = path.join(root, STORE_DIR);
  return {
    root,
    store,
    memory: path.join(store, "memory"),
    wiki: path.join(store, "wiki"),
    skills: path.join(store, "skills"),
    tools: path.join(store, "tools"),
    episodes: path.join(store, "episodes"),
    rewards: path.join(store, "rewards"),
    proposals: path.join(store, "proposals"),
    proposalsPending: path.join(store, "proposals", "pending"),
    proposalsAccepted: path.join(store, "proposals", "accepted"),
    proposalsRejected: path.join(store, "proposals", "rejected"),
    capabilities: path.join(store, "capabilities"),
    capabilityRegistry: path.join(store, "capabilities", "registry.json"),
    adapters: path.join(store, "adapters"),
    work: path.join(store, "work"),
    workItems: path.join(store, "work", "items.json"),
    workEvents: path.join(store, "work", "events.jsonl"),
    workHandoffs: path.join(store, "work", "handoffs"),
    online: path.join(store, "online"),
    onlineSessions: path.join(store, "online", "sessions.json"),
    onlineLeases: path.join(store, "online", "leases.json"),
    onlineHeartbeats: path.join(store, "online", "heartbeats"),
    plans: path.join(store, "plans"),
  };
}

export async function initStore(root: string): Promise<string[]> {
  const p = paths(root);
  const dirs = [
    p.memory,
    p.wiki,
    p.skills,
    p.tools,
    p.episodes,
    p.rewards,
    p.proposalsPending,
    p.proposalsAccepted,
    p.proposalsRejected,
    p.capabilities,
    p.work,
    p.workHandoffs,
    p.online,
    p.onlineHeartbeats,
    p.plans,
    path.join(p.adapters, "codex"),
    path.join(p.adapters, "claude-code"),
  ];
  for (const dir of dirs) await ensureDir(dir);

  const created: string[] = [];
  const files: Array<[string, string]> = [
    [path.join(p.memory, "public.md"), "# Public Memory\n\nLong-lived user/workspace preferences for local agent harnesses.\n"],
    [path.join(p.memory, "workspace.md"), "# Workspace Memory\n\nWorkspace-level operating notes.\n"],
    [path.join(p.wiki, "index.md"), "# Project Wiki\n\n- [Overview](overview.md) - Current project overview.\n- [Workflows](workflows.md) - Project workflows and runbooks.\n- [Gotchas](gotchas.md) - Known pitfalls and failure modes.\n"],
    [path.join(p.wiki, "overview.md"), "---\ntype: Project Overview\ntitle: Project Overview\ndescription: High-level project context.\nstatus: active\n---\n\n# Project Overview\n\nCapture durable project context here.\n"],
    [path.join(p.wiki, "workflows.md"), "---\ntype: Project Workflows\ntitle: Project Workflows\ndescription: Repeatable workflows for this workspace.\nstatus: active\n---\n\n# Project Workflows\n\n"],
    [path.join(p.wiki, "gotchas.md"), "---\ntype: Project Gotchas\ntitle: Project Gotchas\ndescription: Known pitfalls and failure modes.\nstatus: active\n---\n\n# Project Gotchas\n\n"],
    [path.join(p.wiki, "log.md"), `# Wiki Update Log\n\n## ${nowIso().slice(0, 10)}\n- **Creation**: Initialized AgentMind project wiki.\n`],
    [path.join(p.work, "index.md"), "# Project Work\n\nAgentMind-managed work queue and handoff surface.\n"],
    [path.join(p.tools, "mcp.json"), "{\n  \"mcpServers\": {}\n}\n"],
    [path.join(p.tools, "commands.yaml"), "# Project command registry.\ncommands: []\n"],
  ];
  for (const [filePath, content] of files) {
    if (await writeIfMissing(filePath, content)) created.push(path.relative(root, filePath));
  }

  if (!(await exists(p.capabilityRegistry))) {
    await writeJson(p.capabilityRegistry, { capabilities: [] });
    created.push(path.relative(root, p.capabilityRegistry));
  }
  if (!(await exists(p.workItems))) {
    await writeJson(p.workItems, { items: [] });
    created.push(path.relative(root, p.workItems));
  }
  if (!(await exists(p.onlineSessions))) {
    await writeJson(p.onlineSessions, { sessions: [] });
    created.push(path.relative(root, p.onlineSessions));
  }
  if (!(await exists(p.onlineLeases))) {
    await writeJson(p.onlineLeases, { leases: [] });
    created.push(path.relative(root, p.onlineLeases));
  }
  return created;
}

export async function storeStatus(root: string): Promise<Record<string, unknown>> {
  const p = paths(root);
  const pending = await listJsonFiles(p.proposalsPending);
  const episodes = await listJsonFiles(p.episodes);
  const rewards = await listJsonFiles(p.rewards);
  const skills = await listMarkdownFiles(p.skills);
  const registry = await readCapabilityRegistry(root);
  const workItems = await readJson<{ items: Array<{ status?: string }> }>(p.workItems, { items: [] });
  const sessions = await readJson<{ sessions: Array<{ status?: string }> }>(p.onlineSessions, { sessions: [] });
  return {
    initialized: await exists(p.store),
    store: p.store,
    episodes: episodes.length,
    rewards: rewards.length,
    pending_proposals: pending.length,
    skills: skills.length,
    capabilities: registry.capabilities.length,
    work: {
      total: workItems.items.length,
      todo: workItems.items.filter((item) => item.status === "todo").length,
      doing: workItems.items.filter((item) => item.status === "doing").length,
      paused: workItems.items.filter((item) => item.status === "paused").length,
      done: workItems.items.filter((item) => item.status === "done").length,
    },
    online: {
      active_sessions: sessions.sessions.filter((item) => item.status === "active").length,
    },
  };
}

export async function listJsonFiles(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path.join(dir, entry.name)).sort();
}

export async function writeEpisode(root: string, input: Partial<EpisodeRecord> & { goal: string }): Promise<EpisodeRecord> {
  const p = paths(root);
  const id = input.id ?? stableId("episode", `${nowIso()} ${input.goal}`);
  const episode: EpisodeRecord = {
    id,
    workspace: root,
    agent: input.agent,
    goal: input.goal,
    assets_used: input.assets_used ?? [],
    actions: input.actions ?? { files_read: [], files_modified: [], commands: [] },
    verification: input.verification ?? {},
    user_feedback: input.user_feedback ?? null,
    outcome: input.outcome ?? "unknown",
    created_at: input.created_at ?? nowIso(),
  };
  await writeJson(path.join(p.episodes, `${id}.json`), episode);
  return episode;
}

export async function writeReward(root: string, input: Partial<RewardEvent>): Promise<RewardEvent> {
  const p = paths(root);
  const id = input.id ?? stableId("reward", `${nowIso()} ${input.source ?? "unknown"} ${input.target_episode ?? ""}`);
  const reward: RewardEvent = {
    id,
    source: input.source ?? "human",
    polarity: input.polarity ?? "neutral",
    confidence: input.confidence ?? 0.5,
    target_episode: input.target_episode,
    evidence: input.evidence ?? [],
    suspected_causes: input.suspected_causes ?? [],
    created_at: input.created_at ?? nowIso(),
  };
  await writeJson(path.join(p.rewards, `${id}.json`), reward);
  return reward;
}

export async function writeProposal(root: string, proposal: UpdateProposal): Promise<UpdateProposal> {
  const p = paths(root);
  await writeJson(path.join(p.proposalsPending, `${proposal.id}.json`), proposal);
  return proposal;
}

export async function latestEpisode(root: string): Promise<EpisodeRecord | null> {
  const p = paths(root);
  const files = await listJsonFiles(p.episodes);
  if (files.length === 0) return null;
  return readJson<EpisodeRecord | null>(files[files.length - 1]!, null);
}

export async function latestReward(root: string): Promise<RewardEvent | null> {
  const p = paths(root);
  const files = await listJsonFiles(p.rewards);
  if (files.length === 0) return null;
  return readJson<RewardEvent | null>(files[files.length - 1]!, null);
}

export async function readCapabilityRegistry(root: string): Promise<{ capabilities: CapabilityRecord[] }> {
  return readJson(paths(root).capabilityRegistry, { capabilities: [] });
}

export async function writeCapabilityRegistry(root: string, capabilities: CapabilityRecord[]): Promise<void> {
  await writeJson(paths(root).capabilityRegistry, { capabilities });
}

export async function searchWiki(root: string, query: string): Promise<Array<{ file: string; snippet: string }>> {
  const p = paths(root);
  const files = await listMarkdownFiles(p.wiki);
  const normalized = query.toLowerCase().trim();
  const results: Array<{ file: string; snippet: string }> = [];
  for (const file of files) {
    const text = await readText(file);
    const lower = text.toLowerCase();
    const index = normalized ? lower.indexOf(normalized) : -1;
    if (!normalized || index >= 0) {
      const start = index >= 0 ? Math.max(0, index - 120) : 0;
      const snippet = text.slice(start, start + 320).replace(/\s+/g, " ").trim();
      results.push({ file: path.relative(root, file), snippet });
    }
  }
  return results.slice(0, 10);
}

export async function listSkills(root: string): Promise<Array<{ id: string; path: string; title?: string }>> {
  const p = paths(root);
  const files = await listMarkdownFiles(p.skills);
  return Promise.all(files.map(async (file) => {
    const text = await readText(file);
    const title = text.match(/^#\s+(.+)$/m)?.[1];
    return { id: path.basename(path.dirname(file)), path: path.relative(root, file), title };
  }));
}

export async function overwriteText(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, "utf8");
}
