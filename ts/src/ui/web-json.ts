import type { ObservabilitySnapshot } from "../observability/state-store.js";
import {
  formatDuration,
  formatNumber,
  shortenSession,
  tokensPerSecond,
} from "./format.js";

export interface SnapshotMeta {
  pollingIntervalMs: number;
  maxConcurrent: number;
  projectLabel: string;
}

export interface SerializedSnapshot {
  startedAt: string;
  runtimeMs: number;
  runtimeFormatted: string;
  lastTickAt: string | null;
  nextRefreshMs: number;
  totalCandidatesSeen: number;
  totalDispatched: number;
  totalErrors: number;
  totalTokens: { input: number; output: number; total: number };
  throughputTps: number;
  agentsActive: number;
  agentsMax: number;
  projectLabel: string;
  runs: Array<{
    issueId: string;
    identifier: string;
    stage: string;
    ageMs: number;
    ageFormatted: string;
    turnNumber: number;
    tokens: { input: number; output: number; total: number };
    sessionShort: string;
    lastEventSummary: string | null;
  }>;
  recentErrors: string[];
}

export function snapshotToJson(
  snap: ObservabilitySnapshot,
  meta: SnapshotMeta,
): SerializedSnapshot {
  const now = Date.now();
  const runtimeMs = now - snap.startedAt.getTime();
  const nextRefreshMs = snap.lastTickAt
    ? Math.max(0, snap.lastTickAt.getTime() + meta.pollingIntervalMs - now)
    : 0;
  const activeStages = new Set(["running", "starting"]);
  let agentsActive = 0;
  const runs: SerializedSnapshot["runs"] = [];
  for (const run of snap.runs.values()) {
    if (activeStages.has(run.stage)) agentsActive++;
    const ageMs = run.startedAt ? now - run.startedAt.getTime() : 0;
    runs.push({
      issueId: run.issueId,
      identifier: run.identifier,
      stage: run.stage,
      ageMs,
      ageFormatted: formatDuration(ageMs),
      turnNumber: run.turnNumber,
      tokens: {
        input: run.tokens.inputTokens,
        output: run.tokens.outputTokens,
        total: run.tokens.totalTokens,
      },
      sessionShort: shortenSession(run.sessionId),
      lastEventSummary: run.lastEventSummary,
    });
  }
  return {
    startedAt: snap.startedAt.toISOString(),
    runtimeMs,
    runtimeFormatted: formatDuration(runtimeMs),
    lastTickAt: snap.lastTickAt?.toISOString() ?? null,
    nextRefreshMs,
    totalCandidatesSeen: snap.totalCandidatesSeen,
    totalDispatched: snap.totalDispatched,
    totalErrors: snap.totalErrors,
    totalTokens: {
      input: snap.totalTokens.inputTokens,
      output: snap.totalTokens.outputTokens,
      total: snap.totalTokens.totalTokens,
    },
    throughputTps: tokensPerSecond(snap.totalTokens.totalTokens, runtimeMs),
    agentsActive,
    agentsMax: meta.maxConcurrent,
    projectLabel: meta.projectLabel,
    runs,
    recentErrors: snap.recentErrors.slice(-10),
  };
}

// Re-export so callers don't need a second import.
export { formatNumber } from "./format.js";
