import type { WorkflowConfig } from "../config/schema.js";
import { MemoryTracker } from "./memory.js";
import type { Tracker } from "./types.js";

export type { Issue, Tracker, BlockedReference } from "./types.js";
export { MemoryTracker } from "./memory.js";

export function createTracker(config: WorkflowConfig): Tracker {
  switch (config.tracker.kind) {
    case "memory":
      return new MemoryTracker({
        activeStates: config.tracker.active_states,
        terminalStates: config.tracker.terminal_states,
      });
    case "github":
      throw new Error(
        "GitHub tracker not yet implemented (Phase 2). Use tracker.kind: memory.",
      );
  }
}
