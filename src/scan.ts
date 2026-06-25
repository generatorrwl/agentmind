import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ScanRecord, ScanSource, UpdateProposal } from "./types.js";
import { paths, writeProposal } from "./store.js";
import { ensureDir, nowIso, pathKind, readJson, slugify, stableId, writeJson } from "./utils.js";
import { overwriteText } from "./store.js";

interface ScanIndexFile { scans: ScanRecord[] }

export async function createScan(root: string, input: { goal?: string; mode?: "new" | "existing" | "manual" } = {}): Promise<ScanRecord> {
  const now = nowIso();
  const goal = input.goal ?? "Build initial AgentMind project wiki and capability inventory from this repository.";
  const existing = (await listScans(root)).find((scan) => scan.status === "open" && scan.goal === goal);
  if (existing) return existing;

  const id = stableId("scan", `${goal}:${now}`);
  const instructionPath = path.join(paths(root).scans, `${id}-instructions.md`);
  const scan: ScanRecord = {
    id,
    goal,
    mode: input.mode ?? "manual",
    status: "open",
    sources: [],
    instructions_path: path.relative(root, instructionPath),
    created_at: now,
    updated_at: now,
  };
  await writeScanInstructions(root, scan);
  await upsertScan(root, scan);
  return scan;
}

export async function listScans(root: string): Promise<ScanRecord[]> {
  return (await readScanIndex(root)).scans;
}

export async function addScanSource(root: string, scanId: string, input: { sourcePath: string; type?: ScanSource["type"]; reason: string; status?: ScanSource["status"] }): Promise<ScanRecord> {
  const scans = await listScans(root);
  const scan = findScan(scans, scanId);
  const normalizedPath = normalizeWorkspacePath(root, input.sourcePath);
  const absolutePath = path.isAbsolute(input.sourcePath) ? input.sourcePath : path.join(root, input.sourcePath);
  const kind = await pathKind(absolutePath);
  if (kind === "missing") throw new Error(`Scan source does not exist: ${input.sourcePath}`);

  const now = nowIso();
  const source: ScanSource = {
    id: stableId("scan_source", `${scan.id}:${normalizedPath}`),
    path: normalizedPath,
    type: input.type ?? inferSourceType(normalizedPath),
    reason: input.reason,
    status: input.status ?? "selected",
    added_at: now,
  };
  const updated: ScanRecord = {
    ...scan,
    sources: [...scan.sources.filter((item) => item.id !== source.id), source],
    updated_at: now,
  };
  await upsertScan(root, updated);
  return updated;
}

export async function finishScan(root: string, scanId: string, input: { summary?: string } = {}): Promise<{ scan: ScanRecord; proposal: UpdateProposal }> {
  const scans = await listScans(root);
  const scan = findScan(scans, scanId);
  const now = nowIso();
  const finished: ScanRecord = {
    ...scan,
    status: "finished",
    updated_at: now,
    finished_at: now,
  };
  await upsertScan(root, finished);
  const proposal = await writeProposal(root, {
    id: stableId("proposal", `${scan.id}:finish:${now}`),
    asset: ".agent-context/wiki/index.md",
    operation: "update",
    reason: "Repository scan selected sources for initial fixed knowledge and capability extraction.",
    evidence: [scan.id, scan.instructions_path, ...scan.sources.map((source) => source.path)],
    risk: "medium",
    status: "pending_review",
    patch: buildScanExtractionPatch(finished, input.summary),
    created_at: now,
  });
  return { scan: finished, proposal };
}

export async function createExistingRepoScanIfMissing(root: string): Promise<ScanRecord> {
  return createScan(root, {
    mode: "existing",
    goal: "Build initial AgentMind project wiki and capability inventory from this existing repository.",
  });
}

async function writeScanInstructions(root: string, scan: ScanRecord): Promise<void> {
  const topLevel = await topLevelInventory(root);
  const content = `# AgentMind Repository Scan: ${scan.id}\n\nGoal: ${scan.goal}\n\nThis is an agent-led scan. Do not assume AgentMind knows the important project paths ahead of time. Inspect the repository, identify the sources that actually explain the project, and register them with explicit reasons.\n\n## Source Selection Protocol\n\n1. Read existing entrypoints such as README, package manifests, agent instructions, docs indexes, config files, tests, and domain-specific directories when they exist.\n2. Decide which files or directories are source-of-truth for durable project facts, workflows, tool usage, or reusable skills.\n3. Register each selected source:\n\n\`\`\`bash\nagentmind scan add-source ${scan.id} <path> --type <code|docs|config|tests|agent_context|history|reference|other> --reason \"<why this matters>\" --root ${root}\n\`\`\`\n\n4. When enough sources are selected, finish the scan:\n\n\`\`\`bash\nagentmind scan finish ${scan.id} --summary \"<what should be extracted>\" --root ${root}\n\`\`\`\n\n5. Use the generated proposal to update wiki, memory, and canonical skills. Preserve citations to registered sources.\n\n## What To Extract\n\n- Fixed wiki knowledge: architecture, module boundaries, domain concepts, decisions, workflows, gotchas.\n- Fixed capability: repeatable project procedures that should become canonical skills.\n- Tool/MCP rules: commands, scripts, services, required environment, reliable validation.\n- Memory: durable user/project operating preferences.\n\n## Top-Level Inventory Hints\n\nThese are only hints. Select sources based on evidence, not this list alone.\n\n${topLevel.length > 0 ? topLevel.map((entry) => `- ${entry}`).join("\n") : "- No top-level entries detected."}\n`;
  await overwriteText(path.join(root, scan.instructions_path), content);
}

async function topLevelInventory(root: string): Promise<string[]> {
  const ignored = new Set([".git", "node_modules", "dist", ".agent-context"]);
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const rows: string[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name)).slice(0, 80)) {
      if (ignored.has(entry.name)) continue;
      const entryPath = path.join(root, entry.name);
      const info = await stat(entryPath).catch(() => null);
      const suffix = entry.isDirectory() ? "/" : "";
      const size = info && info.isFile() ? ` (${info.size} bytes)` : "";
      rows.push(`${entry.name}${suffix}${size}`);
    }
    return rows;
  } catch {
    return [];
  }
}

async function readScanIndex(root: string): Promise<ScanIndexFile> {
  return readJson(paths(root).scanIndex, { scans: [] });
}

async function upsertScan(root: string, scan: ScanRecord): Promise<void> {
  await ensureDir(paths(root).scans);
  const file = await readScanIndex(root);
  const scans = [...file.scans.filter((item) => item.id !== scan.id), scan]
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  await writeJson(paths(root).scanIndex, { scans });
  await writeJson(path.join(paths(root).scans, `${scan.id}.json`), scan);
}

function findScan(scans: ScanRecord[], id: string): ScanRecord {
  const scan = scans.find((item) => item.id === id);
  if (!scan) throw new Error(`Unknown scan: ${id}`);
  return scan;
}

function normalizeWorkspacePath(root: string, inputPath: string): string {
  const absolute = path.isAbsolute(inputPath) ? inputPath : path.join(root, inputPath);
  const relative = path.relative(root, absolute);
  return relative.startsWith("..") ? absolute : relative || ".";
}

function inferSourceType(sourcePath: string): ScanSource["type"] {
  const normalized = sourcePath.toLowerCase();
  const base = path.basename(normalized);
  if (base === "readme.md" || normalized.includes("/docs/") || normalized.endsWith(".md")) return "docs";
  if (normalized.includes("test") || normalized.includes("spec")) return "tests";
  if (base === "agents.md" || base === "claude.md" || normalized.includes(".claude") || normalized.includes(".cursor")) return "agent_context";
  if (base === "package.json" || base === "pyproject.toml" || base.endsWith("config.js") || base.endsWith("config.ts") || normalized.endsWith(".json") || normalized.endsWith(".yaml") || normalized.endsWith(".yml")) return "config";
  if (normalized.endsWith(".ts") || normalized.endsWith(".js") || normalized.endsWith(".py") || normalized.endsWith(".go") || normalized.endsWith(".rs")) return "code";
  return "other";
}

function buildScanExtractionPatch(scan: ScanRecord, summary?: string): string {
  const selected = scan.sources.filter((source) => source.status === "selected" || source.status === "candidate");
  return [
    `Scan: ${scan.id}`,
    `Goal: ${scan.goal}`,
    summary ? `Summary: ${summary}` : undefined,
    "",
    "Registered sources:",
    ...selected.map((source) => `- ${source.path} [${source.type}]: ${source.reason}`),
    "",
    "Agent extraction task:",
    "- Read the registered sources and extract only durable fixed knowledge.",
    "- Update `.agent-context/wiki/overview.md`, `workflows.md`, `gotchas.md`, or create focused wiki pages when justified.",
    "- Create or update canonical skills in `.agent-context/skills/<skill-id>/SKILL.md` for repeatable project procedures.",
    "- Update `.agent-context/tools/commands.yaml` or `.agent-context/tools/mcp.json` only when tool usage is evidenced.",
    "- Add source citations and confidence. Leave unresolved contradictions explicit.",
  ].filter((line): line is string => line !== undefined).join("\n");
}
