import { z } from "zod";

const MemoryTrackerSchema = z.object({
  kind: z.literal("memory"),
  active_states: z.array(z.string()).default([]),
  terminal_states: z.array(z.string()).default([]),
});

const GitHubTrackerSchema = z.object({
  kind: z.literal("github"),
  api_key: z.string().min(1),
  repos: z.array(z.string().regex(/^[^/]+\/[^/]+$/)).min(1),
  active_states: z.array(z.string()).default([]),
  terminal_states: z.array(z.string()).default([]),
});

const TrackerSchema = z.discriminatedUnion("kind", [
  MemoryTrackerSchema,
  GitHubTrackerSchema,
]);

const PollingSchema = z.object({
  interval_ms: z.number().int().min(1000),
});

const WorkspaceSchema = z
  .object({
    root: z.string().default("~/code/symphony-workspaces"),
  })
  .default({ root: "~/code/symphony-workspaces" });

const HooksSchema = z
  .object({
    after_create: z.string().optional(),
    before_remove: z.string().optional(),
  })
  .default({});

const AgentSchema = z.object({
  max_concurrent_agents: z.number().int().min(1),
  max_turns: z.number().int().min(1),
});

const CodexSchema = z
  .object({
    command: z.string().default("codex app-server"),
    approval_policy: z.enum(["never", "on-failure", "always"]).default("never"),
    thread_sandbox: z
      .enum(["workspace-write", "read-only", "danger-full-access"])
      .default("workspace-write"),
  })
  .default({});

export const WorkflowConfigSchema = z.object({
  tracker: TrackerSchema,
  polling: PollingSchema,
  workspace: WorkspaceSchema,
  hooks: HooksSchema,
  agent: AgentSchema,
  codex: CodexSchema,
});

export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
export type GitHubTrackerConfig = z.infer<typeof GitHubTrackerSchema>;
export type MemoryTrackerConfig = z.infer<typeof MemoryTrackerSchema>;
