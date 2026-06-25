import path from "node:path";
import { chmod, readdir } from "node:fs/promises";
import { AgentHarness, CapabilityRecord } from "./types.js";
import { ensureDir, nowIso, readJson, readText, writeJson } from "./utils.js";
import { overwriteText, paths, readCapabilityRegistry } from "./store.js";

interface CanonicalSkillView {
  id: string;
  path: string;
  absolutePath: string;
  title: string;
  description?: string;
  status: CapabilityRecord["status"] | "canonical";
  renderable: boolean;
  content: string;
}

function managedBlock(root: string, harness: AgentHarness): string {
  const mcpCommand = `agentmind mcp --root ${root}`;
  const cli = "agentmind";
  const harnessName = harness === "claude" ? "claude" : "codex";
  return `<!-- agentmind:start -->
# AgentMind

AgentMind is the local, cross-harness capability layer and online work manager for this workspace.

Use these canonical assets before relying on ad hoc session context:

- Public memory: \`.agent-context/memory/public.md\`
- Workspace memory: \`.agent-context/memory/workspace.md\`
- Project wiki: \`.agent-context/wiki/index.md\`
- Skills: \`.agent-context/skills/\`
- Agent manual: \`.agent-context/AGENT_MANUAL.md\`
- Work queue: \`.agent-context/work/items.json\`
- Online sessions: \`.agent-context/online/sessions.json\`
- Pending proposals: \`.agent-context/proposals/pending/\`

## Required Entry Flow

When entering this workspace or when the user says "start", "continue", "开始", or "继续":

1. Register this session and read the current project status:
   \`\`\`bash
   ${cli} online start --harness ${harnessName} --root ${root}
   \`\`\`
2. Report active sessions, active/resumable work, stale handoffs, and pending proposals.
   Also read \`.agent-context/AGENT_MANUAL.md\` for the full AgentMind operating protocol.
3. Ask whether to continue an existing work item, create new work, or create a spec for a larger task.
4. Before editing project files for a task, claim or create a work item:
   \`\`\`bash
   ${cli} work claim <work-id> --session <session-id> --root ${root}
   ${cli} work add "<title>" --root ${root}
   \`\`\`
5. For large or cross-session work, create a plan artifact:
   \`\`\`bash
   ${cli} spec create "<title>" --work <work-id> --root ${root}
   \`\`\`

## During Work

- Write checkpoints after meaningful progress, before risky changes, and before context switches:
  \`\`\`bash
  ${cli} work checkpoint <work-id> --session <session-id> --summary "<what changed>" --next "<next step>" --root ${root}
  \`\`\`
- Capture references, durable observations, and verification results as evidence for later proposals.

## End / Handoff Flow

When the user says "收工", "handoff", "结束", "明天继续", "pause", or the task is complete:

1. If complete, run \`${cli} work finish <work-id> --session <session-id> --summary "<summary>" --root ${root}\`.
2. If incomplete, run \`${cli} work pause <work-id> --session <session-id> --summary "<summary>" --next "<next step>" --root ${root}\`.
3. Close the online session with \`${cli} online end --session <session-id> --root ${root}\`.
4. Summarize what changed, verification status, current work state, and next step.

Do not directly copy another harness's private memory or skills into this harness. Promote useful behavior into AgentMind canonical assets first, then render adapters.

## Skill Discovery

- Canonical AgentMind skills live in \`.agent-context/skills/\`.
- Before doing task-specific work, inspect available skills.
- For Codex, read \`.agent-context/adapters/codex/SKILLS.md\`.
- For Claude Code, generated skill views may also exist under \`.claude/skills/\`.

MCP server command for ${harness}:

\`\`\`bash
${mcpCommand}
\`\`\`

When work completes, record useful episode/reward signals through AgentMind when available.
<!-- agentmind:end -->
`;
}

function replaceManagedBlock(existing: string, block: string): string {
  const pattern = /<!-- agentmind:start -->[\s\S]*?<!-- agentmind:end -->\n?/;
  if (pattern.test(existing)) return existing.replace(pattern, block);
  const prefix = existing.trim().length > 0 ? `${existing.trimEnd()}\n\n` : "";
  return `${prefix}${block}`;
}

export async function connectHarness(root: string, harness: AgentHarness): Promise<string[]> {
  const p = paths(root);
  const files: string[] = [];
  files.push(...await writeAgentManual(root));
  files.push(...await writeCanonicalAgentMindWorkflowSkill(root));
  const target = harness === "codex" ? path.join(root, "AGENTS.md") : path.join(root, "CLAUDE.md");
  const existing = await readText(target);
  await overwriteText(target, replaceManagedBlock(existing, managedBlock(root, harness)));
  files.push(path.relative(root, target));

  const adapterDir = path.join(p.adapters, harness === "codex" ? "codex" : "claude-code");
  await ensureDir(adapterDir);
  const mcpConfig = {
    mcpServers: {
      agentmind: {
        command: "agentmind",
        args: ["mcp", "--root", root],
      },
    },
    updated_at: nowIso(),
  };
  const mcpPath = path.join(adapterDir, "mcp.json");
  await overwriteText(mcpPath, `${JSON.stringify(mcpConfig, null, 2)}\n`);
  files.push(path.relative(root, mcpPath));

  if (harness === "codex") {
    files.push(...await writeCodexSkillIndex(root));
  }
  if (harness === "claude") {
    files.push(...await writeClaudeCodeAdapter(root));
  }
  return files;
}

export async function renderAdapters(root: string): Promise<string[]> {
  const files: string[] = [];
  files.push(...await writeCodexSkillIndex(root));
  files.push(...await writeClaudeCodeSkillViews(root));
  return Array.from(new Set(files));
}

async function writeAgentManual(root: string): Promise<string[]> {
  const manualPath = path.join(paths(root).store, "AGENT_MANUAL.md");
  await overwriteText(manualPath, agentManual(root));
  return [path.relative(root, manualPath)];
}

async function writeCanonicalAgentMindWorkflowSkill(root: string): Promise<string[]> {
  const skillDir = path.join(paths(root).skills, "agentmind-workflow");
  await ensureDir(skillDir);
  const skillPath = path.join(skillDir, "SKILL.md");
  await overwriteText(skillPath, agentMindWorkflowSkill(root, "canonical"));
  return [path.relative(root, skillPath)];
}

async function writeCodexSkillIndex(root: string): Promise<string[]> {
  const adapterDir = path.join(paths(root).adapters, "codex");
  await ensureDir(adapterDir);
  const skillIndexPath = path.join(adapterDir, "SKILLS.md");
  await overwriteText(skillIndexPath, codexSkillIndex(root, await listCanonicalSkillViews(root)));
  return [path.relative(root, skillIndexPath)];
}

async function writeClaudeCodeAdapter(root: string): Promise<string[]> {
  const files: string[] = [];
  files.push(...await writeClaudeCodeSkillViews(root));

  const hookDir = path.join(root, ".claude", "hooks");
  await ensureDir(hookDir);
  const hookPath = path.join(hookDir, "agentmind-session-end.sh");
  await overwriteText(hookPath, claudeSessionEndHook(root));
  await chmod(hookPath, 0o755);
  files.push(path.relative(root, hookPath));

  const settingsPath = path.join(root, ".claude", "settings.json");
  const settings = await readJson<Record<string, unknown>>(settingsPath, {});
  const updated = mergeClaudeSessionEndHook(settings, "$CLAUDE_PROJECT_DIR/.claude/hooks/agentmind-session-end.sh");
  await writeJson(settingsPath, updated);
  files.push(path.relative(root, settingsPath));
  return files;
}

async function writeClaudeCodeSkillViews(root: string): Promise<string[]> {
  const files: string[] = [];
  const skills = (await listCanonicalSkillViews(root)).filter((skill) => skill.renderable);
  for (const skill of skills) {
    const skillDir = path.join(root, ".claude", "skills", skill.id);
    await ensureDir(skillDir);
    const skillPath = path.join(skillDir, "SKILL.md");
    const content = skill.id === "agentmind-workflow" ? agentMindWorkflowSkill(root, "claude") : generatedClaudeSkillView(skill);
    await overwriteText(skillPath, content);
    files.push(path.relative(root, skillPath));
  }
  return files;
}

function agentMindWorkflowSkill(root: string, target: "canonical" | "claude"): string {
  const generatedNote = target === "claude"
    ? "\n> Generated view from AgentMind canonical skill. Do not edit this file as the source of truth; update `.agent-context/skills/agentmind-workflow/SKILL.md` instead.\n"
    : "\n> Canonical AgentMind workflow skill. Adapter-specific views are generated from this file.\n";
  return `---
name: agentmind-workflow
description: |
  AgentMind workspace workflow for Claude Code. Use when entering the workspace,
  starting or continuing work, creating specs, checkpointing, or ending/handoff.

  Trigger phrases: start, continue, new work, spec, handoff, pause, finish,
  开始, 继续, 新任务, 写个 spec, 收工, 结束, 明天继续
tools: [Bash, Read, Write, Edit, Glob, Grep]
---

# AgentMind Workflow
${generatedNote}

AgentMind is the canonical work, memory, wiki, capability, episode, and handoff layer for this workspace.

Read \`.agent-context/AGENT_MANUAL.md\` for the full operating protocol before substantial work.

## Entry Flow

When the user starts work or opens this workspace:

1. Register this Claude Code session and read project status:
   \`\`\`bash
   agentmind online start --harness claude --root ${root}
   \`\`\`
2. Report active sessions, stale sessions, doing work, resumable work, and pending proposals.
3. Check open scans and captured sources:
   \`\`\`bash
   agentmind scan list --root ${root}
   agentmind sources list --root ${root}
   \`\`\`
4. If an open existing-repo scan exists, read its instructions and ask whether to run repository extraction before regular work.
5. Ask whether to continue an existing work item, create a new work item, create a spec, or process pending proposals.
6. Before editing files for a task, claim or create work:
   \`\`\`bash
   agentmind work claim <work-id> --session <session-id> --root ${root}
   agentmind work add "<title>" --root ${root}
   \`\`\`

## Spec Flow

For large or cross-session tasks, create a plan artifact before execution:

\`\`\`bash
agentmind spec create "<title>" --work <work-id> --root ${root}
\`\`\`

Use the spec as an execution plan, not as durable project knowledge. Durable knowledge should be promoted later through proposals.

## Existing Repository Scan Flow

When a scan is open, read its instruction file, inspect the repository, and register only sources you judge relevant:

\`\`\`bash
agentmind scan add-source <scan-id> <path> --type <type> --reason "<why this source matters>" --root ${root}
agentmind scan finish <scan-id> --summary "<what should be extracted>" --root ${root}
\`\`\`

Then extract fixed knowledge into wiki pages and repeatable capability into canonical skills, preserving citations.

## Reference And History Flow

When the user provides an external reference or past conversation, capture it first:

\`\`\`bash
agentmind reference add <path-or-url> --reason "<why it matters>" --root ${root}
agentmind history import <file> --reason "<backfill goal>" --root ${root}
\`\`\`

Use generated proposals to decide what should become fixed wiki knowledge, memory, or skill content.

## Skill Promotion Flow

Discover existing Claude Code skills before assuming AgentMind already owns them:

\`\`\`bash
agentmind skill discover --from claude --root ${root}
agentmind skill promote <capability-id|skill-id> --root ${root}
agentmind skill render --root ${root}
\`\`\`

Only promoted/canonical skills should be treated as cross-harness capability.

## During Work

- Checkpoint after meaningful progress, before risky changes, and before context switches.
- Include summary, next step, blockers, touched files, and verification results where available.

\`\`\`bash
agentmind work checkpoint <work-id> --session <session-id> --summary "<what changed>" --next "<next step>" --root ${root}
\`\`\`

## End / Handoff Flow

When the user says "收工", "handoff", "结束", "明天继续", "pause", or the task is complete:

1. If complete:
   \`\`\`bash
   agentmind work finish <work-id> --session <session-id> --summary "<summary>" --root ${root}
   \`\`\`
2. If incomplete:
   \`\`\`bash
   agentmind work pause <work-id> --session <session-id> --summary "<summary>" --next "<next step>" --root ${root}
   \`\`\`
3. Close the session:
   \`\`\`bash
   agentmind online end --session <session-id> --root ${root}
   \`\`\`
4. Tell the user what changed, what was verified, current work state, and the next step.

## Boundaries

- Do not directly copy private Claude Code memory/skills into Codex or another harness.
- Promote useful behavior into AgentMind canonical assets first, then render adapters.
- Capture external references and history before extracting fixed knowledge from them.
- The SessionEnd hook is only a fallback. The intelligent handoff path is this skill-driven flow.
`;
}

function codexSkillIndex(root: string, skills: CanonicalSkillView[]): string {
  const renderable = skills.filter((skill) => skill.renderable);
  const candidates = skills.filter((skill) => !skill.renderable);
  const available = renderable.length > 0
    ? renderable.map((skill) => `### ${skill.id}\n\n- Path: \`${skill.path}\`\n- Status: \`${skill.status}\`\n- Purpose: ${skill.description ?? skill.title}\n`).join("\n")
    : "No active project skills are available yet.\n";
  const candidateSection = candidates.length > 0
    ? `\n## Candidate Skills Not Active Yet\n\n${candidates.map((skill) => `- \`${skill.id}\` at \`${skill.path}\` has status \`${skill.status}\`; promote before relying on it.`).join("\n")}\n`
    : "";
  return `# AgentMind Skills For Codex

This file is generated by AgentMind. It indexes canonical project skills for Codex.

Canonical skills live in:

\`\`\`text
.agent-context/skills/
\`\`\`

Before performing a task, inspect this index and read any matching \`SKILL.md\` completely.

## Available Skills

${available}${candidateSection}
## Protocol

1. Read \`.agent-context/AGENT_MANUAL.md\` when entering the project.
2. Read the relevant canonical skill before task-specific work.
3. Do not edit generated adapter views as source of truth.
4. Promote useful behavior through AgentMind proposals before treating it as stable skill content.

MCP server command:

\`\`\`bash
agentmind mcp --root ${root}
\`\`\`
`;
}

function agentManual(root: string): string {
  return `# AgentMind Agent Manual

This manual is for local agents operating inside this workspace.

AgentMind is the workspace's canonical layer for memory, project wiki, skills, tools, online work, episodes, rewards, proposals, and handoffs.

## Entry Protocol

When entering this workspace or when the user says \`开始\`, \`start\`, \`continue\`, or \`继续\`:

1. Start or refresh an online session:
   \`\`\`bash
   agentmind online start --harness <codex|claude> --session <session-id> --root ${root}
   \`\`\`
2. Report active sessions, stale sessions, doing work, resumable work, and pending proposals.
3. Inspect open scans, captured sources, and capability state:
   \`\`\`bash
   agentmind scan list --root ${root}
   agentmind sources list --root ${root}
   agentmind skill list --root ${root}
   \`\`\`
4. If an open scan exists, read its instruction file and ask whether to run repository extraction now.
5. Ask whether to continue existing work, create new work, create a spec, process pending proposals, or import references/history.

## Work Protocol

Before editing project files for a task, create or claim work:

\`\`\`bash
agentmind work add "<task title>" --root ${root}
agentmind work claim <work-id> --session <session-id> --root ${root}
\`\`\`

For large or cross-session work, create a spec:

\`\`\`bash
agentmind spec create "<task title>" --work <work-id> --root ${root}
\`\`\`

Checkpoint after meaningful progress, before risky changes, and before context switches:

\`\`\`bash
agentmind work checkpoint <work-id> --session <session-id> --summary "<summary>" --next "<next step>" --root ${root}
\`\`\`

## Repository Scan Protocol

For existing repos, setup creates an open scan and instruction file. The agent chooses relevant sources; AgentMind does not hardcode project paths.

\`\`\`bash
agentmind scan list --root ${root}
agentmind scan add-source <scan-id> <path> --type <type> --reason "<why this source matters>" --root ${root}
agentmind scan finish <scan-id> --summary "<what should be extracted>" --root ${root}
\`\`\`

After finishing a scan, update wiki pages and canonical skills only with source citations and confidence.

## Reference And History Protocol

Capture external references and past conversations before extracting from them:

\`\`\`bash
agentmind reference add <path-or-url> --reason "<why it matters>" --root ${root}
agentmind history import <file> --reason "<backfill goal>" --root ${root}
\`\`\`

Treat generated proposals as extraction tasks for fixed wiki knowledge, memory, skills, or tool rules.

## Handoff Protocol

When the user says \`收工\`, \`handoff\`, \`结束\`, \`明天继续\`, or work is complete:

Complete work:

\`\`\`bash
agentmind work finish <work-id> --session <session-id> --summary "<summary>" --root ${root}
agentmind online end --session <session-id> --root ${root}
\`\`\`

Pause incomplete work:

\`\`\`bash
agentmind work pause <work-id> --session <session-id> --summary "<summary>" --next "<next step>" --root ${root}
agentmind online end --session <session-id> --root ${root}
\`\`\`

## Skill Protocol

- Canonical skills live in \`.agent-context/skills/\`.
- Adapter views such as \`.claude/skills/\` or \`.agent-context/adapters/codex/SKILLS.md\` are generated views.
- Read relevant \`SKILL.md\` files completely before using a skill.
- Do not copy harness-private skills directly into another harness. Promote to canonical AgentMind skill first, then render adapters.

Commands:

\`\`\`bash
agentmind skill discover --from claude --root ${root}
agentmind skill promote <capability-id|skill-id> --root ${root}
agentmind skill render --root ${root}
\`\`\`

Discovered skills are candidates. Promoted/canonical skills are cross-harness capability.

## Review Protocol

Use pending proposals for durable changes:

\`\`\`bash
agentmind review --root ${root}
\`\`\`

Stable memory/wiki/skill/tool changes should go through proposals unless the user explicitly asks for direct edits.
`;
}

async function listCanonicalSkillViews(root: string): Promise<CanonicalSkillView[]> {
  const p = paths(root);
  const registry = await readCapabilityRegistry(root);
  const capabilityBySkillId = new Map<string, CapabilityRecord>();
  for (const capability of registry.capabilities) {
    if (capability.type !== "skill") continue;
    const sourcePath = capability.source.path ?? "";
    const skillId = sourcePath.endsWith("SKILL.md") ? path.basename(path.dirname(sourcePath)) : path.basename(sourcePath);
    if (skillId) capabilityBySkillId.set(skillId, capability);
  }

  const entries = await readdir(p.skills, { withFileTypes: true }).catch(() => []);
  const skills: CanonicalSkillView[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(p.skills, entry.name, "SKILL.md");
    const content = await readText(skillPath);
    if (!content) continue;
    const metadata = parseSkillMetadata(content);
    const capability = capabilityBySkillId.get(entry.name);
    const status = entry.name === "agentmind-workflow" ? "canonical" : capability?.status ?? "canonical";
    skills.push({
      id: entry.name,
      path: path.relative(root, skillPath),
      absolutePath: skillPath,
      title: metadata.name ?? content.match(/^#\s+(.+)$/m)?.[1] ?? entry.name,
      description: metadata.description,
      status,
      renderable: entry.name === "agentmind-workflow" || isRenderableSkillStatus(status),
      content,
    });
  }
  return skills.sort((left, right) => left.id.localeCompare(right.id));
}

function parseSkillMetadata(content: string): { name?: string; description?: string } {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter?.[1]) return {};
  const body = frontmatter[1];
  const name = body.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const descriptionLine = body.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  const descriptionBlock = body.match(/^description:\s*\|\n([\s\S]*?)(?:\n[a-zA-Z_]+:|$)/m)?.[1]
    ?.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  return { name, description: descriptionBlock ?? descriptionLine };
}

function isRenderableSkillStatus(status: CanonicalSkillView["status"]): boolean {
  return status === "installed" || status === "project-adapted" || status === "active" || status === "promoted" || status === "canonical";
}

function generatedClaudeSkillView(skill: CanonicalSkillView): string {
  return `${skill.content.trimEnd()}\n\n---\n\n> Generated by AgentMind from \`${skill.path}\`. Do not edit this generated Claude Code view as the source of truth. Update or promote the canonical AgentMind skill instead.\n`;
}

function claudeSessionEndHook(root: string): string {
  return `#!/bin/bash
# AgentMind SessionEnd fallback for Claude Code.
# This hook is intentionally conservative: it records an end marker/heartbeat only.
# It does not mark work as done, pause work, or promote memory/wiki/skills.

set -e

PROJECT_DIR="\${CLAUDE_PROJECT_DIR:-${root}}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

if command -v agentmind >/dev/null 2>&1; then
  TS=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  mkdir -p .agent-context/online/hook-events
  printf '{"event":"claude-session-end","created_at":"%s","note":"fallback only; run AgentMind handoff flow next session if work is still active"}\n' "$TS" >> .agent-context/online/hook-events/events.jsonl
  agentmind online status --root "$PROJECT_DIR" >/dev/null 2>&1 || true
fi

exit 0
`;
}

function mergeClaudeSessionEndHook(settings: Record<string, unknown>, command: string): Record<string, unknown> {
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  const sessionEnd = Array.isArray(hooks.SessionEnd) ? hooks.SessionEnd : [];
  const hookEntry = { type: "command", command };
  const alreadyRegistered = JSON.stringify(sessionEnd).includes(command);
  const nextSessionEnd = alreadyRegistered
    ? sessionEnd
    : [...sessionEnd, { hooks: [hookEntry] }];
  return {
    ...settings,
    hooks: {
      ...hooks,
      SessionEnd: nextSessionEnd,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
