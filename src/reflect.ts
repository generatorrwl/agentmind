import { latestEpisode, latestReward, writeProposal } from "./store.js";
import { nowIso, stableId } from "./utils.js";
import { UpdateProposal } from "./types.js";

export async function reflectLatest(root: string): Promise<UpdateProposal | null> {
  const episode = await latestEpisode(root);
  const reward = await latestReward(root);
  if (!episode && !reward) return null;

  const evidence = [episode?.id, reward?.id].filter((item): item is string => Boolean(item));
  const negative = reward?.polarity === "negative" || episode?.outcome === "failed";
  const target = negative ? "wiki/gotchas.md" : "wiki/workflows.md";
  const reason = negative
    ? "Latest episode or reward indicates a failure/correction that may need a gotcha, memory update, or skill patch."
    : "Latest episode or reward may contain a reusable successful workflow worth documenting.";

  const now = nowIso();
  const proposal: UpdateProposal = {
    id: stableId("proposal", `${reason}:${evidence.join(":")}:${now}`),
    asset: `.agent-context/${target}`,
    operation: "update",
    reason,
    evidence,
    risk: negative ? "medium" : "low",
    status: "pending_review",
    patch: buildPatch(episode?.goal, reward?.evidence ?? [], negative),
    created_at: now,
  };
  return writeProposal(root, proposal);
}

function buildPatch(goal: string | undefined, evidence: string[], negative: boolean): string {
  const lines = [
    negative ? "Add a gotcha or patch a skill based on this signal:" : "Consider documenting this reusable workflow:",
    goal ? `- Episode goal: ${goal}` : undefined,
    ...evidence.map((item) => `- Evidence: ${item}`),
  ].filter((item): item is string => Boolean(item));
  return lines.join("\n");
}

