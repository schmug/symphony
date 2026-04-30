import type { Issue } from "../tracker/types.js";

export type RunStage =
  | "pending"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface RunSnapshot {
  issueId: string;
  identifier: string;
  stage: RunStage;
  startedAt: Date | null;
  finishedAt: Date | null;
  threadId: string | null;
  turnId: string | null;
  sessionId: string | null;
  turnNumber: number;
  tokens: TokenUsage;
  lastEventAt: Date | null;
  lastEventSummary: string | null;
  error: string | null;
}

export type AgentEvent =
  | { type: "stageChanged"; stage: RunStage; issueId: string }
  | { type: "tokenUsage"; issueId: string; usage: TokenUsage }
  | { type: "rawCodexEvent"; issueId: string; payload: unknown; summary: string }
  | { type: "error"; issueId: string; error: string }
  | { type: "completed"; issueId: string; reason: "ok" | "stopped" | "error" };

export interface AgentRunInput {
  issue: Issue;
  workspacePath: string;
  prompt: string;
}
