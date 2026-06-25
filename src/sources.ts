import { copyFile } from "node:fs/promises";
import path from "node:path";
import { SourceRecord, UpdateProposal } from "./types.js";
import { paths, writeProposal } from "./store.js";
import { ensureDir, nowIso, pathKind, readJson, slugify, stableId, writeJson } from "./utils.js";
import { overwriteText } from "./store.js";

interface SourceIndexFile { sources: SourceRecord[] }

export async function addReference(root: string, target: string, input: { title?: string; reason?: string; tags?: string[] } = {}): Promise<{ source: SourceRecord; proposal: UpdateProposal }> {
  const isUrl = isUrlLike(target);
  const now = nowIso();
  const title = input.title ?? inferTitle(target);
  const id = stableId("source", `reference:${target}`);
  const sourceDir = paths(root).sourcesExternal;
  await ensureDir(sourceDir);

  const contentType = isUrl ? "url" : await sourcePathContentType(root, target);
  const snapshotPath = isUrl
    ? await writeUrlReferenceSnapshot(root, sourceDir, id, target, title, input.reason)
    : contentType === "file"
      ? await copySourceFile(root, sourceDir, id, target)
      : undefined;

  const existing = await findSource(root, id);
  const source: SourceRecord = {
    id,
    kind: "reference",
    content_type: contentType,
    title,
    source: isUrl
      ? { url: target }
      : { path: normalizeWorkspacePath(root, target), original_path: resolveSourcePath(root, target) },
    snapshot_path: snapshotPath,
    reason: input.reason,
    tags: input.tags ?? existing?.tags ?? [],
    status: "queued_for_extraction",
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await upsertSource(root, source);
  const proposal = await writeExtractionProposal(root, source, "External reference may contain durable project knowledge or capability guidance.");
  return { source, proposal };
}

export async function importHistory(root: string, target: string, input: { title?: string; reason?: string; tags?: string[] } = {}): Promise<{ source: SourceRecord; proposal: UpdateProposal }> {
  const kind = await pathKind(resolveSourcePath(root, target));
  if (kind !== "file") throw new Error(`History import expects a local file: ${target}`);

  const now = nowIso();
  const id = stableId("source", `history:${resolveSourcePath(root, target)}`);
  const sourceDir = paths(root).sourcesHistory;
  await ensureDir(sourceDir);
  const snapshotPath = await copySourceFile(root, sourceDir, id, target);
  const existing = await findSource(root, id);
  const source: SourceRecord = {
    id,
    kind: "history",
    content_type: "file",
    title: input.title ?? inferTitle(target),
    source: { path: normalizeWorkspacePath(root, target), original_path: resolveSourcePath(root, target) },
    snapshot_path: snapshotPath,
    reason: input.reason ?? "Imported past conversation or transcript for backfill extraction.",
    tags: input.tags ?? existing?.tags ?? ["history"],
    status: "queued_for_extraction",
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await upsertSource(root, source);
  const proposal = await writeExtractionProposal(root, source, "Past conversation may contain durable wiki facts, memory preferences, or reusable skills.");
  return { source, proposal };
}

export async function listSources(root: string): Promise<SourceRecord[]> {
  return (await readSourceIndex(root)).sources;
}

export async function writeExtractionProposal(root: string, source: SourceRecord, reason: string): Promise<UpdateProposal> {
  const now = nowIso();
  return writeProposal(root, {
    id: stableId("proposal", `${source.id}:extract:${now}`),
    asset: ".agent-context/wiki/index.md",
    operation: "update",
    reason,
    evidence: [source.id, source.snapshot_path, source.source.path, source.source.url].filter((item): item is string => Boolean(item)),
    risk: source.kind === "history" ? "medium" : "low",
    status: "pending_review",
    patch: extractionPatch(source),
    created_at: now,
  });
}

async function readSourceIndex(root: string): Promise<SourceIndexFile> {
  return readJson(paths(root).sourceIndex, { sources: [] });
}

async function upsertSource(root: string, source: SourceRecord): Promise<void> {
  const file = await readSourceIndex(root);
  const sources = [...file.sources.filter((item) => item.id !== source.id), source]
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  await writeJson(paths(root).sourceIndex, { sources });
}

async function findSource(root: string, id: string): Promise<SourceRecord | undefined> {
  return (await readSourceIndex(root)).sources.find((source) => source.id === id);
}

async function writeUrlReferenceSnapshot(root: string, sourceDir: string, id: string, url: string, title: string, reason?: string): Promise<string> {
  const filePath = path.join(sourceDir, `${id}-${slugify(title)}.md`);
  const content = `# ${title}\n\n- url: ${url}\n- captured_at: ${nowIso()}\n- reason: ${reason ?? ""}\n\n## Extraction Notes\n\nThis URL was registered as an AgentMind reference. The current local CLI does not fetch network content automatically. An agent should read the reference when network/browser access is available, then promote durable facts into wiki, memory, or skills with citations.\n`;
  await overwriteText(filePath, content);
  return path.relative(root, filePath);
}

async function copySourceFile(root: string, sourceDir: string, id: string, target: string): Promise<string> {
  const absolute = resolveSourcePath(root, target);
  const fileName = `${id}-${path.basename(target)}`;
  const destination = path.join(sourceDir, fileName);
  await ensureDir(path.dirname(destination));
  await copyFile(absolute, destination);
  return path.relative(root, destination);
}

async function sourcePathContentType(root: string, target: string): Promise<"file" | "directory"> {
  const kind = await pathKind(resolveSourcePath(root, target));
  if (kind === "missing") throw new Error(`Reference path does not exist: ${target}`);
  if (kind === "file" || kind === "directory") return kind;
  throw new Error(`Unsupported reference path: ${target}`);
}

function isUrlLike(target: string): boolean {
  try {
    const parsed = new URL(target);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function inferTitle(target: string): string {
  if (isUrlLike(target)) {
    const parsed = new URL(target);
    return parsed.hostname + parsed.pathname.replace(/\/$/, "");
  }
  return path.basename(target) || "Reference";
}

function normalizeWorkspacePath(root: string, target: string): string {
  const absolute = resolveSourcePath(root, target);
  const relative = path.relative(root, absolute);
  return relative.startsWith("..") ? absolute : relative;
}

function resolveSourcePath(root: string, target: string): string {
  return path.isAbsolute(target) ? target : path.resolve(root, target);
}

function extractionPatch(source: SourceRecord): string {
  return [
    `Source: ${source.title}`,
    `Kind: ${source.kind}`,
    source.source.url ? `URL: ${source.source.url}` : undefined,
    source.source.path ? `Path: ${source.source.path}` : undefined,
    source.snapshot_path ? `Snapshot: ${source.snapshot_path}` : undefined,
    source.reason ? `Reason: ${source.reason}` : undefined,
    "",
    "Agent extraction task:",
    "- Identify stable project facts that should update `.agent-context/wiki/`.",
    "- Identify repeatable procedures that should become or update `.agent-context/skills/<skill-id>/SKILL.md`.",
    "- Identify durable user/project preferences that should update `.agent-context/memory/`.",
    "- Preserve source citations and confidence. Do not promote volatile or unverified claims as fixed knowledge.",
  ].filter((line): line is string => line !== undefined).join("\n");
}
