# AgentMind Bootstrap For Local Agents

This file is for local coding agents such as Codex, Claude Code, Cursor, OpenCode, or any MCP-capable agent entering this workspace.

Your job is to make AgentMind active for this workspace before doing project work. Do not wait for the user to remember AgentMind commands.

## Bootstrap Rule

When you enter this workspace, run this sequence unless the user explicitly asks you not to initialize AgentMind:

```bash
agentmind setup
agentmind doctor
```

If `agentmind` is not available, tell the user to install it with `npm install -g agentmind` or, when developing AgentMind itself, to run `npm install && npm run build && npm link` in the AgentMind source checkout.

These commands are safe to rerun:

- `setup` creates missing AgentMind store files and connects Codex/Claude adapters.
- `doctor` verifies that AgentMind entrypoints, generated skills, hooks, and adapter views are present.
- Under the hood, setup is equivalent to safe `init` + adapter connection.

Do not overwrite unrelated user content outside AgentMind-managed blocks or generated AgentMind files.

After setup, read `.agent-context/AGENT_MANUAL.md` for the full operating protocol.

## After Bootstrap

Start an online AgentMind session for your harness.

For Codex:

```bash
agentmind online start --harness codex --session codex-main
```

For Claude Code:

```bash
agentmind online start --harness claude --session claude-main
```

If you can choose a better session id, use a short stable id based on the work focus, such as `codex-docs`, `claude-impl`, or `codex-review`.

Then report to the user:

- active sessions
- stale sessions
- doing work
- resumable work
- pending proposals
- open scans
- captured references/history
- discovered/promoted skills

Inspect those surfaces first:

```bash
agentmind scan list
agentmind sources list
agentmind skill list
```

Ask whether to continue existing work, run an open repository scan, process proposals, import references/history, create new work, or create a spec.

## Existing Repo Scan

For existing repos, `setup` creates an agent-led scan. Do not assume fixed paths. Read the scan instruction file, inspect the repo, then register sources with reasons:

```bash
agentmind scan add-source <scan-id> <path> --type <type> --reason "<why this matters>"
agentmind scan finish <scan-id> --summary "<what should be extracted>"
```

After finishing a scan, extract durable fixed knowledge into wiki pages and repeatable capability into canonical skills with citations.

## References And History

When the user provides an external reference or asks to backfill from past conversation, capture it before extracting:

```bash
agentmind reference add <path-or-url> --reason "<why it matters>"
agentmind history import <file> --reason "<backfill goal>"
```

Use generated proposals to decide what should update wiki, memory, skill, or tool rules.

## Skill Promotion

Discover harness-local skills, then promote reviewed skills into AgentMind canonical skills before treating them as cross-harness capability:

```bash
agentmind skill discover --from claude
agentmind skill promote <capability-id|skill-id>
agentmind skill render
```

## Start Work

Before editing project files for a task, create or claim a work item.

Create new work:

```bash
agentmind work add "<short task title>"
agentmind work claim <work-id> --session <session-id>
```

Claim existing work:

```bash
agentmind work claim <work-id> --session <session-id>
```

For large or cross-session tasks, create a spec:

```bash
agentmind spec create "<task title>" --work <work-id>
```

## During Work

Checkpoint after meaningful progress, before risky changes, and before context switches:

```bash
agentmind work checkpoint <work-id> --session <session-id> --summary "<what changed>" --next "<next step>"
```

Include verification and changed files when available:

```bash
agentmind work checkpoint <work-id> --session <session-id> --summary "<summary>" --next "<next>" --file <path> --verification "<check result>"
```

## End Or Handoff

When the user says `收工`, `handoff`, `结束`, `明天继续`, `pause`, or the task is complete, do not just stop. Close the AgentMind loop.

If complete:

```bash
agentmind work finish <work-id> --session <session-id> --summary "<summary>"
agentmind online end --session <session-id>
```

If incomplete:

```bash
agentmind work pause <work-id> --session <session-id> --summary "<summary>" --next "<next step>"
agentmind online end --session <session-id>
```

This creates handoff records and episode/proposal candidates for review.

## Stale Sessions

To inspect stale sessions and recoverable leases:

```bash
agentmind online status --stale-minutes 1440
```

If stale work exists, ask the user before taking over, pausing, or abandoning it. Do not silently steal work from another active session.

## Important Boundaries

- Do not treat CLI commands as the user experience. They are the runtime API that you call behind the scenes.
- Do not directly copy one harness's private memory or skills into another harness.
- Promote useful behavior into AgentMind canonical assets first, then render adapters.
- Treat discovered skills as candidates until promoted.
- Capture references/history before extracting fixed knowledge from them.
- Stable memory/wiki/skill/tool changes should go through proposals unless the user explicitly requests a direct edit.
