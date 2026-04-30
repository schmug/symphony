/** Pure formatting helpers for the TUI/web dashboard. No React imports. */

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatDuration(ms: number): string {
  if (ms < 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Throughput in tokens/second, rounded to integer. */
export function tokensPerSecond(totalTokens: number, runtimeMs: number): number {
  if (runtimeMs <= 0) return 0;
  return Math.round((totalTokens * 1000) / runtimeMs);
}

export function shortenSession(sessionId: string | null, head = 4, tail = 6): string {
  if (!sessionId) return "—";
  if (sessionId.length <= head + tail + 3) return sessionId;
  return `${sessionId.slice(0, head)}...${sessionId.slice(-tail)}`;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}
