import path from "node:path";
import { ProjectDesignMode, ProjectDesignRecord, UpdateProposal } from "./types.js";
import { paths, projectDesignReadiness, writeProposal } from "./store.js";
import { listScans } from "./scan.js";
import { listSources } from "./sources.js";
import { ensureDir, nowIso, readJson, readText, stableId, writeJson } from "./utils.js";
import { overwriteText } from "./store.js";

interface ProjectDesignIndex { designs: ProjectDesignRecord[] }

export interface ProjectDesignResult {
  design: ProjectDesignRecord;
  packet: string;
  next: string[];
}

export async function createProjectDesign(root: string, input: { mode?: ProjectDesignMode; fromScan?: string; fromSource?: string } = {}): Promise<ProjectDesignResult> {
  const now = nowIso();
  const mode = input.mode ?? "new";
  const sourceKey = [mode, input.fromScan, input.fromSource, now].filter(Boolean).join(":");
  const id = stableId("project_design", sourceKey);
  const designDir = path.join(paths(root).projectDesign, id);
  await ensureDir(designDir);

  const files = {
    packet: path.relative(root, path.join(designDir, "PACKET.md")),
    plan: path.relative(root, path.join(designDir, "PLAN.md")),
    workspace_sources: path.relative(root, path.join(designDir, "workspace-sources.json")),
    research_notes: path.relative(root, path.join(designDir, "research-notes.md")),
    user_decisions: path.relative(root, path.join(designDir, "user-decisions.md")),
    profile_candidates: path.relative(root, path.join(designDir, "profile-candidates.md")),
    schema_candidates: path.relative(root, path.join(designDir, "schema-candidates.md")),
    skill_candidates: path.relative(root, path.join(designDir, "skill-candidates.md")),
    migration_preview: path.relative(root, path.join(designDir, "migration-preview.md")),
    output_contract: path.relative(root, path.join(designDir, "output-contract.md")),
    design_log: path.relative(root, path.join(designDir, "design-log.md")),
  };
  const design: ProjectDesignRecord = {
    id,
    mode,
    status: "asking_user",
    root,
    from_scan: input.fromScan,
    from_source: input.fromSource,
    files,
    proposals: [],
    created_at: now,
    updated_at: now,
  };

  const context = await buildDesignContext(root, input);
  await overwriteText(path.join(root, files.packet), buildPacket(root, design, context));
  await overwriteText(path.join(root, files.plan), buildPlan(design));
  await writeJson(path.join(root, files.workspace_sources), context);
  await overwriteText(path.join(root, files.research_notes), buildResearchNotes(design));
  await overwriteText(path.join(root, files.user_decisions), buildUserDecisions());
  await overwriteText(path.join(root, files.profile_candidates), buildProfileCandidates());
  await overwriteText(path.join(root, files.schema_candidates), buildSchemaCandidates());
  await overwriteText(path.join(root, files.skill_candidates), buildSkillCandidates());
  await overwriteText(path.join(root, files.migration_preview), buildMigrationPreview());
  await overwriteText(path.join(root, files.output_contract), buildOutputContract());
  await overwriteText(path.join(root, files.design_log), `# Design Log\n\n- ${now}: Created Project Design packet ${id}.\n`);
  await writeJson(path.join(designDir, "design.json"), design);
  await upsertDesign(root, design);

  return {
    design,
    packet: files.packet,
    next: [
      `Read ${files.packet}.`,
      "Use `.agent-context/skills/agentmind-extraction/SKILL.md` PROJECT DESIGN flow.",
      "Ask the user the required discovery questions before finalizing candidates.",
      "Do not write stable profile/schema/project skills until user confirmation.",
    ],
  };
}

export async function listProjectDesigns(root: string): Promise<ProjectDesignRecord[]> {
  return (await readDesignIndex(root)).designs;
}

export async function getProjectDesign(root: string, id: string): Promise<ProjectDesignRecord> {
  const design = (await listProjectDesigns(root)).find((item) => item.id === id);
  if (!design) throw new Error(`Unknown project design: ${id}`);
  return design;
}

export async function proposeProjectDesign(root: string, id: string): Promise<{ design: ProjectDesignRecord; proposals: UpdateProposal[]; warning?: string }> {
  const design = await getProjectDesign(root, id);
  if (design.proposals.length > 0) {
    return {
      design,
      proposals: [],
      warning: "Project Design already has proposal ids recorded. Review existing proposals instead of generating duplicates.",
    };
  }
  const decisions = await readText(path.join(root, design.files.user_decisions));
  if (!hasUserConfirmation(decisions)) {
    return {
      design,
      proposals: [],
      warning: "Project Design is not user-confirmed. Add an explicit confirmation line in user-decisions.md before creating stable asset proposals.",
    };
  }

  const now = nowIso();
  const evidence = [design.id, design.files.user_decisions, design.files.profile_candidates, design.files.schema_candidates, design.files.skill_candidates];
  const proposals = await Promise.all([
    writeProposal(root, buildDesignProposal(design, now, ".agent-context/profile.md", "create", "Create confirmed Project Profile from Project Design.", evidence, profileProposalPatch(design))),
    writeProposal(root, buildDesignProposal(design, now, ".agent-context/wiki/schema.md", "create", "Create confirmed project Wiki schema from Project Design.", evidence, schemaProposalPatch(design))),
    writeProposal(root, buildDesignProposal(design, now, ".agent-context/skills/project-extraction/SKILL.md", "create", "Create confirmed project-specific extraction skill from Project Design.", evidence, extractionSkillProposalPatch(design))),
    writeProposal(root, buildDesignProposal(design, now, ".agent-context/skills/project-workflow/SKILL.md", "create", "Create confirmed project-specific workflow skill from Project Design.", evidence, workflowSkillProposalPatch(design))),
  ]);
  const updated: ProjectDesignRecord = { ...design, status: "complete", proposals: proposals.map((proposal) => proposal.id), updated_at: now };
  await writeJson(path.join(paths(root).projectDesign, id, "design.json"), updated);
  await upsertDesign(root, updated);
  return { design: updated, proposals };
}

async function buildDesignContext(root: string, input: { fromScan?: string; fromSource?: string }): Promise<Record<string, unknown>> {
  const scans = await listScans(root);
  const sources = await listSources(root);
  return {
    project_design_readiness: await projectDesignReadiness(root),
    selected_scan: input.fromScan ? scans.find((scan) => scan.id === input.fromScan) ?? null : null,
    selected_source: input.fromSource ? sources.find((source) => source.id === input.fromSource) ?? null : null,
    scans: scans.map((scan) => ({ id: scan.id, goal: scan.goal, status: scan.status, sources: scan.sources.map((source) => source.path) })),
    sources: sources.map((source) => ({ id: source.id, kind: source.kind, title: source.title, snapshot_path: source.snapshot_path, reason: source.reason })),
    suggested_workspace_sources: [
      "README.md",
      "PRODUCT_PRD.zh-CN.md",
      "EXTRACTION_PRD.zh-CN.md",
      "AGENTMIND_WORKER_PRD.zh-CN.md",
      "package.json",
      "src/",
      ".agent-context/wiki/",
      ".agent-context/skills/",
      ".agent-context/proposals/pending/",
    ],
  };
}

function buildPacket(root: string, design: ProjectDesignRecord, context: Record<string, unknown>): string {
  return `# AgentMind Project Design Packet: ${design.id}

- mode: ${design.mode}
- status: ${design.status}
- root: ${root}
- from_scan: ${design.from_scan ?? ""}
- from_source: ${design.from_source ?? ""}

## Purpose

Design high-impact project knowledge assets through a discussion-first flow:

- .agent-context/profile.md
- .agent-context/wiki/schema.md
- .agent-context/skills/project-extraction/SKILL.md
- .agent-context/skills/project-workflow/SKILL.md

The CLI has created a packet only. It has not finalized schema, enabled project skills, or modified stable high-impact assets.

## Required Skill Order

1. Read .agent-context/skills/agentmind-extraction/SKILL.md.
2. Follow PROJECT DESIGN flow.
3. Ask the user the discovery questions before finalizing candidates.
4. Use workspace sources and research notes to draft candidates.
5. Generate proposals only after user confirmation.

## Required User Questions

- Is this repo primarily product, agent-tooling, library, research, course, infra, or mixed?
- Should the Wiki primarily serve implementation, product decisions, research notes, user docs, or operations?
- Do you have an existing schema, taxonomy, reference project, or team convention?
- Which content is Not Now and should not enter durable assets?
- Should project-extraction and project-workflow be separate skills for this project?

## Packet Files

- Plan: ${design.files.plan}
- Workspace sources: ${design.files.workspace_sources}
- Research notes: ${design.files.research_notes}
- User decisions: ${design.files.user_decisions}
- Profile candidates: ${design.files.profile_candidates}
- Schema candidates: ${design.files.schema_candidates}
- Skill candidates: ${design.files.skill_candidates}
- Migration preview: ${design.files.migration_preview}
- Output contract: ${design.files.output_contract}
- Design log: ${design.files.design_log}

## Current Context

\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

## Boundaries

- Do not write stable profile/schema/project skills without explicit user confirmation.
- Do not use Memory as the generator for schema or project skills.
- Do not treat generic templates as final project rules.
- Produce candidates and proposals; review/apply remains separate.
`;
}

function buildPlan(design: ProjectDesignRecord): string {
  return `# Project Design Plan: ${design.id}

Status: asking_user

## Steps

- [ ] Ask required user discovery questions.
- [ ] Read workspace sources listed in workspace-sources.json.
- [ ] Add workspace and optional external research notes.
- [ ] Draft 2-3 profile candidates.
- [ ] Draft 2-3 wiki schema candidates.
- [ ] Draft project-extraction and project-workflow skill candidates.
- [ ] Write migration preview for existing wiki/skills/proposals.
- [ ] Record user decisions and unresolved questions.
- [ ] After explicit user confirmation, run project design propose.
`;
}

function buildResearchNotes(design: ProjectDesignRecord): string {
  return `# Research Notes: ${design.id}

## Workspace Reading

- [ ] README / package manifest
- [ ] Product and extraction PRDs
- [ ] Source layout
- [ ] Existing AgentMind wiki and skills
- [ ] Pending proposals

## External Research

Record comparable wiki/schema/runbook/skill patterns only when useful and allowed.
`;
}

function buildUserDecisions(): string {
  return `# User Decisions

Record explicit user choices here. Do not create stable profile/schema/project skill proposals until this file contains an explicit confirmation.

## Required Confirmation

- confirmed_for_proposal: no
- confirmed_by:
- confirmed_at:

## Decisions

- Project type:
- Wiki primary purpose:
- Preferred schema candidate:
- Project extraction/workflow split:
- Not Now:
- Open questions:
`;
}

function buildProfileCandidates(): string {
  return `# Profile Candidates

Draft 2-3 project profile options here after user discussion and workspace reading.

Each candidate must include project_type, stage, source_priority, Not Now, schema path, extraction skill path, workflow skill path, tradeoffs, and risks.
`;
}

function buildSchemaCandidates(): string {
  return `# Schema Candidates

Draft 2-3 wiki schema options here.

Each candidate must include directory layout, page types, frontmatter fields, source classes, citation/confidence rules, index/log rules, and migration impact.
`;
}

function buildSkillCandidates(): string {
  return `# Skill Candidates

Draft project-specific skills here.

## project-extraction

Include trigger conditions, durable knowledge definition, source priority, output contract, discard rules, validation, and evidence requirements.

## project-workflow

Include trigger conditions, day-to-day workflow, commands, verification, handoff/checkpoint rules, and failure handling.
`;
}

function buildMigrationPreview(): string {
  return `# Migration Preview

Describe how existing wiki pages, skills, proposals, and worker packets would change if a candidate is accepted.

- Existing wiki pages affected:
- Existing skills affected:
- Pending proposals affected:
- Risks:
- Rollback plan:
`;
}

function buildOutputContract(): string {
  return `# Output Contract

Before user confirmation, outputs are candidates only:

- profile-candidates.md
- schema-candidates.md
- skill-candidates.md
- migration-preview.md
- user-decisions.md

After user confirmation, project design propose may create pending proposals for:

- .agent-context/profile.md
- .agent-context/wiki/schema.md
- .agent-context/skills/project-extraction/SKILL.md
- .agent-context/skills/project-workflow/SKILL.md

Accept is not apply. Stable assets are changed only through review/apply or explicit user instruction.
`;
}

function hasUserConfirmation(text: string): boolean {
  return /^\s*-?\s*confirmed_for_proposal:\s*(yes|true)\s*$/im.test(text);
}

function buildDesignProposal(design: ProjectDesignRecord, now: string, asset: string, operation: UpdateProposal["operation"], reason: string, evidence: string[], patch: string): UpdateProposal {
  return {
    id: stableId("proposal", `${design.id}:${asset}:${now}`),
    asset,
    operation,
    reason,
    evidence,
    risk: "high",
    status: "pending_review",
    patch,
    created_at: now,
  };
}

function profileProposalPatch(design: ProjectDesignRecord): string {
  return `Use ${design.files.profile_candidates} and ${design.files.user_decisions} to create .agent-context/profile.md. Preserve confirmed project type, stage, schema path, project skill paths, source priority, Not Now, and open questions.`;
}

function schemaProposalPatch(design: ProjectDesignRecord): string {
  return `Use ${design.files.schema_candidates} and ${design.files.user_decisions} to create .agent-context/wiki/schema.md. Include directory layout, page types, frontmatter, source classes, citation/confidence rules, index/log rules, and migration notes.`;
}

function extractionSkillProposalPatch(design: ProjectDesignRecord): string {
  return `Use ${design.files.skill_candidates} and ${design.files.user_decisions} to create .agent-context/skills/project-extraction/SKILL.md. The skill must define project-specific extraction rules and must not override AgentMind core review/apply safety.`;
}

function workflowSkillProposalPatch(design: ProjectDesignRecord): string {
  return `Use ${design.files.skill_candidates} and ${design.files.user_decisions} to create .agent-context/skills/project-workflow/SKILL.md. The skill must define project-specific day-to-day workflow, verification, and handoff rules.`;
}

async function readDesignIndex(root: string): Promise<ProjectDesignIndex> {
  return readJson(paths(root).projectDesignIndex, { designs: [] });
}

async function upsertDesign(root: string, design: ProjectDesignRecord): Promise<void> {
  const file = await readDesignIndex(root);
  const designs = [...file.designs.filter((item) => item.id !== design.id), design]
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  await writeJson(paths(root).projectDesignIndex, { designs });
}
