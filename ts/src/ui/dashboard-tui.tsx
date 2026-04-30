import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import type { ObservabilitySnapshot } from "../observability/state-store.js";
import type { StateStore } from "../observability/state-store.js";
import type { PubSub } from "../observability/pubsub.js";
import {
  formatDuration,
  formatNumber,
  shortenSession,
  tokensPerSecond,
  truncate,
} from "./format.js";

export interface DashboardProps {
  store: StateStore;
  pubsub: PubSub;
  /** Polling interval used to compute the next-refresh countdown. */
  pollingIntervalMs: number;
  /** Cap on running rows; oldest get scrolled out. Defaults to 30. */
  maxRows?: number;
  /** Labels for repos/project line. */
  projectLabel?: string;
  /** Render hint: max concurrent agents (denominator in `Agents X/Y`). */
  maxConcurrent: number;
}

export function Dashboard(props: DashboardProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ObservabilitySnapshot>(() =>
    props.store.snapshot(),
  );
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const unsubscribe = props.pubsub.subscribe(() => {
      setSnapshot(props.store.snapshot());
    });
    const tick = setInterval(() => {
      setNow(new Date());
      setSnapshot(props.store.snapshot());
    }, 1000);
    return () => {
      unsubscribe();
      clearInterval(tick);
    };
  }, [props.pubsub, props.store]);

  const runtimeMs = now.getTime() - snapshot.startedAt.getTime();
  const tps = tokensPerSecond(snapshot.totalTokens.totalTokens, runtimeMs);
  const nextRefreshMs = snapshot.lastTickAt
    ? Math.max(
        0,
        snapshot.lastTickAt.getTime() + props.pollingIntervalMs - now.getTime(),
      )
    : 0;

  const runs = [...snapshot.runs.values()].slice(0, props.maxRows ?? 30);
  const activeCount = [...snapshot.runs.values()].filter(
    (r) => r.stage === "running" || r.stage === "starting",
  ).length;

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>SYMPHONY STATUS</Text>
        <Text>
          <Text bold>Agents: </Text>
          <Text color="yellow">{`${activeCount}/${props.maxConcurrent}`}</Text>
        </Text>
        <Text>
          <Text bold>Throughput: </Text>
          <Text color="yellow">{`${formatNumber(tps)} tps`}</Text>
        </Text>
        <Text>
          <Text bold>Runtime: </Text>
          <Text color="yellow">{formatDuration(runtimeMs)}</Text>
        </Text>
        <Text>
          <Text bold>Tokens: </Text>
          <Text color="yellow">{`in ${formatNumber(snapshot.totalTokens.inputTokens)} | out ${formatNumber(
            snapshot.totalTokens.outputTokens,
          )} | total ${formatNumber(snapshot.totalTokens.totalTokens)}`}</Text>
        </Text>
        {props.projectLabel ? (
          <Text>
            <Text bold>Project: </Text>
            <Text color="cyan">{props.projectLabel}</Text>
          </Text>
        ) : null}
        <Text>
          <Text bold>Next refresh: </Text>
          <Text color="yellow">{formatDuration(nextRefreshMs)}</Text>
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>─ Running</Text>
        <Box flexDirection="row" marginTop={1}>
          <Box width={20}>
            <Text dimColor>ID</Text>
          </Box>
          <Box width={14}>
            <Text dimColor>STAGE</Text>
          </Box>
          <Box width={10}>
            <Text dimColor>AGE/TURN</Text>
          </Box>
          <Box width={12}>
            <Text dimColor>TOKENS</Text>
          </Box>
          <Box width={14}>
            <Text dimColor>SESSION</Text>
          </Box>
          <Box flexGrow={1}>
            <Text dimColor>EVENT</Text>
          </Box>
        </Box>
        {runs.length === 0 ? (
          <Text dimColor>No active runs</Text>
        ) : (
          runs.map((r) => {
            const ageMs = r.startedAt
              ? now.getTime() - r.startedAt.getTime()
              : 0;
            return (
              <Box key={r.issueId} flexDirection="row">
                <Box width={20}>
                  <Text>{truncate(r.identifier, 19)}</Text>
                </Box>
                <Box width={14}>
                  <Text color={stageColor(r.stage)}>{r.stage}</Text>
                </Box>
                <Box width={10}>
                  <Text>{`${formatDuration(ageMs)} / ${r.turnNumber}`}</Text>
                </Box>
                <Box width={12}>
                  <Text>{formatNumber(r.tokens.totalTokens)}</Text>
                </Box>
                <Box width={14}>
                  <Text>{shortenSession(r.sessionId)}</Text>
                </Box>
                <Box flexGrow={1}>
                  <Text>{truncate(r.lastEventSummary ?? "—", 80)}</Text>
                </Box>
              </Box>
            );
          })
        )}
      </Box>

      {snapshot.recentErrors.length > 0 ? (
        <Box flexDirection="column">
          <Text>─ Recent errors</Text>
          {snapshot.recentErrors.slice(-5).map((err, i) => (
            <Text key={i} color="red">
              {truncate(err, 120)}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function stageColor(stage: string): string {
  switch (stage) {
    case "running":
      return "green";
    case "starting":
      return "cyan";
    case "completed":
      return "white";
    case "failed":
      return "red";
    case "stopped":
      return "yellow";
    default:
      return "white";
  }
}
