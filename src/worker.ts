import path from "node:path";
import { UpdateProposal, WorkerJob, WorkerMode, WorkerRun, ResourceBundle, SourceRecord, WorkCheckpoint, WorkHandoff } from "./types.js";
import { listJsonFiles, listSkills, paths } from "./store.js";
import { projectDesignReadiness } from "./store.js";
import { listProposals, summarizeProposals } from "./review.js";
import { listSources } from "./sources.js";
import { listMarkdownFiles, nowIso, readJson, readText, stableId, writeJson } from "./utils.js";
import { overwriteText } from "./store.js";

export interface WorkerRunResult {
  bundle: ResourceBundle;
  job: WorkerJob;
  run: WorkerRun;
  packet: string;
  next: string[];
}

interface WorkerRunOptions {
  mode?: WorkerMode;
  source?: string;
  asset?: string;
}

interface WorkerInputSummary {
  id: string;
  kind: "episode" | "handoff" | "checkpoint" | "source" | "proposal";
  path?: string;
  summary: string;
  created_at?: string;
  asset?: string;
}

interface AssetContextSummary {
  wiki_pages: Array<{ path: string; title?: string }>;
  skills: Array<{ id: string; path: string; title?: string }>;
  memory_files: string[];
  project_rules: {
    complete: boolean;
    profile: string;
    schema: string;
    extraction_skill: string;
    workflow_skill: string;
    missing: string[];
    recommendation?: string;
  };
  pending_proposals: Array<{ id: string; asset: string; reason: string; risk: string }>;
  accepted_proposals: Array<{ id: string; asset: string; reason: string; risk: string }>;
  rejected_proposals: Array<{ id: string; asset: string; reason: string; risk: string }>;
}

export async function runWorkerOnce(root: string, options: WorkerRunOptions = {}): Promise<WorkerRunResult> {
  const inputs = await collectWorkerInputs(root, options);
  const mode = options.mode ?? inferMode(inputs);
  const assetContext = await collectAssetContext(root, options.asset);
  const now = nowIso();
  const inputKey = inputs.map((input) => input.id).join(":") || "empty";
  const bundleId = stableId("resource_bundle", `${mode}:${inputKey}:${now}`);
  const jobId = stableId("worker_job", `${bundleId}:${mode}:${now}`);
  const runId = stableId("worker_run", `${jobId}:${now}`);
  const normalizedPath = path.join(paths(root).workerBundles, `${bundleId}-content.json`);
  const targetAssets = inferTargetAssets(inputs, assetContext, options.asset);

  const bundle: ResourceBundle = {
    id: bundleId,
    kind: inferBundleKind(inputs),
    source_ids: inputs.map((input) => input.id),
    summary: summarizeInputs(inputs),
    normalized_content_path: path.relative(root, normalizedPath),
    created_at: now,
  };
  const job: WorkerJob = {
    id: jobId,
    mode,
    status: "queued",
    resource_bundle_id: bundle.id,
    target_assets: targetAssets,
    created_at: now,
    updated_at: now,
  };
  const packet = buildWorkerPacket(root, { bundle, job, inputs, assetContext, options });
  const packetPath = path.join(paths(root).workerPackets, `${runId}.md`);
  const run: WorkerRun = {
    id: runId,
    job_id: job.id,
    backend: "skill_driven",
    status: "packet_ready",
    inputs: inputs.map((input) => input.id),
    decisions: [
      { type: "backend", message: "Prepared a skill-driven Worker packet instead of launching an autonomous Agent." },
      { type: "mode", message: `Classified this run as ${mode}.`, reason: modeReason(mode, inputs, options) },
      { type: "scope", message: "Stable Wiki/Skill/Memory assets must not be modified by the CLI packet step." },
    ],
    proposals: [],
    discarded: inputs.length === 0 ? [{ input: "workspace", reason: "No native Worker inputs were found." }] : [],
    packet_path: path.relative(root, packetPath),
    created_at: now,
  };

  await writeJson(path.join(paths(root).workerBundles, `${bundle.id}.json`), bundle);
  await writeJson(normalizedPath, { inputs, asset_context: assetContext });
  await writeJson(path.join(paths(root).workerJobs, `${job.id}.json`), job);
  await writeJson(path.join(paths(root).workerRuns, `${run.id}.json`), run);
  await writeJson(path.join(paths(root).workerPackets, `${run.id}.json`), { bundle, job, run, inputs, asset_context: assetContext });
  await writePacketMarkdown(packetPath, packet);

  return {
    bundle,
    job,
    run,
    packet: path.relative(root, packetPath),
    next: [
      `Read ${path.relative(root, packetPath)}.`,
      "Use `.agent-context/skills/agentmind-worker/SKILL.md` to execute the packet.",
      "Write pending proposals only; do not directly modify stable Wiki/Skill/Memory assets unless explicitly requested.",
    ],
  };
}

async function collectWorkerInputs(root: string, options: WorkerRunOptions): Promise<WorkerInputSummary[]> {
  if (options.source) return collectTargetedInputs(root, options.source);
  const [episodes, handoffs, checkpoints, sources, proposals] = await Promise.all([
    recentJsonRecords(root, paths(root).episodes, "episode", 5),
    recentJsonRecords(root, paths(root).workHandoffs, "handoff", 5),
    recentJsonRecords(root, path.join(paths(root).work, "checkpoints"), "checkpoint", 5),
    recentSources(root, 5),
    recentProposals(root, 8),
  ]);
  return [...handoffs, ...episodes, ...checkpoints, ...sources, ...proposals].slice(0, 24);
}

async function collectTargetedInputs(root: string, source: string): Promise<WorkerInputSummary[]> {
  const p = paths(root);
  const sourceRecord = (await listSources(root)).find((item) => item.id === source || item.snapshot_path === source || item.source.path === source || item.source.url === source);
  if (sourceRecord) return [summarizeSource(sourceRecord)];

  const proposal = await findProposalById(root, source);
  if (proposal) return [summarizeProposal(proposal)];

  const candidateFiles = [
    path.join(p.episodes, `${source}.json`),
    path.join(p.workHandoffs, `${source}.json`),
    path.join(p.work, "checkpoints", `${source}.json`),
    path.isAbsolute(source) ? source : path.join(root, source),
  ];
  for (const file of candidateFiles) {
    const text = await readText(file);
    if (!text) continue;
    return [{ id: source, kind: inferKindFromPath(file), path: path.relative(root, file), summary: preview(text, 360) }];
  }
  throw new Error(`Worker source not found: ${source}`);
}

async function recentJsonRecords(root: string, dir: string, kind: WorkerInputSummary["kind"], limit: number): Promise<WorkerInputSummary[]> {
  const files = (await listJsonFiles(dir)).slice(-limit).reverse();
  const records: WorkerInputSummary[] = [];
  for (const file of files) {
    const value = await readJson<Record<string, unknown> | null>(file, null);
    if (!value) continue;
    records.push({
      id: stringValue(value.id) ?? path.basename(file, ".json"),
      kind,
      path: path.relative(root, file),
      summary: summarizeRecord(kind, value),
      created_at: stringValue(value.created_at),
      asset: stringValue(value.asset),
    });
  }
  return records;
}

async function recentSources(root: string, limit: number): Promise<WorkerInputSummary[]> {
  return (await listSources(root))
    .slice(-limit)
    .reverse()
    .map(summarizeSource);
}

async function recentProposals(root: string, limit: number): Promise<WorkerInputSummary[]> {
  const buckets = await Promise.all([listProposals(root, "pending"), listProposals(root, "accepted"), listProposals(root, "rejected")]);
  return buckets.flat()
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .slice(-limit)
    .reverse()
    .map(summarizeProposal);
}

async function findProposalById(root: string, id: string): Promise<UpdateProposal | null> {
  for (const bucket of ["pending", "accepted", "rejected", "applied"] as const) {
    const proposal = (await listProposals(root, bucket)).find((item) => item.id === id);
    if (proposal) return proposal;
  }
  return null;
}

async function collectAssetContext(root: string, preferredAsset?: string): Promise<AssetContextSummary> {
  const wikiPages = await wikiPageSummaries(root);
  const memoryFiles = ["public.md", "workspace.md"].map((file) => path.join(".agent-context/memory", file));
  const skills = await listSkills(root);
  const pending = await summarizeProposals(root, "pending");
  const accepted = await summarizeProposals(root, "accepted");
  const rejected = await summarizeProposals(root, "rejected");
  const readiness = await projectDesignReadiness(root) as { complete?: boolean; missing?: string[]; recommendation?: string };
  const matchesAsset = (asset: string): boolean => !preferredAsset || asset === preferredAsset || asset.includes(preferredAsset) || preferredAsset.includes(asset);
  return {
    wiki_pages: wikiPages.filter((page) => matchesAsset(page.path)).slice(0, preferredAsset ? 20 : 12),
    skills: skills.filter((skill) => matchesAsset(skill.path)).slice(0, preferredAsset ? 20 : 12),
    memory_files: memoryFiles.filter(matchesAsset).slice(0, preferredAsset ? 20 : 12),
    project_rules: {
      complete: readiness.complete === true,
      profile: ".agent-context/profile.md",
      schema: ".agent-context/wiki/schema.md",
      extraction_skill: ".agent-context/skills/project-extraction/SKILL.md",
      workflow_skill: ".agent-context/skills/project-workflow/SKILL.md",
      missing: readiness.missing ?? [],
      recommendation: readiness.recommendation,
    },
    pending_proposals: pending.filter((proposal) => matchesAsset(proposal.asset)).slice(0, 12),
    accepted_proposals: accepted.filter((proposal) => matchesAsset(proposal.asset)).slice(0, 12),
    rejected_proposals: rejected.filter((proposal) => matchesAsset(proposal.asset)).slice(0, 12),
  };
}

async function wikiPageSummaries(root: string): Promise<Array<{ path: string; title?: string }>> {
  const files = await listMarkdownFiles(paths(root).wiki);
  const pages: Array<{ path: string; title?: string }> = [];
  for (const file of files) {
    const text = await readText(file);
    pages.push({ path: path.relative(root, file), title: text.match(/^#\s+(.+)$/m)?.[1] });
  }
  return pages;
}

function inferMode(inputs: WorkerInputSummary[]): WorkerMode {
  if (inputs.some((input) => input.kind === "proposal" && input.summary.toLowerCase().includes("rejected"))) return "improve";
  if (inputs.some((input) => input.kind === "episode" && input.summary.toLowerCase().includes("failed"))) return "improve";
  return "extract";
}

function inferBundleKind(inputs: WorkerInputSummary[]): ResourceBundle["kind"] {
  const kinds = new Set(inputs.map((input) => input.kind));
  if (kinds.size !== 1) return "mixed";
  const [kind] = Array.from(kinds);
  if (kind === "episode") return "episode";
  if (kind === "source") return "document";
  return "mixed";
}

function inferTargetAssets(inputs: WorkerInputSummary[], assetContext: AssetContextSummary, preferredAsset?: string): string[] {
  const assets = new Set<string>();
  if (preferredAsset) assets.add(preferredAsset);
  for (const input of inputs) {
    if (input.asset) assets.add(input.asset);
  }
  for (const proposal of [...assetContext.pending_proposals, ...assetContext.accepted_proposals]) {
    assets.add(proposal.asset);
  }
  if (assets.size === 0) {
    assets.add(".agent-context/wiki/workflows.md");
    assets.add(".agent-context/wiki/gotchas.md");
    assets.add(".agent-context/skills/");
  }
  return Array.from(assets).slice(0, 16);
}

function buildWorkerPacket(root: string, input: { bundle: ResourceBundle; job: WorkerJob; inputs: WorkerInputSummary[]; assetContext: AssetContextSummary; options: WorkerRunOptions }): string {
  const { bundle, job, inputs, assetContext, options } = input;
  return `# AgentMind Worker Packet: ${job.id}

- backend: skill_driven
- mode: ${job.mode}
- resource_bundle: ${bundle.id}
- bundle_kind: ${bundle.kind}
- root: ${root}

## How To Execute

Read \`.agent-context/skills/agentmind-worker/SKILL.md\` completely, then process this packet as a Worker ${job.mode} job.

The CLI has only prepared inputs and context. It has not launched an autonomous Agent and has not modified stable Wiki/Skill/Memory assets.

## Inputs

${inputs.length > 0 ? inputs.map(formatInput).join("\n") : "No native inputs were found. Treat this as a no-op unless the user provided extra context."}

## Target Assets

${job.target_assets.map((asset) => `- ${asset}`).join("\n")}

## Asset Context

### Wiki Pages
${assetContext.wiki_pages.length > 0 ? assetContext.wiki_pages.map((page) => `- ${page.path}${page.title ? `: ${page.title}` : ""}`).join("\n") : "- None"}

### Skills
${assetContext.skills.length > 0 ? assetContext.skills.map((skill) => `- ${skill.path}${skill.title ? `: ${skill.title}` : ""}`).join("\n") : "- None"}

### Memory
${assetContext.memory_files.map((file) => `- ${file}`).join("\n")}

### Project Rules
${formatProjectRules(assetContext.project_rules)}

### Pending Proposals
${formatProposalContext(assetContext.pending_proposals)}

### Accepted Proposals
${formatProposalContext(assetContext.accepted_proposals)}

### Rejected Proposals
${formatProposalContext(assetContext.rejected_proposals)}

## Required Output

- For durable project facts, decisions, architecture, workflows, or gotchas: create the smallest useful Wiki proposal.
- For repeatable future agent behavior: create or improve a canonical Skill proposal.
- For stable user/workspace preferences: create a Memory proposal.
- For duplicate, unsupported, one-off, or out-of-scope content: record a discard/no-op decision in your response.
- Do not auto-update Compiled Wiki; it is Not Now.
- Do not mark proposals applied unless target assets actually changed through review/apply.
- If Project Rules are incomplete, explain that Worker output is lower-confidence and ask whether Project Design should run before broad extraction.

## Suggested Commands

\`\`\`bash
agentmind review list --status all --root ${root}
agentmind review show <proposal-id> --root ${root}
\`\`\`

When you create a pending proposal manually, write it under \`.agent-context/proposals/pending/\` using the existing UpdateProposal shape.

## Invocation Hints

- requested_source: ${options.source ?? ""}
- requested_asset: ${options.asset ?? ""}
`;
}

function formatInput(input: WorkerInputSummary): string {
  return `- id: ${input.id}\n  kind: ${input.kind}\n  path: ${input.path ?? ""}\n  asset: ${input.asset ?? ""}\n  summary: ${input.summary}`;
}

function formatProposalContext(proposals: Array<{ id: string; asset: string; reason: string; risk: string }>): string {
  if (proposals.length === 0) return "- None";
  return proposals.map((proposal) => `- ${proposal.id} [${proposal.risk}] ${proposal.asset}: ${proposal.reason}`).join("\n");
}

function formatProjectRules(rules: AssetContextSummary["project_rules"]): string {
  const lines = [
    `- complete: ${rules.complete}`,
    `- profile: ${rules.profile}`,
    `- schema: ${rules.schema}`,
    `- extraction_skill: ${rules.extraction_skill}`,
    `- workflow_skill: ${rules.workflow_skill}`,
    rules.missing.length > 0 ? `- missing: ${rules.missing.join(", ")}` : "- missing: none",
    rules.recommendation ? `- recommendation: ${rules.recommendation}` : undefined,
  ];
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function summarizeRecord(kind: WorkerInputSummary["kind"], value: Record<string, unknown>): string {
  if (kind === "episode") {
    const outcome = stringValue(value.outcome) ?? "unknown";
    const goal = stringValue(value.goal) ?? "Untitled episode";
    const verification = isRecord(value.verification) ? stringValue(value.verification.summary) : undefined;
    return preview(`Episode ${outcome}: ${goal}${verification ? `. Verification: ${verification}` : ""}`);
  }
  if (kind === "handoff") {
    const handoff = value as unknown as Partial<WorkHandoff>;
    return preview(`Handoff ${handoff.status ?? "unknown"}: ${handoff.summary ?? ""}${handoff.next ? `. Next: ${handoff.next}` : ""}`);
  }
  if (kind === "checkpoint") {
    const checkpoint = value as unknown as Partial<WorkCheckpoint>;
    return preview(`Checkpoint: ${checkpoint.summary ?? ""}${checkpoint.next ? `. Next: ${checkpoint.next}` : ""}`);
  }
  return preview(JSON.stringify(value));
}

function summarizeSource(source: SourceRecord): WorkerInputSummary {
  return {
    id: source.id,
    kind: "source",
    path: source.snapshot_path ?? source.source.path,
    summary: preview(`Source ${source.kind}/${source.content_type}: ${source.title}. ${source.reason ?? ""}`),
    created_at: source.created_at,
  };
}

function summarizeProposal(proposal: UpdateProposal): WorkerInputSummary {
  return {
    id: proposal.id,
    kind: "proposal",
    path: `.agent-context/proposals/${proposal.status === "pending_review" ? "pending" : proposal.status}/${proposal.id}.json`,
    asset: proposal.asset,
    summary: preview(`Proposal ${proposal.status} ${proposal.operation} ${proposal.asset}: ${proposal.reason}. ${proposal.patch ?? ""}`),
    created_at: proposal.created_at,
  };
}

function summarizeInputs(inputs: WorkerInputSummary[]): string {
  if (inputs.length === 0) return "No AgentMind native inputs found.";
  const counts = inputs.reduce<Record<string, number>>((accumulator, input) => {
    accumulator[input.kind] = (accumulator[input.kind] ?? 0) + 1;
    return accumulator;
  }, {});
  return Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(", ");
}

function modeReason(mode: WorkerMode, inputs: WorkerInputSummary[], options: WorkerRunOptions): string {
  if (options.mode) return "Mode was explicitly requested.";
  if (mode === "improve") return "Inputs include rejected proposals or failed episodes that imply asset iteration.";
  return "Inputs primarily look like new episodes, handoffs, sources, or pending extraction suggestions.";
}

function inferKindFromPath(file: string): WorkerInputSummary["kind"] {
  if (file.includes(`${path.sep}episodes${path.sep}`)) return "episode";
  if (file.includes(`${path.sep}handoffs${path.sep}`)) return "handoff";
  if (file.includes(`${path.sep}checkpoints${path.sep}`)) return "checkpoint";
  if (file.includes(`${path.sep}proposals${path.sep}`)) return "proposal";
  return "source";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function preview(text: string, length = 320): string {
  return text.replace(/\s+/g, " ").trim().slice(0, length);
}

async function writePacketMarkdown(filePath: string, content: string): Promise<void> {
  await overwriteText(filePath, content);
}
