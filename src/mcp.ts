import { readFile } from "node:fs/promises";
import path from "node:path";
import { paths, searchWiki, listSkills, writeEpisode, writeReward } from "./store.js";
import { listPendingProposals } from "./review.js";

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export function startMcpServer(root: string): void {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const parsed = readMessage(buffer);
      if (!parsed) break;
      buffer = parsed.rest;
      void handleRequest(root, parsed.message).catch((error) => {
        if (parsed.message.id !== undefined) sendError(parsed.message.id, -32000, String(error instanceof Error ? error.message : error));
      });
    }
  });
}

function readMessage(buffer: Buffer): { message: JsonRpcRequest; rest: Buffer } | null {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd < 0) return null;
  const header = buffer.slice(0, headerEnd).toString("utf8");
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) throw new Error("Missing Content-Length header");
  const length = Number(match[1]);
  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + length;
  if (buffer.length < bodyEnd) return null;
  const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
  return { message: JSON.parse(body) as JsonRpcRequest, rest: buffer.slice(bodyEnd) };
}

async function handleRequest(root: string, request: JsonRpcRequest): Promise<void> {
  if (request.method.startsWith("notifications/")) return;
  if (request.id === undefined) return;

  if (request.method === "initialize") {
    sendResult(request.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "agentmind", version: "0.1.0" },
    });
    return;
  }

  if (request.method === "tools/list") {
    sendResult(request.id, { tools: tools() });
    return;
  }

  if (request.method === "tools/call") {
    const name = String(request.params?.name ?? "");
    const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
    const result = await callTool(root, name, args);
    sendResult(request.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    return;
  }

  sendError(request.id, -32601, `Unknown method: ${request.method}`);
}

async function callTool(root: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "get_public_memory") {
    return { text: await readFile(path.join(paths(root).memory, "public.md"), "utf8") };
  }
  if (name === "search_project_wiki") {
    return { results: await searchWiki(root, String(args.query ?? "")) };
  }
  if (name === "list_project_skills") {
    return { skills: await listSkills(root) };
  }
  if (name === "record_episode") {
    return { episode: await writeEpisode(root, { goal: String(args.goal ?? "Untitled episode"), agent: stringArg(args.agent), outcome: outcomeArg(args.outcome) }) };
  }
  if (name === "record_reward") {
    return { reward: await writeReward(root, { source: "human", polarity: polarityArg(args.polarity), target_episode: stringArg(args.target_episode), evidence: arrayArg(args.evidence), suspected_causes: arrayArg(args.suspected_causes) }) };
  }
  if (name === "list_pending_proposals") {
    return { proposals: await listPendingProposals(root) };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function tools(): unknown[] {
  return [
    tool("get_public_memory", "Read workspace public memory.", {}),
    tool("search_project_wiki", "Search project wiki markdown.", { query: { type: "string" } }, ["query"]),
    tool("list_project_skills", "List imported project skills.", {}),
    tool("record_episode", "Record a completed or in-progress work episode.", { goal: { type: "string" }, agent: { type: "string" }, outcome: { type: "string", enum: ["success", "failed", "unknown"] } }, ["goal"]),
    tool("record_reward", "Record a reward signal for an episode.", { polarity: { type: "string", enum: ["positive", "negative", "mixed", "neutral"] }, target_episode: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, suspected_causes: { type: "array", items: { type: "string" } } }),
    tool("list_pending_proposals", "List pending AgentMind update proposals.", {}),
  ];
}

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): unknown {
  return { name, description, inputSchema: { type: "object", properties, required } };
}

function sendResult(id: string | number | null, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id: string | number | null, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function send(payload: unknown): void {
  const body = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function arrayArg(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function outcomeArg(value: unknown): "success" | "failed" | "unknown" {
  return value === "success" || value === "failed" || value === "unknown" ? value : "unknown";
}

function polarityArg(value: unknown): "positive" | "negative" | "mixed" | "neutral" {
  return value === "positive" || value === "negative" || value === "mixed" || value === "neutral" ? value : "neutral";
}
