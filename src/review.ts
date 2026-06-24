import path from "node:path";
import { UpdateProposal } from "./types.js";
import { listJsonFiles, paths } from "./store.js";
import { moveFile, readJson } from "./utils.js";

export async function listPendingProposals(root: string): Promise<UpdateProposal[]> {
  const files = await listJsonFiles(paths(root).proposalsPending);
  const proposals: UpdateProposal[] = [];
  for (const file of files) {
    const proposal = await readJson<UpdateProposal | null>(file, null);
    if (proposal) proposals.push(proposal);
  }
  return proposals;
}

export async function moveProposal(root: string, id: string, status: "accepted" | "rejected"): Promise<void> {
  const p = paths(root);
  const from = path.join(p.proposalsPending, `${id}.json`);
  const toDir = status === "accepted" ? p.proposalsAccepted : p.proposalsRejected;
  const proposal = await readJson<UpdateProposal | null>(from, null);
  if (!proposal) throw new Error(`Pending proposal not found: ${id}`);
  proposal.status = status;
  await import("./utils.js").then(({ writeJson }) => writeJson(from, proposal));
  await moveFile(from, path.join(toDir, `${id}.json`));
}

