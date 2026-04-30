import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { AgentRunner } from "../../src/agent/runner.js";
import { Supervisor } from "../../src/agent/supervisor.js";
import { CodexClient } from "../../src/codex/client.js";
import type { Transport } from "../../src/codex/transport.js";
import type { Issue } from "../../src/tracker/types.js";
import type { WorkflowConfig } from "../../src/config/schema.js";

class MockTransport implements Transport {
  emitter = new EventEmitter();
  sent: string[] = [];
  closed = false;

  send(line: string): void {
    if (this.closed) throw new Error("closed");
    this.sent.push(line);
  }
  onLine(handler: (line: string) => void): () => void {
    this.emitter.on("line", handler);
    return () => this.emitter.off("line", handler);
  }
  onClose(handler: (info: any) => void): () => void {
    this.emitter.on("close", handler);
    return () => this.emitter.off("close", handler);
  }
  onStderr(handler: (chunk: string) => void): () => void {
    this.emitter.on("stderr", handler);
    return () => this.emitter.off("stderr", handler);
  }
  async close(): Promise<void> {
    this.closed = true;
    this.emitter.emit("close", { exitCode: 0, signal: null });
  }

  emit(line: string) {
    this.emitter.emit("line", line);
  }
  respondLast(result: unknown) {
    const last = this.sent.at(-1);
    if (!last) throw new Error("nothing sent");
    const msg = JSON.parse(last) as { id: number };
    this.emit(JSON.stringify({ id: msg.id, result }));
  }
  /** Drain queued sends until N requests are observed, responding to each in order. */
  respondInOrder(results: unknown[]) {
    let i = 0;
    const tick = () => {
      while (i < results.length) {
        const want = i;
        const sent = this.sent[want];
        if (!sent) return;
        const msg = JSON.parse(sent) as { id?: number };
        if (typeof msg.id === "number") {
          this.emit(JSON.stringify({ id: msg.id, result: results[i] }));
          i++;
        } else {
          i++;
        }
      }
    };
    return tick;
  }
}

const issue: Issue = {
  id: "I_1",
  identifier: "schmug/repo#1",
  title: "test",
  description: "",
  state: "status:todo",
  priority: null,
  branchName: "claude/issue-1-test",
  url: "",
  assigneeId: null,
  labels: ["status:todo"],
  blockedBy: [],
  assignedToWorker: true,
  createdAt: null,
  updatedAt: null,
};

const config: WorkflowConfig = {
  tracker: {
    kind: "memory",
    active_states: ["status:todo"],
    terminal_states: ["status:done"],
  },
  polling: { interval_ms: 5000 },
  workspace: { root: "/tmp" },
  hooks: {},
  agent: {
    max_concurrent_agents: 5,
    max_turns: 10,
    no_progress_timeout_ms: 0, // disabled by default in these tests
  },
  codex: {
    command: "codex app-server",
    approval_policy: "never",
    thread_sandbox: "workspace-write",
  },
};

async function nextTick() {
  await new Promise((r) => setImmediate(r));
}

describe("AgentRunner", () => {
  it("walks initialize → thread/start → turn/start, then waits for turn/completed", async () => {
    const events: any[] = [];
    const transport = new MockTransport();
    const runner = new AgentRunner({
      input: { issue, workspacePath: "/tmp/ws", prompt: "do work" },
      config,
      createTransport: () => transport,
      createClient: (t) => new CodexClient({ transport: t, responseTimeoutMs: 5000 }),
      onEvent: (e) => events.push(e),
    });
    const donePromise = runner.start();

    // Initialize
    await nextTick();
    expect(JSON.parse(transport.sent[0]!).method).toBe("initialize");
    transport.respondLast({});
    await nextTick();
    // initialized notification (no id, no response) — runner now sends thread/start
    await nextTick();
    expect(JSON.parse(transport.sent[2]!).method).toBe("thread/start");
    transport.respondLast({ thread: { id: "thread-1" } });
    await nextTick();
    expect(JSON.parse(transport.sent[3]!).method).toBe("turn/start");
    transport.respondLast({ turn: { id: "turn-1" } });
    await nextTick();

    expect(runner.current().stage).toBe("running");
    expect(runner.current().threadId).toBe("thread-1");
    expect(runner.current().turnId).toBe("turn-1");

    // Stream a token usage notification, then a turn/completed notification
    transport.emit(
      JSON.stringify({
        method: "thread/tokenUsage/updated",
        params: {
          totalTokenUsage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          },
        },
      }),
    );
    await nextTick();
    expect(runner.current().tokens.totalTokens).toBe(150);

    transport.emit(JSON.stringify({ method: "turn/completed", params: {} }));
    const final = await donePromise;
    expect(final.stage).toBe("completed");
    expect(events.find((e) => e.type === "completed")?.reason).toBe("ok");
  });

  it("transitions to failed when transport closes mid-turn", async () => {
    const transport = new MockTransport();
    const runner = new AgentRunner({
      input: { issue, workspacePath: "/tmp/ws", prompt: "x" },
      config,
      createTransport: () => transport,
      createClient: (t) => new CodexClient({ transport: t, responseTimeoutMs: 5000 }),
    });
    const done = runner.start();
    await nextTick();
    transport.respondLast({});
    await nextTick();
    await nextTick();
    transport.respondLast({ thread: { id: "t1" } });
    await nextTick();
    transport.respondLast({ turn: { id: "tu1" } });
    await nextTick();
    await transport.close();
    const final = await done;
    expect(final.stage).toBe("failed");
    expect(final.error).toMatch(/closed/i);
  });

  it("transitions to failed when initialize times out", async () => {
    const transport = new MockTransport();
    const runner = new AgentRunner({
      input: { issue, workspacePath: "/tmp/ws", prompt: "x" },
      config,
      createTransport: () => transport,
      createClient: (t) =>
        new CodexClient({ transport: t, responseTimeoutMs: 10 }),
    });
    const final = await runner.start();
    expect(final.stage).toBe("failed");
    expect(final.error).toMatch(/timed out/);
  });

  it("stop() transitions to stopped and resolves the run promise", async () => {
    const transport = new MockTransport();
    const runner = new AgentRunner({
      input: { issue, workspacePath: "/tmp/ws", prompt: "x" },
      config,
      createTransport: () => transport,
      createClient: (t) => new CodexClient({ transport: t, responseTimeoutMs: 5000 }),
    });
    const done = runner.start();
    await nextTick();
    await runner.stop();
    const final = await done;
    expect(final.stage).toBe("stopped");
  });
});

describe("AgentRunner watchdog", () => {
  function makeWatchdog() {
    let nowMs = 0;
    let handler: (() => void) | null = null;
    let periodMs = 0;
    return {
      clock: {
        setInterval(h: () => void, p: number) {
          handler = h;
          periodMs = p;
          return {
            clear: () => {
              handler = null;
            },
          };
        },
        now: () => nowMs,
      },
      advance(ms: number) {
        nowMs += ms;
      },
      tickWatchdog() {
        handler?.();
      },
      getPeriodMs: () => periodMs,
      isActive: () => handler !== null,
    };
  }

  async function reachRunningState(transport: MockTransport) {
    await nextTick();
    transport.respondLast({}); // initialize ack
    await nextTick();
    await nextTick(); // initialized notify, then thread/start
    transport.respondLast({ thread: { id: "thread-1" } });
    await nextTick();
    transport.respondLast({ turn: { id: "turn-1" } });
    await nextTick();
  }

  it("kills the run when no Codex events arrive within no_progress_timeout_ms", async () => {
    const watchdog = makeWatchdog();
    const transport = new MockTransport();
    const runner = new AgentRunner({
      input: { issue, workspacePath: "/tmp/ws", prompt: "do work" },
      config: {
        ...config,
        agent: { ...config.agent, no_progress_timeout_ms: 5_000 },
      },
      createTransport: () => transport,
      createClient: (t) => new CodexClient({ transport: t, responseTimeoutMs: 5000 }),
      watchdog: watchdog.clock,
    });
    const done = runner.start();
    await reachRunningState(transport);
    expect(runner.current().stage).toBe("running");
    expect(watchdog.isActive()).toBe(true);

    // No events for >= 5s — watchdog fires and kills the run.
    watchdog.advance(5_000);
    watchdog.tickWatchdog();
    const final = await done;
    expect(final.stage).toBe("failed");
    expect(final.error).toMatch(/No Codex events for 5s/);
  });

  it("does not fire while events keep arriving", async () => {
    const watchdog = makeWatchdog();
    const transport = new MockTransport();
    const runner = new AgentRunner({
      input: { issue, workspacePath: "/tmp/ws", prompt: "x" },
      config: {
        ...config,
        agent: { ...config.agent, no_progress_timeout_ms: 5_000 },
      },
      createTransport: () => transport,
      createClient: (t) => new CodexClient({ transport: t, responseTimeoutMs: 5000 }),
      watchdog: watchdog.clock,
    });
    runner.start();
    await reachRunningState(transport);

    // Advance partway, send an event, advance partway again — total elapsed
    // is greater than the timeout, but no contiguous-silence window is.
    watchdog.advance(3_000);
    transport.emit(JSON.stringify({ method: "thread/heartbeat", params: {} }));
    await nextTick();
    watchdog.advance(3_000);
    watchdog.tickWatchdog();
    expect(runner.current().stage).toBe("running");
    await runner.stop();
  });

  it("does not start a watchdog when no_progress_timeout_ms is 0", async () => {
    const watchdog = makeWatchdog();
    const transport = new MockTransport();
    const runner = new AgentRunner({
      input: { issue, workspacePath: "/tmp/ws", prompt: "x" },
      config,
      createTransport: () => transport,
      createClient: (t) => new CodexClient({ transport: t, responseTimeoutMs: 5000 }),
      watchdog: watchdog.clock,
    });
    runner.start();
    await reachRunningState(transport);
    expect(watchdog.isActive()).toBe(false);
    await runner.stop();
  });

  it("clears the watchdog when the turn completes successfully", async () => {
    const watchdog = makeWatchdog();
    const transport = new MockTransport();
    const runner = new AgentRunner({
      input: { issue, workspacePath: "/tmp/ws", prompt: "x" },
      config: {
        ...config,
        agent: { ...config.agent, no_progress_timeout_ms: 5_000 },
      },
      createTransport: () => transport,
      createClient: (t) => new CodexClient({ transport: t, responseTimeoutMs: 5000 }),
      watchdog: watchdog.clock,
    });
    const done = runner.start();
    await reachRunningState(transport);
    expect(watchdog.isActive()).toBe(true);
    transport.emit(JSON.stringify({ method: "turn/completed", params: {} }));
    await done;
    expect(watchdog.isActive()).toBe(false);
  });
});

describe("Supervisor", () => {
  function makeRunnerOptions(input: { id: string; identifier: string }) {
    return {
      input: {
        issue: { ...issue, id: input.id, identifier: input.identifier },
        workspacePath: "/tmp/ws",
        prompt: "x",
      },
      config,
      createTransport: () => new MockTransport(),
      createClient: (t: Transport) =>
        new CodexClient({ transport: t, responseTimeoutMs: 10 }),
    };
  }

  it("respects maxConcurrent", () => {
    const sup = new Supervisor({ maxConcurrent: 2 });
    const a = sup.start(makeRunnerOptions({ id: "a", identifier: "a/r#1" }));
    const b = sup.start(makeRunnerOptions({ id: "b", identifier: "a/r#2" }));
    const c = sup.start(makeRunnerOptions({ id: "c", identifier: "a/r#3" }));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).toBeNull();
    expect(sup.size()).toBe(2);
  });

  it("does not start a duplicate runner for the same issue", () => {
    const sup = new Supervisor({ maxConcurrent: 5 });
    const a1 = sup.start(makeRunnerOptions({ id: "a", identifier: "a/r#1" }));
    const a2 = sup.start(makeRunnerOptions({ id: "a", identifier: "a/r#1" }));
    expect(a1).not.toBeNull();
    expect(a2).toBeNull();
  });

  it("removes runners when they complete (via failure path)", async () => {
    const sup = new Supervisor({ maxConcurrent: 2 });
    sup.start(makeRunnerOptions({ id: "a", identifier: "a/r#1" }));
    expect(sup.size()).toBe(1);
    // Failure happens via timeout (10ms) — wait it out
    await new Promise((r) => setTimeout(r, 50));
    expect(sup.size()).toBe(0);
  });

  it("stopAll stops every runner", async () => {
    const sup = new Supervisor({ maxConcurrent: 5 });
    sup.start(makeRunnerOptions({ id: "a", identifier: "a/r#1" }));
    sup.start(makeRunnerOptions({ id: "b", identifier: "a/r#2" }));
    await sup.stopAll();
    expect(sup.size()).toBe(0);
  });
});
