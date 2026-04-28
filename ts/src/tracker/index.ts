import type { WorkflowConfig } from "../config/schema.js";
import { MemoryTracker } from "./memory.js";
import { GitHubAdapter } from "./github/adapter.js";
import { OctokitGitHubClient } from "./github/client.js";
import type { Tracker } from "./types.js";

export type { Issue, Tracker, BlockedReference } from "./types.js";
export { MemoryTracker } from "./memory.js";
export { GitHubAdapter } from "./github/adapter.js";
export { OctokitGitHubClient } from "./github/client.js";
export type { GitHubClient, GitHubIssueRaw } from "./github/client.js";

export function createTracker(config: WorkflowConfig): Tracker {
  switch (config.tracker.kind) {
    case "memory":
      return new MemoryTracker({
        activeStates: config.tracker.active_states,
        terminalStates: config.tracker.terminal_states,
      });
    case "github":
      return new GitHubAdapter({
        config: config.tracker,
        client: new OctokitGitHubClient({ token: config.tracker.api_key }),
      });
  }
}
