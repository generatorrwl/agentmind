import path from "node:path";
import { UpdateProposal } from "./types.js";
import { listJsonFiles, paths } from "./store.js";
import { moveFile, nowIso, readJson, writeJson } from "./utils.js";

export type ProposalBucket = "pending" | "accepted" | "rejected" | "applied";

export interface ProposalSummary {
  id: string;
  asset: string;
  operation: UpdateProposal["operation"];
  risk: UpdateProposal["risk"];
  status: UpdateProposal["status"];
  reason: string;
  evidence_count: number;
  patch_preview?: string;
  created_at: string;
}

export async function listPendingProposals(root: string): Promise<UpdateProposal[]> {
  return listProposals(root, "pending");
}

export async function listProposals(root: string, bucket: ProposalBucket = "pending"): Promise<UpdateProposal[]> {
  const files = await listJsonFiles(bucketDir(root, bucket));
  const proposals: UpdateProposal[] = [];
  for (const file of files) {
    const proposal = await readJson<UpdateProposal | null>(file, null);
    if (proposal) proposals.push(proposal);
  }
  return proposals;
}

export async function summarizeProposals(root: string, bucket: ProposalBucket = "pending"): Promise<ProposalSummary[]> {
  return (await listProposals(root, bucket)).map((proposal) => ({
    id: proposal.id,
    asset: proposal.asset,
    operation: proposal.operation,
    risk: proposal.risk,
    status: proposal.status,
    reason: proposal.reason,
    evidence_count: proposal.evidence.length,
    patch_preview: proposal.patch ? preview(proposal.patch) : undefined,
    created_at: proposal.created_at,
  }));
}

export async function findProposal(root: string, id: string, preferredBucket?: ProposalBucket): Promise<{ proposal: UpdateProposal; bucket: ProposalBucket; file: string }> {
  const buckets: ProposalBucket[] = preferredBucket ? [preferredBucket] : ["pending", "accepted", "rejected", "applied"];
  for (const bucket of buckets) {
    const file = path.join(bucketDir(root, bucket), `${id}.json`);
    const proposal = await readJson<UpdateProposal | null>(file, null);
    if (proposal) return { proposal, bucket, file };
  }
  throw new Error(`Proposal not found: ${id}`);
}

export async function reviewProposal(root: string, id: string, status: "accepted" | "rejected", reason?: string): Promise<UpdateProposal> {
  const p = paths(root);
  const from = path.join(p.proposalsPending, `${id}.json`);
  const toDir = status === "accepted" ? p.proposalsAccepted : p.proposalsRejected;
  const proposal = await readJson<UpdateProposal | null>(from, null);
  if (!proposal) throw new Error(`Pending proposal not found: ${id}`);
  proposal.status = status;
  proposal.review = { decision: status, reason, reviewed_at: nowIso() };
  await writeJson(from, proposal);
  await moveFile(from, path.join(toDir, `${id}.json`));
  return proposal;
}

export async function moveProposal(root: string, id: string, status: "accepted" | "rejected"): Promise<void> {
  await reviewProposal(root, id, status);
}

export interface ApplyPlan {
  id: string;
  asset: string;
  operation: UpdateProposal["operation"];
  risk: UpdateProposal["risk"];
  status: UpdateProposal["status"];
  can_auto_apply: false;
  reason: string;
  instructions: string[];
  patch?: string;
}

export async function buildApplyPlan(root: string, id: string): Promise<ApplyPlan> {
  const { proposal } = await findProposal(root, id, "accepted");
  return {
    id: proposal.id,
    asset: proposal.asset,
    operation: proposal.operation,
    risk: proposal.risk,
    status: proposal.status,
    can_auto_apply: false,
    reason: "This proposal patch is a natural-language maintenance instruction. Apply it with the worker/review skill, then mark it applied.",
    instructions: [
      `Open target asset: ${proposal.asset}`,
      "Read proposal evidence and patch text.",
      "Make the smallest stable wiki/skill/memory update justified by the evidence.",
      "Preserve source/provenance references in the target asset where possible.",
      `After editing, run: agentmind review apply ${proposal.id} --mark-applied --root <workspace>`,
    ],
    patch: proposal.patch,
  };
}

export async function markProposalApplied(root: string, id: string, reason?: string): Promise<UpdateProposal> {
  const p = paths(root);
  const from = path.join(p.proposalsAccepted, `${id}.json`);
  const proposal = await readJson<UpdateProposal | null>(from, null);
  if (!proposal) throw new Error(`Accepted proposal not found: ${id}`);
  proposal.status = "applied";
  proposal.application = { mode: "manual", reason, applied_at: nowIso() };
  await writeJson(from, proposal);
  await moveFile(from, path.join(p.proposalsApplied, `${id}.json`));
  return proposal;
}

function bucketDir(root: string, bucket: ProposalBucket): string {
  const p = paths(root);
  if (bucket === "pending") return p.proposalsPending;
  if (bucket === "accepted") return p.proposalsAccepted;
  if (bucket === "rejected") return p.proposalsRejected;
  return p.proposalsApplied;
}

function preview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}
