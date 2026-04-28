import { describe, it, expect } from "vitest";
import { WorkflowConfigSchema } from "../../src/config/schema.js";

describe("WorkflowConfigSchema", () => {
  const minimal = {
    tracker: { kind: "memory" },
    polling: { interval_ms: 5000 },
    agent: { max_concurrent_agents: 1, max_turns: 5 },
  };

  it("accepts a minimal memory tracker config", () => {
    expect(() => WorkflowConfigSchema.parse(minimal)).not.toThrow();
  });

  it("accepts a memory tracker with optional active/terminal states", () => {
    const result = WorkflowConfigSchema.safeParse({
      ...minimal,
      tracker: {
        kind: "memory",
        active_states: ["status:todo"],
        terminal_states: ["status:done"],
      },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.tracker.kind === "memory") {
      expect(result.data.tracker.active_states).toEqual(["status:todo"]);
      expect(result.data.tracker.terminal_states).toEqual(["status:done"]);
    }
  });

  it("requires github repos list when tracker.kind is github", () => {
    const result = WorkflowConfigSchema.safeParse({
      ...minimal,
      tracker: { kind: "github", api_key: "$GITHUB_TOKEN" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a github tracker with one or more repos", () => {
    const result = WorkflowConfigSchema.safeParse({
      ...minimal,
      tracker: {
        kind: "github",
        api_key: "$GITHUB_TOKEN",
        repos: ["owner/repo"],
        active_states: ["status:todo"],
        terminal_states: ["status:done"],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown tracker kinds", () => {
    const result = WorkflowConfigSchema.safeParse({
      ...minimal,
      tracker: { kind: "jira" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects polling intervals below 1000ms", () => {
    const result = WorkflowConfigSchema.safeParse({
      ...minimal,
      polling: { interval_ms: 100 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects max_concurrent_agents below 1", () => {
    const result = WorkflowConfigSchema.safeParse({
      ...minimal,
      agent: { max_concurrent_agents: 0, max_turns: 5 },
    });
    expect(result.success).toBe(false);
  });

  it("defaults workspace.root to ~/code/symphony-workspaces", () => {
    const parsed = WorkflowConfigSchema.parse(minimal);
    expect(parsed.workspace.root).toBe("~/code/symphony-workspaces");
  });

  it("defaults agent.no_progress_timeout_ms to 5 minutes", () => {
    const parsed = WorkflowConfigSchema.parse(minimal);
    expect(parsed.agent.no_progress_timeout_ms).toBe(300_000);
  });

  it("accepts an explicit no_progress_timeout_ms", () => {
    const parsed = WorkflowConfigSchema.parse({
      ...minimal,
      agent: { ...minimal.agent, no_progress_timeout_ms: 60_000 },
    });
    expect(parsed.agent.no_progress_timeout_ms).toBe(60_000);
  });

  it("rejects negative no_progress_timeout_ms", () => {
    const result = WorkflowConfigSchema.safeParse({
      ...minimal,
      agent: { ...minimal.agent, no_progress_timeout_ms: -1 },
    });
    expect(result.success).toBe(false);
  });
});
