import { EventEmitter } from "node:events";
import type { AgentEvent } from "../agent/types.js";
import type { TickInfo } from "../orchestrator.js";

export type SymphonyEvent =
  | { kind: "agent"; event: AgentEvent }
  | { kind: "tick"; tick: TickInfo };

/**
 * Single in-process bus for observability subscribers (TUI, web dashboard,
 * file logger). Thin wrapper over EventEmitter so consumers don't depend on
 * Node internals.
 */
export class PubSub {
  private bus = new EventEmitter();

  publish(event: SymphonyEvent): void {
    this.bus.emit("event", event);
  }

  subscribe(handler: (event: SymphonyEvent) => void): () => void {
    this.bus.on("event", handler);
    return () => this.bus.off("event", handler);
  }
}
