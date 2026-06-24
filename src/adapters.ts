import path from "node:path";
import { chmod } from "node:fs/promises";
import { AgentHarness } from "./types.js";
import { ensureDir, nowIso, readJson, readText, writeJson } from "./utils.js";
import { overwriteText, paths } from "./store.js";

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

  if (harness === "claude") {
    files.push(...await writeClaudeCodeWorkflow(root));
  }
  return files;
}

async function writeClaudeCodeWorkflow(root: string): Promise<string[]> {
  const files: string[] = [];
  const skillDir = path.join(root, ".claude", "skills", "agentmind-workflow");
  await ensureDir(skillDir);
  const skillPath = path.join(skillDir, "SKILL.md");
  await overwriteText(skillPath, claudeWorkflowSkill(root));
  files.push(path.relative(root, skillPath));

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

function claudeWorkflowSkill(root: string): string {
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

AgentMind is the canonical work, memory, wiki, capability, episode, and handoff layer for this workspace.

## Entry Flow

When the user starts work or opens this workspace:

1. Register this Claude Code session and read project status:
   \`\`\`bash
   agentmind online start --harness claude --root ${root}
   \`\`\`
2. Report active sessions, stale sessions, doing work, resumable work, and pending proposals.
3. Ask whether to continue an existing work item, create a new work item, or create a spec for large work.
4. Before editing files for a task, claim or create work:
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
- The SessionEnd hook is only a fallback. The intelligent handoff path is this skill-driven flow.
`;
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
