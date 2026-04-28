import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startWebServer, type RunningServer } from "../../src/ui/web-server.js";
import { StateStore } from "../../src/observability/state-store.js";
import { PubSub } from "../../src/observability/pubsub.js";

let server: RunningServer | null = null;

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return await new Promise<number>((resolveP) => {
    const s = createServer();
    s.listen(0, () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolveP(port));
    });
  });
}

describe("startWebServer", () => {
  let store: StateStore;
  let pubsub: PubSub;
  beforeEach(() => {
    store = new StateStore();
    pubsub = new PubSub();
  });
  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it("serves the dashboard HTML at /", async () => {
    const port = await freePort();
    server = startWebServer({
      store,
      pubsub,
      pollingIntervalMs: 1000,
      maxConcurrent: 5,
      projectLabel: "test",
      port,
    });
    // Hono's serve callback fires when ready.
    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("SYMPHONY STATUS");
    expect(html).toContain("test");
    expect(html).toContain("/api/v1/stream");
  });

  it("serves /api/v1/state with the current snapshot", async () => {
    const port = await freePort();
    server = startWebServer({
      store,
      pubsub,
      pollingIntervalMs: 1000,
      maxConcurrent: 5,
      projectLabel: "test",
      port,
    });
    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { agentsActive: number; agentsMax: number };
    expect(json.agentsMax).toBe(5);
    expect(json.agentsActive).toBe(0);
  });
});
