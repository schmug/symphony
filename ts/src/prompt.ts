import type { Issue } from "./tracker/types.js";

export interface PromptContext {
  issue: Issue;
  attempt?: number;
}

const TOKEN_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

/**
 * Tiny mustache-like renderer. Supports `{{ path.to.value }}` lookups against
 * the supplied context. Missing values render as the empty string.
 *
 * NOTE: This is intentionally NOT a Liquid/Jinja port — the Elixir reference
 * implementation uses a richer template engine (`{% if %}` blocks etc.). For
 * MVP parity we resolve plain `{{ expr }}` placeholders only. The default
 * WORKFLOW.md template is written to work without conditionals.
 */
export function renderPrompt(template: string, ctx: PromptContext): string {
  return template.replace(TOKEN_RE, (_, expr: string) => {
    const value = lookup(expr, ctx);
    return value == null ? "" : formatValue(value);
  });
}

function lookup(path: string, ctx: PromptContext): unknown {
  const parts = path.split(".");
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
