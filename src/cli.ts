import path from "node:path";
import { connectHarness } from "./adapters.js";
import { discoverClaudeSkills, importLocalSkill, listCapabilities, promoteSkill, renderProjectSkills } from "./capabilities.js";
import { startMcpServer } from "./mcp.js";
import { createProjectDesign, getProjectDesign, listProjectDesigns, proposeProjectDesign } from "./project-design.js";
import { reflectLatest } from "./reflect.js";
import { buildApplyPlan, findProposal, markProposalApplied, ProposalBucket, reviewProposal, summarizeProposals } from "./review.js";
import { addScanSource, createScan, finishScan, listScans } from "./scan.js";
import { doctorWorkspace, setupWorkspace } from "./setup.js";
import { addReference, importHistory, listSources } from "./sources.js";
import { initStore, storeStatus, writeEpisode, writeReward } from "./store.js";
import { AgentHarness, ScanSource } from "./types.js";
import { onlineEnd, onlineStart, onlineStatus, specCreate, workAbandon, workAdd, workCheckpoint, workClaim, workFinish, workList, workPause } from "./work.js";
import { runWorkerOnce } from "./worker.js";

export async function runCli(argv: string[]): Promise<void> {
  const { args, root } = parseArgs(argv);
  const [command, subcommand] = args;
  const value = positionalArg(args, 2);

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "init") {
    const created = await initStore(root);
    console.log(`AgentMind initialized at ${path.join(root, ".agent-context")}`);
    if (created.length > 0) console.log(`Created:\n${created.map((item) => `- ${item}`).join("\n")}`);
    return;
  }

  if (command === "setup") {
    console.log(JSON.stringify(await setupWorkspace(root, { mode: parseSetupMode(readOption(args, "--mode")) }), null, 2));
    return;
  }

  if (command === "doctor") {
    console.log(JSON.stringify(await doctorWorkspace(root), null, 2));
    return;
  }

  if (command === "status") {
    console.log(JSON.stringify(await storeStatus(root), null, 2));
    return;
  }

  if (command === "online" && subcommand === "start") {
    console.log(JSON.stringify(await onlineStart(root, {
      harness: parseOptionalHarness(readOption(args, "--harness")),
      session: readOption(args, "--session"),
      focus: readOption(args, "--focus"),
      staleMinutes: parseOptionalNumber(readOption(args, "--stale-minutes")),
    }), null, 2));
    return;
  }

  if (command === "online" && subcommand === "status") {
    console.log(JSON.stringify(await onlineStatus(root, {
      currentSession: readOption(args, "--session"),
      staleMinutes: parseOptionalNumber(readOption(args, "--stale-minutes")),
    }), null, 2));
    return;
  }

  if (command === "online" && subcommand === "end") {
    const session = readOption(args, "--session") ?? value;
    if (!session) throw new Error("Usage: agentmind online end --session <id>");
    console.log(JSON.stringify(await onlineEnd(root, session), null, 2));
    return;
  }

  if (command === "work" && subcommand === "add") {
    const title = value ?? readOption(args, "--title");
    if (!title) throw new Error("Usage: agentmind work add <title>");
    console.log(JSON.stringify(await workAdd(root, {
      title,
      priority: parsePriority(readOption(args, "--priority")),
      goal: readOption(args, "--goal"),
      next: readOption(args, "--next"),
    }), null, 2));
    return;
  }

  if (command === "work" && subcommand === "list") {
    console.log(JSON.stringify(await workList(root, parseWorkStatus(readOption(args, "--status"))), null, 2));
    return;
  }

  if (command === "work" && subcommand === "claim") {
    if (!value) throw new Error("Usage: agentmind work claim <id> --session <id>");
    const session = readOption(args, "--session");
    if (!session) throw new Error("work claim requires --session <id>");
    console.log(JSON.stringify(await workClaim(root, value, { session, scope: readRepeatedOptions(args, "--scope") }), null, 2));
    return;
  }

  if (command === "work" && subcommand === "checkpoint") {
    if (!value) throw new Error("Usage: agentmind work checkpoint <id> --summary <text>");
    const summary = readOption(args, "--summary");
    if (!summary) throw new Error("work checkpoint requires --summary <text>");
    console.log(JSON.stringify(await workCheckpoint(root, value, {
      session: readOption(args, "--session"),
      summary,
      next: readOption(args, "--next"),
      blockers: readRepeatedOptions(args, "--blocker"),
      changedFiles: readRepeatedOptions(args, "--file"),
      verification: readRepeatedOptions(args, "--verification"),
    }), null, 2));
    return;
  }

  if (command === "work" && (subcommand === "pause" || subcommand === "finish" || subcommand === "abandon")) {
    if (!value) throw new Error(`Usage: agentmind work ${subcommand} <id>`);
    const input = { session: readOption(args, "--session"), summary: readOption(args, "--summary"), next: readOption(args, "--next") };
    const result = subcommand === "pause"
      ? await workPause(root, value, input)
      : subcommand === "finish"
        ? await workFinish(root, value, input)
        : await workAbandon(root, value, input);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "spec" && subcommand === "create") {
    const title = value ?? readOption(args, "--title");
    if (!title) throw new Error("Usage: agentmind spec create <title>");
    console.log(JSON.stringify(await specCreate(root, { title, workId: readOption(args, "--work") }), null, 2));
    return;
  }

  if (command === "project" && subcommand === "design") {
    const action = positionalArg(args, 2);
    if (!action) {
      console.log(JSON.stringify(await createProjectDesign(root, {
        mode: parseProjectDesignMode(readOption(args, "--mode")),
        fromScan: readOption(args, "--from-scan"),
        fromSource: readOption(args, "--from-source"),
      }), null, 2));
      return;
    }
    if (action === "list") {
      console.log(JSON.stringify({ designs: await listProjectDesigns(root) }, null, 2));
      return;
    }
    if (action === "status") {
      const id = positionalArg(args, 3);
      if (!id) throw new Error("Usage: agentmind project design status <design-id>");
      console.log(JSON.stringify(await getProjectDesign(root, id), null, 2));
      return;
    }
    if (action === "propose") {
      const id = positionalArg(args, 3);
      if (!id) throw new Error("Usage: agentmind project design propose <design-id>");
      console.log(JSON.stringify(await proposeProjectDesign(root, id), null, 2));
      return;
    }
    throw new Error("Usage: agentmind project design [list|status <id>|propose <id>]");
  }

  if (command === "connect") {
    const harness = parseHarness(subcommand);
    const files = await connectHarness(root, harness);
    console.log(`Connected ${harness}. Updated:\n${files.map((item) => `- ${item}`).join("\n")}`);
    return;
  }

  if (command === "import" && subcommand === "skill") {
    if (!value) throw new Error("Usage: agentmind import skill <path>");
    const result = await importLocalSkill(root, value);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "skill" && subcommand === "list") {
    console.log(JSON.stringify({ capabilities: await listCapabilities(root) }, null, 2));
    return;
  }

  if (command === "skill" && subcommand === "discover") {
    const source = readOption(args, "--from") ?? value ?? "claude";
    if (source !== "claude" && source !== "claude-code") throw new Error("Usage: agentmind skill discover --from claude");
    console.log(JSON.stringify(await discoverClaudeSkills(root), null, 2));
    return;
  }

  if (command === "skill" && subcommand === "promote") {
    if (!value) throw new Error("Usage: agentmind skill promote <capability-id|skill-id>");
    console.log(JSON.stringify(await promoteSkill(root, value), null, 2));
    return;
  }

  if (command === "skill" && subcommand === "render") {
    console.log(JSON.stringify(await renderProjectSkills(root), null, 2));
    return;
  }

  if (command === "reference" && subcommand === "add") {
    if (!value) throw new Error("Usage: agentmind reference add <path-or-url> [--title <text>] [--reason <text>] [--tag <tag>]");
    console.log(JSON.stringify(await addReference(root, value, { title: readOption(args, "--title"), reason: readOption(args, "--reason"), tags: readRepeatedOptions(args, "--tag") }), null, 2));
    return;
  }

  if (command === "reference" && subcommand === "list") {
    console.log(JSON.stringify({ sources: (await listSources(root)).filter((source) => source.kind === "reference") }, null, 2));
    return;
  }

  if (command === "history" && subcommand === "import") {
    if (!value) throw new Error("Usage: agentmind history import <file> [--title <text>] [--reason <text>] [--tag <tag>]");
    console.log(JSON.stringify(await importHistory(root, value, { title: readOption(args, "--title"), reason: readOption(args, "--reason"), tags: readRepeatedOptions(args, "--tag") }), null, 2));
    return;
  }

  if (command === "history" && subcommand === "list") {
    console.log(JSON.stringify({ sources: (await listSources(root)).filter((source) => source.kind === "history") }, null, 2));
    return;
  }

  if (command === "sources" && subcommand === "list") {
    console.log(JSON.stringify({ sources: await listSources(root) }, null, 2));
    return;
  }

  if (command === "scan" && subcommand === "create") {
    console.log(JSON.stringify(await createScan(root, { goal: value ?? readOption(args, "--goal"), mode: parseScanMode(readOption(args, "--mode")) }), null, 2));
    return;
  }

  if (command === "scan" && subcommand === "list") {
    console.log(JSON.stringify({ scans: await listScans(root) }, null, 2));
    return;
  }

  if (command === "scan" && subcommand === "add-source") {
    const sourcePath = positionalArg(args, 3);
    if (!value || !sourcePath) throw new Error("Usage: agentmind scan add-source <scan-id> <path> --reason <text> [--type <type>]");
    const reason = readOption(args, "--reason");
    if (!reason) throw new Error("scan add-source requires --reason <text>");
    console.log(JSON.stringify(await addScanSource(root, value, { sourcePath, type: parseScanSourceType(readOption(args, "--type")), reason }), null, 2));
    return;
  }

  if (command === "scan" && subcommand === "finish") {
    if (!value) throw new Error("Usage: agentmind scan finish <scan-id> [--summary <text>]");
    console.log(JSON.stringify(await finishScan(root, value, { summary: readOption(args, "--summary") }), null, 2));
    return;
  }

  if (command === "reflect" && subcommand === "latest") {
    const proposal = await reflectLatest(root);
    if (!proposal) console.log("No episode or reward signal found to reflect on.");
    else console.log(JSON.stringify(proposal, null, 2));
    return;
  }

  if (command === "worker") {
    if (subcommand === "run") {
      if (!args.includes("--once")) throw new Error("Usage: agentmind worker run --once [--mode <extract|improve>] [--source <id|path>] [--asset <path>] [--root <path>]");
      console.log(JSON.stringify(await runWorkerOnce(root, {
        mode: parseWorkerMode(readOption(args, "--mode")),
        source: readOption(args, "--source"),
        asset: readOption(args, "--asset"),
      }), null, 2));
      return;
    }
    throw new Error("Usage: agentmind worker run --once");
  }

  if (command === "record" && subcommand === "episode") {
    const goal = value ?? readOption(args, "--goal");
    if (!goal) throw new Error("Usage: agentmind record episode <goal>");
    const episode = await writeEpisode(root, {
      goal,
      agent: readOption(args, "--agent"),
      outcome: parseOutcome(readOption(args, "--outcome")),
    });
    console.log(JSON.stringify(episode, null, 2));
    return;
  }

  if (command === "record" && subcommand === "reward") {
    const reward = await writeReward(root, {
      source: "human",
      polarity: parsePolarity(readOption(args, "--polarity")),
      target_episode: readOption(args, "--episode"),
      evidence: readRepeatedOptions(args, "--evidence"),
      suspected_causes: readRepeatedOptions(args, "--cause"),
    });
    console.log(JSON.stringify(reward, null, 2));
    return;
  }

  if (command === "review") {
    const acceptIndex = args.indexOf("--accept");
    const rejectIndex = args.indexOf("--reject");
    if (acceptIndex >= 0 && args[acceptIndex + 1]) {
      console.log(JSON.stringify(await reviewProposal(root, args[acceptIndex + 1]!, "accepted", readOption(args, "--reason")), null, 2));
      return;
    }
    if (rejectIndex >= 0 && args[rejectIndex + 1]) {
      console.log(JSON.stringify(await reviewProposal(root, args[rejectIndex + 1]!, "rejected", readOption(args, "--reason")), null, 2));
      return;
    }
    if (!subcommand || subcommand === "list") {
      console.log(JSON.stringify(await reviewList(root, readOption(args, "--status")), null, 2));
      return;
    }
    if (subcommand === "show") {
      if (!value) throw new Error("Usage: agentmind review show <proposal-id> [--status <pending|accepted|rejected|applied>]");
      const bucket = parseOptionalProposalBucket(readOption(args, "--status"));
      console.log(JSON.stringify(await findProposal(root, value, bucket), null, 2));
      return;
    }
    if (subcommand === "accept" || subcommand === "reject") {
      if (!value) throw new Error(`Usage: agentmind review ${subcommand} <proposal-id> [--reason <text>]`);
      const status = subcommand === "accept" ? "accepted" : "rejected";
      console.log(JSON.stringify(await reviewProposal(root, value, status, readOption(args, "--reason")), null, 2));
      return;
    }
    if (subcommand === "apply") {
      if (!value) throw new Error("Usage: agentmind review apply <proposal-id> [--mark-applied] [--reason <text>]");
      if (args.includes("--mark-applied")) {
        console.log(JSON.stringify(await markProposalApplied(root, value, readOption(args, "--reason")), null, 2));
      } else {
        console.log(JSON.stringify(await buildApplyPlan(root, value), null, 2));
      }
      return;
    }
    throw new Error("Usage: agentmind review [list|show|accept|reject|apply]");
  }

  if (command === "mcp") {
    startMcpServer(root);
    return;
  }

  throw new Error(`Unknown command: ${args.join(" ")}`);
}

function parseArgs(argv: string[]): { args: string[]; root: string } {
  const args = [...argv];
  let root = process.cwd();
  const rootIndex = args.indexOf("--root");
  if (rootIndex >= 0) {
    const rootValue = args[rootIndex + 1];
    if (!rootValue) throw new Error("--root requires a path");
    root = path.resolve(rootValue);
    args.splice(rootIndex, 2);
  }
  return { args, root };
}

function parseHarness(input: string | undefined): AgentHarness {
  if (input === "codex" || input === "claude") return input;
  if (input === "claude-code") return "claude";
  throw new Error("Usage: agentmind connect <codex|claude>");
}

function parseOptionalHarness(input: string | undefined): AgentHarness | undefined {
  if (!input) return undefined;
  return parseHarness(input);
}

function parsePriority(value: string | undefined): "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function parseWorkStatus(value: string | undefined): "todo" | "doing" | "done" | "paused" | "abandoned" | undefined {
  if (!value) return undefined;
  return value === "todo" || value === "doing" || value === "done" || value === "paused" || value === "abandoned" ? value : undefined;
}

function parseSetupMode(value: string | undefined): "auto" | "new" | "existing" | undefined {
  if (!value) return undefined;
  return value === "auto" || value === "new" || value === "existing" ? value : undefined;
}

function parseScanMode(value: string | undefined): "new" | "existing" | "manual" | undefined {
  if (!value) return undefined;
  return value === "new" || value === "existing" || value === "manual" ? value : undefined;
}

function parseProjectDesignMode(value: string | undefined): "new" | "revise" | undefined {
  if (!value) return undefined;
  if (value === "new" || value === "revise") return value;
  throw new Error("--mode must be one of: new, revise");
}

function parseScanSourceType(value: string | undefined): ScanSource["type"] | undefined {
  if (!value) return undefined;
  return value === "code" || value === "docs" || value === "config" || value === "tests" || value === "agent_context" || value === "history" || value === "reference" || value === "other" ? value : undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function positionalArg(args: string[], index: number): string | undefined {
  const value = args[index];
  return value && !value.startsWith("--") ? value : undefined;
}

function readRepeatedOptions(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]!);
  }
  return values;
}

function parseOutcome(value: string | undefined): "success" | "failed" | "unknown" {
  return value === "success" || value === "failed" || value === "unknown" ? value : "unknown";
}

function parsePolarity(value: string | undefined): "positive" | "negative" | "mixed" | "neutral" {
  return value === "positive" || value === "negative" || value === "mixed" || value === "neutral" ? value : "neutral";
}

function parseOptionalProposalBucket(value: string | undefined): ProposalBucket | undefined {
  if (!value) return undefined;
  if (value === "pending" || value === "accepted" || value === "rejected" || value === "applied") return value;
  throw new Error("--status must be one of: pending, accepted, rejected, applied");
}

function parseWorkerMode(value: string | undefined): "extract" | "improve" | undefined {
  if (!value) return undefined;
  if (value === "extract" || value === "improve") return value;
  throw new Error("--mode must be one of: extract, improve");
}

async function reviewList(root: string, status: string | undefined): Promise<Record<string, unknown>> {
  if (status === "all") {
    return {
      pending: await summarizeProposals(root, "pending"),
      accepted: await summarizeProposals(root, "accepted"),
      rejected: await summarizeProposals(root, "rejected"),
      applied: await summarizeProposals(root, "applied"),
    };
  }
  const bucket = parseOptionalProposalBucket(status) ?? "pending";
  return { status: bucket, proposals: await summarizeProposals(root, bucket) };
}

function printHelp(): void {
  console.log(`AgentMind

Usage:
  agentmind setup [--mode <auto|new|existing>] [--root <path>]
  agentmind doctor [--root <path>]
  agentmind init [--root <path>]
  agentmind status [--root <path>]
  agentmind online start --harness <codex|claude> [--session <id>] [--focus <text>] [--stale-minutes <n>] [--root <path>]
  agentmind online status [--session <id>] [--stale-minutes <n>] [--root <path>]
  agentmind online end --session <id> [--root <path>]
  agentmind work add <title> [--priority <low|medium|high>] [--goal <text>] [--next <text>] [--root <path>]
  agentmind work list [--status <todo|doing|paused|done|abandoned>] [--root <path>]
  agentmind work claim <id> --session <id> [--scope <text>] [--root <path>]
  agentmind work checkpoint <id> --summary <text> [--session <id>] [--next <text>] [--blocker <text>] [--file <path>] [--verification <text>] [--root <path>]
  agentmind work pause <id> [--session <id>] [--summary <text>] [--next <text>] [--root <path>]
  agentmind work finish <id> [--session <id>] [--summary <text>] [--root <path>]
  agentmind work abandon <id> [--session <id>] [--summary <text>] [--root <path>]
  agentmind spec create <title> [--work <id>] [--root <path>]
  agentmind project design [--from-scan <id>] [--from-source <id>] [--mode <new|revise>] [--root <path>]
  agentmind project design list [--root <path>]
  agentmind project design status <id> [--root <path>]
  agentmind project design propose <id> [--root <path>]
  agentmind connect <codex|claude> [--root <path>]
  agentmind import skill <path> [--root <path>]
  agentmind skill list [--root <path>]
  agentmind skill discover --from claude [--root <path>]
  agentmind skill promote <capability-id|skill-id> [--root <path>]
  agentmind skill render [--root <path>]
  agentmind reference add <path-or-url> [--title <text>] [--reason <text>] [--tag <tag>] [--root <path>]
  agentmind reference list [--root <path>]
  agentmind history import <file> [--title <text>] [--reason <text>] [--tag <tag>] [--root <path>]
  agentmind history list [--root <path>]
  agentmind sources list [--root <path>]
  agentmind scan create [goal] [--mode <new|existing|manual>] [--root <path>]
  agentmind scan list [--root <path>]
  agentmind scan add-source <scan-id> <path> --reason <text> [--type <code|docs|config|tests|agent_context|history|reference|other>] [--root <path>]
  agentmind scan finish <scan-id> [--summary <text>] [--root <path>]
  agentmind record episode <goal> [--agent <name>] [--outcome <success|failed|unknown>] [--root <path>]
  agentmind record reward [--polarity <positive|negative|mixed|neutral>] [--episode <id>] [--evidence <text>] [--cause <text>] [--root <path>]
  agentmind reflect latest [--root <path>]
  agentmind worker run --once [--mode <extract|improve>] [--source <id|path>] [--asset <path>] [--root <path>]
  agentmind review [list] [--status <pending|accepted|rejected|applied|all>] [--root <path>]
  agentmind review show <id> [--status <pending|accepted|rejected|applied>] [--root <path>]
  agentmind review accept <id> [--reason <text>] [--root <path>]
  agentmind review reject <id> [--reason <text>] [--root <path>]
  agentmind review apply <id> [--mark-applied] [--reason <text>] [--root <path>]
  agentmind review [--accept <id>|--reject <id>] [--reason <text>] [--root <path>]
  agentmind mcp [--root <path>]
`);
}
