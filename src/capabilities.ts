import { cp, readFile } from "node:fs/promises";
import path from "node:path";
import { CapabilityRecord } from "./types.js";
import { ensureDir, nowIso, pathKind, slugify, stableId } from "./utils.js";
import { paths, readCapabilityRegistry, writeCapabilityRegistry, writeProposal } from "./store.js";

export async function importLocalSkill(root: string, sourcePath: string): Promise<{ capability: CapabilityRecord; installedPath: string }> {
  const absoluteSource = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(process.cwd(), sourcePath);
  const kind = await pathKind(absoluteSource);
  if (kind === "missing") throw new Error(`Skill source does not exist: ${sourcePath}`);

  const baseName = kind === "directory" ? path.basename(absoluteSource) : path.basename(absoluteSource, path.extname(absoluteSource));
  const skillId = slugify(baseName);
  const destinationDir = path.join(paths(root).skills, skillId);
  await ensureDir(destinationDir);

  if (kind === "directory") {
    await cp(absoluteSource, destinationDir, { recursive: true, force: true });
  } else {
    const content = await readFile(absoluteSource, "utf8");
    await ensureDir(destinationDir);
    await import("node:fs/promises").then(({ writeFile }) => writeFile(path.join(destinationDir, "SKILL.md"), content, "utf8"));
  }

  const registry = await readCapabilityRegistry(root);
  const now = nowIso();
  const capability: CapabilityRecord = {
    id: stableId("cap", absoluteSource),
    type: "skill",
    source: { kind: "local", path: absoluteSource },
    description: `Imported local skill from ${absoluteSource}`,
    permissions: { network: false, filesystem: false, secrets: [] },
    risk: "low",
    status: "installed",
    project_fit: { score: 0.5, reasons: ["Imported manually by user."] },
    adapters: { codex: "available", "claude-code": "available" },
    created_at: now,
    updated_at: now,
  };
  const others = registry.capabilities.filter((item) => item.id !== capability.id);
  await writeCapabilityRegistry(root, [...others, capability]);

  await writeProposal(root, {
    id: stableId("proposal", `${capability.id}:${now}`),
    asset: path.relative(root, path.join(destinationDir, "SKILL.md")),
    operation: "update",
    reason: "Imported external skill should be reviewed and adapted to this project before promotion.",
    evidence: [capability.id],
    risk: "low",
    status: "pending_review",
    patch: "Review this imported skill for project-specific commands, validation steps, and safety constraints.",
    created_at: now,
  });

  return { capability, installedPath: path.relative(root, destinationDir) };
}
