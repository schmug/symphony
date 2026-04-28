import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { CodexClient } from "../../src/codex/client.js";
import type { Transport } from "../../src/codex/transport.js";

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
  onClose(handler: (info: { exitCode: number | null; signal: NodeJS.Signals | null }) => void): () => void {
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

  emitLine(line: string) {
    this.emitter.emit("line", line);
  }

  /** Convenience: respond to the most recent request with a result. */
  respond(result: unknown) {
    const last = this.sent.at(-1);
    if (!last) throw new Error("no pending request to respond to");
    const payload = JSON.parse(last) as { id: number };
    this.emitLine(JSON.stringify({ id: payload.id, result }));
  }
}

describe("CodexClient", () => {
  it("initialize sends initialize then notifies initialized", async () => {
    const t = new MockTransport();
    const client = new CodexClient({ transport: t });
    const promise = client.initialize();
    expect(t.sent).toHaveLength(1);
    const initMsg = JSON.parse(t.sent[0]!);
    expect(initMsg.method).toBe("initialize");
    expect(initMsg.id).toBe(1);
    t.respond({});
    await promise;
    expect(t.sent).toHaveLength(2);
    const notifMsg = JSON.parse(t.sent[1]!);
    expect(notifMsg.method).toBe("initialized");
    expect(notifMsg.id).toBeUndefined();
  });

  it("startThread returns the thread id", async () => {
    const t = new MockTransport();
    const client = new CodexClient({ transport: t });
    const promise = client.startThread({
      cwd: "/tmp/x",
      approvalPolicy: "never",
      sandbox: "workspace-write",
    });
    t.respond({ thread: { id: "thread-abc" } });
    expect(await promise).toBe("thread-abc");
  });

  it("startTurn returns the turn id", async () => {
    const t = new MockTransport();
    const client = new CodexClient({ transport: t });
    const promise = client.startTurn({
      threadId: "thread-abc",
      prompt: "do work",
      cwd: "/tmp/x",
      title: "issue#1: thing",
      approvalPolicy: "never",
      sandboxPolicy: { type: "workspaceWrite" },
    });
    t.respond({ turn: { id: "turn-1" } });
    expect(await promise).toBe("turn-1");
  });

  it("rejects requests when an error response is returned", async () => {
    const t = new MockTransport();
    const client = new CodexClient({ transport: t });
    const promise = client.request("foo", {});
    const sent = JSON.parse(t.sent[0]!);
    t.emitLine(JSON.stringify({ id: sent.id, error: { code: 1, message: "bad" } }));
    await expect(promise).rejects.toMatchObject({ message: "bad" });
  });

  it("forwards unsolicited notifications via the event channel", async () => {
    const t = new MockTransport();
    const client = new CodexClient({ transport: t });
    const events: any[] = [];
    client.on("event", (e) => events.push(e));
    t.emitLine(JSON.stringify({ method: "thread/tokenUsage/updated", params: { total: 100 } }));
    expect(events).toContainEqual({
      type: "notification",
      method: "thread/tokenUsage/updated",
      params: { total: 100 },
    });
  });

  it("rejects all pending requests when transport closes", async () => {
    const t = new MockTransport();
    const client = new CodexClient({ transport: t, responseTimeoutMs: 5000 });
    const promise = client.request("slow", {});
    await t.close();
    await expect(promise).rejects.toThrow(/closed/);
  });

  it("times out long-pending requests", async () => {
    const t = new MockTransport();
    const client = new CodexClient({ transport: t, responseTimeoutMs: 10 });
    await expect(client.request("slow", {})).rejects.toThrow(/timed out/);
  });

  it("emits raw event for non-JSON lines", async () => {
    const t = new MockTransport();
    const client = new CodexClient({ transport: t });
    const events: any[] = [];
    client.on("event", (e) => events.push(e));
    t.emitLine("not json at all");
    expect(events).toContainEqual({ type: "raw", payload: "not json at all" });
  });
});
