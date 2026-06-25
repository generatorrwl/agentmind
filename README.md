# AgentMind

AgentMind is a local-first, self-evolving capability layer for cross-harness coding agents.

It keeps project memory, wiki content, skills, tools, work state, online sessions, episodes, rewards, proposals, and imported capabilities in a readable `.agent-context/` directory, then exposes that context to local agent harnesses such as Codex and Claude Code.

The product goal is not to make users remember CLI commands. The CLI is the runtime API used by AgentMind adapters. After a project is connected, Codex or Claude Code should enter the workspace, read the AgentMind entrypoint, report current project status, guide the user to continue or create work, checkpoint progress, and write a handoff at the end.

Local agents entering this repository should read [AGENTMIND_BOOTSTRAP.md](./AGENTMIND_BOOTSTRAP.md) first.

## Install

Install AgentMind as a CLI tool:

```bash
npm install -g agentmind
```

Check that it is available:

```bash
agentmind --help
```

During early development, if the package has not been published yet, install from source:

```bash
git clone <agentmind-repo-url>
cd agentmind
npm install
npm run build
npm link
```

The source checkout is only for AgentMind development. Normal projects should use the `agentmind` command from npm or an installed binary.

## Use In Your Project

Go to the project where you want local agents to share memory, work state, wiki, and capabilities:

```bash
cd /path/to/your-project
agentmind setup
agentmind doctor
```

This creates or updates:

```text
.agent-context/
.agent-context/AGENT_MANUAL.md
.agent-context/sources/index.json
.agent-context/scans/index.json
.agent-context/skills/agentmind-workflow/SKILL.md
.agent-context/adapters/codex/SKILLS.md
AGENTS.md
CLAUDE.md
.claude/skills/agentmind-workflow/SKILL.md
.claude/hooks/agentmind-session-end.sh
.claude/settings.json
```

These commands are designed to be safe to rerun:

- `init` only creates missing AgentMind store files.
- `connect codex` updates the AgentMind managed block in `AGENTS.md` and adapter metadata.
- `connect claude` updates the AgentMind managed block in `CLAUDE.md`, generated AgentMind Claude skill/hook files, and hook registration.
- `setup` runs the safe initialization and adapter connection flow. In an existing repo, it also creates an agent-led scan task under `.agent-context/scans/`.

AgentMind should not overwrite unrelated user content outside AgentMind-managed blocks or generated AgentMind files.

## Start Working

Open Codex or Claude Code in your project and say:

```text
开始
```

The agent should start an AgentMind online session, report active/resumable work, and ask whether to continue existing work, create new work, or create a spec.

Behind the scenes, the agent will call commands like:

```bash
agentmind online start --harness codex --session codex-main
agentmind online status --stale-minutes 1440
```

For a new task, the agent should create and claim work:

```bash
agentmind work add "Investigate auth test failure"
agentmind work claim <work-id> --session codex-main
```

For large or cross-session tasks, it should create a spec:

```bash
agentmind spec create "Investigate auth test failure" --work <work-id>
```

During work, it should checkpoint progress:

```bash
agentmind work checkpoint <work-id> --session codex-main --summary "Found failing contract test" --next "Patch auth fixture"
```

When you say `收工`, `handoff`, `结束`, or `明天继续`, the agent should close the loop:

```bash
agentmind work finish <work-id> --session codex-main --summary "Fixed and verified"
agentmind online end --session codex-main
```

If the work is not complete:

```bash
agentmind work pause <work-id> --session codex-main --summary "Partially complete" --next "Continue from the failing test"
agentmind online end --session codex-main
```

`work finish` and `work pause` write handoffs and create episode/proposal candidates so completed work can feed the review and promotion loop.

## Existing Repositories

For an existing repo, setup creates a scan instruction file. AgentMind does not hardcode which paths matter. The agent reads the repo, selects relevant sources, and records why they matter:

```bash
agentmind scan list
agentmind scan add-source <scan-id> README.md --type docs --reason "Project entrypoint and setup workflow"
agentmind scan add-source <scan-id> package.json --type config --reason "Commands and package metadata"
agentmind scan finish <scan-id> --summary "Extract overview, workflows, commands, and skills"
```

Finishing a scan creates an extraction proposal. The agent should then update `.agent-context/wiki/`, `.agent-context/skills/`, memory, or tool config with source citations.

## References And History

When a user gives an important URL, paper, gist, design doc, or past conversation, capture it first:

```bash
agentmind reference add https://example.com/reference --reason "Relevant fixed knowledge reference"
agentmind history import ./past-session.md --reason "Backfill previous project decisions"
```

These commands store source records and create proposals for fixed wiki knowledge, memory, skill, or tool extraction. URL content is not fetched automatically by the local CLI; an agent with browser/network access should read it and preserve citations.

## Skills Across Harnesses

Canonical skills live in `.agent-context/skills/<skill-id>/SKILL.md`. Adapter views are generated from canonical skills:

```bash
agentmind skill discover --from claude
agentmind skill promote <capability-id|skill-id>
agentmind skill render
```

`discover` records existing `.claude/skills/*` as candidates. `promote` copies a reviewed skill into AgentMind canonical skills and re-renders Codex and Claude Code views.

## Useful Commands

```bash
agentmind status
agentmind setup --mode existing
agentmind doctor
agentmind online status --stale-minutes 1440
agentmind work list
agentmind review
agentmind import skill /path/to/skill-or-SKILL.md
agentmind reference add <path-or-url> --reason "important source"
agentmind history import <file> --reason "backfill previous conversations"
agentmind scan list
agentmind skill discover --from claude
agentmind skill promote <capability-id|skill-id>
agentmind record reward --polarity positive --evidence "User accepted the result"
agentmind reflect latest
agentmind mcp
```

## Project Store

```text
.agent-context/
  memory/
  wiki/
  skills/
  tools/
  work/
  online/
  plans/
  episodes/
  rewards/
  proposals/
  capabilities/
  adapters/
```

## Develop AgentMind From Source

Use this only when changing AgentMind itself:

```bash
git clone <agentmind-repo-url>
cd agentmind
npm install
npm run build
npm run check
npm link
```

Then test from another project:

```bash
cd /path/to/test-project
agentmind setup
agentmind doctor
```
