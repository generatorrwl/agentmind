import path from "node:path";
import { connectHarness } from "./adapters.js";
import { createExistingRepoScanIfMissing } from "./scan.js";
import { initStore, paths, storeStatus } from "./store.js";
import { exists } from "./utils.js";

export async function setupWorkspace(root: string, input: { mode?: "auto" | "new" | "existing" } = {}): Promise<Record<string, unknown>> {
  const mode = input.mode ?? "auto";
  const detected = await detectWorkspace(root);
  const selectedMode = mode === "auto" ? (detected.looks_existing ? "existing" : "new") : mode;
  const created = await initStore(root);
  const codexFiles = await connectHarness(root, "codex");
  const claudeFiles = await connectHarness(root, "claude");
  const scan = selectedMode === "existing" ? await createExistingRepoScanIfMissing(root) : undefined;
  return {
    mode: selectedMode,
    detected,
    created,
    scan,
    connected: {
      codex: codexFiles,
      claude: claudeFiles,
    },
    next: [
      "Open Codex or Claude Code in this project.",
      "Say: 开始",
      selectedMode === "existing" && scan ? `Ask the agent to run the repository scan using ${scan.instructions_path}.` : "Create first work item and start accumulating project knowledge.",
    ],
  };
}

export async function doctorWorkspace(root: string): Promise<Record<string, unknown>> {
  const p = paths(root);
  const checks = {
    store: await exists(p.store),
    agent_manual: await exists(path.join(p.store, "AGENT_MANUAL.md")),
    canonical_workflow_skill: await exists(path.join(p.skills, "agentmind-workflow", "SKILL.md")),
    codex_agents_md: await exists(path.join(root, "AGENTS.md")),
    codex_skill_index: await exists(path.join(p.adapters, "codex", "SKILLS.md")),
    claude_md: await exists(path.join(root, "CLAUDE.md")),
    claude_workflow_skill: await exists(path.join(root, ".claude", "skills", "agentmind-workflow", "SKILL.md")),
    claude_session_hook: await exists(path.join(root, ".claude", "hooks", "agentmind-session-end.sh")),
    claude_settings: await exists(path.join(root, ".claude", "settings.json")),
    source_index: await exists(p.sourceIndex),
    scan_index: await exists(p.scanIndex),
  };
  const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    ok: missing.length === 0,
    checks,
    missing,
    status: await storeStatus(root),
    next: missing.length === 0
      ? ["AgentMind is connected. Open Codex or Claude Code and say: 开始"]
      : ["Run: agentmind setup"],
  };
}

async function detectWorkspace(root: string): Promise<Record<string, unknown> & { looks_existing: boolean }> {
  const markers = {
    git: await exists(path.join(root, ".git")),
    readme: await exists(path.join(root, "README.md")),
    package_json: await exists(path.join(root, "package.json")),
    pyproject: await exists(path.join(root, "pyproject.toml")),
    claude_md: await exists(path.join(root, "CLAUDE.md")),
    agents_md: await exists(path.join(root, "AGENTS.md")),
    claude_skills: await exists(path.join(root, ".claude", "skills")),
    cursor_rules: await exists(path.join(root, ".cursor", "rules")),
  };
  const score = Object.values(markers).filter(Boolean).length;
  return {
    ...markers,
    score,
    looks_existing: score >= 2,
  };
}
