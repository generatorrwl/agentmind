# AgentMind Bootstrap For Local Agents

This file is for local coding agents such as Codex, Claude Code, Cursor, OpenCode, or any MCP-capable agent entering this workspace.

Your job is to make AgentMind active for this workspace before doing project work. Do not wait for the user to remember AgentMind commands.

## Bootstrap Rule

When you enter this workspace, run this sequence unless the user explicitly asks you not to initialize AgentMind:

```bash
agentmind init
agentmind connect codex
agentmind connect claude
```

If `agentmind` is not available, tell the user to install it with `npm install -g agentmind` or, when developing AgentMind itself, to run `npm install && npm run build && npm link` in the AgentMind source checkout.

These commands are safe to rerun:

- `init` only creates missing AgentMind store files.
- `connect codex` updates only the AgentMind managed block in `AGENTS.md` and adapter metadata.
- `connect claude` updates only the AgentMind managed block in `CLAUDE.md`, generated AgentMind Claude skill/hook files, and hook registration.

Do not overwrite unrelated user content outside AgentMind-managed blocks or generated AgentMind files.

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

Ask whether to continue existing work, create new work, or create a spec.

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
- Stable memory/wiki/skill/tool changes should go through proposals unless the user explicitly requests a direct edit.
