import matter from "gray-matter";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WorkflowConfigSchema, type WorkflowConfig } from "./schema.js";
import { resolveEnvIndirection } from "./env.js";

export interface LoadedWorkflow {
  config: WorkflowConfig;
  promptTemplate: string;
  sourcePath: string;
}

export async function loadWorkflow(
  path: string,
  env: Record<string, string | undefined>,
): Promise<LoadedWorkflow> {
  const absolute = resolve(path);
  let raw: string;
  try {
    raw = await readFile(absolute, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`WORKFLOW.md not found at ${absolute}`);
    }
    throw err;
  }

  const parsed = matter(raw);
  if (!parsed.data || Object.keys(parsed.data).length === 0) {
    throw new Error(`WORKFLOW.md at ${absolute} is missing YAML frontmatter`);
  }

  const resolved = resolveStrings(parsed.data, env);
  const config = WorkflowConfigSchema.parse(resolved);

  return {
    config,
    promptTemplate: parsed.content,
    sourcePath: absolute,
  };
}

function resolveStrings(
  value: unknown,
  env: Record<string, string | undefined>,
): unknown {
  if (typeof value === "string") return resolveEnvIndirection(value, env);
  if (Array.isArray(value)) return value.map((v) => resolveStrings(v, env));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveStrings(v, env);
    }
    return out;
  }
  return value;
}
