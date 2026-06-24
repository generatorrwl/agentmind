import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  if (await exists(filePath)) return false;
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, "utf8");
  return true;
}

export async function readText(filePath: string, fallback = ""): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function moveFile(from: string, to: string): Promise<void> {
  await ensureDir(path.dirname(to));
  await rename(from, to);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "item";
}

export function stableId(prefix: string, input: string): string {
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 10);
  return `${prefix}_${hash}`;
}

export async function listMarkdownFiles(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  const output: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        output.push(entryPath);
      }
    }
  }
  await walk(root);
  return output.sort();
}

export async function pathKind(target: string): Promise<"file" | "directory" | "missing"> {
  try {
    const info = await stat(target);
    if (info.isDirectory()) return "directory";
    if (info.isFile()) return "file";
    return "missing";
  } catch {
    return "missing";
  }
}

