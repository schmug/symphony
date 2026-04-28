import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import type { StateStore } from "../observability/state-store.js";
import type { PubSub } from "../observability/pubsub.js";
import { renderDashboardHtml } from "./web-html.js";
import { snapshotToJson } from "./web-json.js";

export interface WebServerOptions {
  store: StateStore;
  pubsub: PubSub;
  pollingIntervalMs: number;
  maxConcurrent: number;
  projectLabel: string;
  port: number;
  host?: string;
}

export interface RunningServer {
  port: number;
  stop(): Promise<void>;
}

export function startWebServer(opts: WebServerOptions): RunningServer {
  const app = new Hono();

  app.get("/", (c) => {
    return c.html(
      renderDashboardHtml({
        projectLabel: opts.projectLabel,
        maxConcurrent: opts.maxConcurrent,
      }),
    );
  });

  app.get("/api/v1/state", (c) => {
    const json = snapshotToJson(opts.store.snapshot(), {
      pollingIntervalMs: opts.pollingIntervalMs,
      maxConcurrent: opts.maxConcurrent,
      projectLabel: opts.projectLabel,
    });
    return c.json(json);
  });

  app.get("/api/v1/stream", (c) => {
    return streamSSE(c, async (stream) => {
      const send = async () => {
        const json = snapshotToJson(opts.store.snapshot(), {
          pollingIntervalMs: opts.pollingIntervalMs,
          maxConcurrent: opts.maxConcurrent,
          projectLabel: opts.projectLabel,
        });
        await stream.writeSSE({
          event: "state",
          data: JSON.stringify(json),
        });
      };
      // Initial snapshot.
      await send();
      const unsub = opts.pubsub.subscribe(() => {
        void send();
      });
      // 1Hz heartbeat keeps the runtime/refresh-countdown moving.
      const heartbeat = setInterval(() => {
        void send();
      }, 1000);
      stream.onAbort(() => {
        unsub();
        clearInterval(heartbeat);
      });
      // Block until the client disconnects.
      await new Promise<void>((resolveP) => {
        stream.onAbort(resolveP);
      });
    });
  });

  let server: ServerType | null = null;
  const promise = new Promise<ServerType>((resolveP) => {
    const s = serve(
      {
        fetch: app.fetch,
        port: opts.port,
        hostname: opts.host ?? "127.0.0.1",
      },
      () => resolveP(s),
    );
  });

  return {
    port: opts.port,
    async stop() {
      const s = server ?? (await promise);
      await new Promise<void>((resolveP, rejectP) =>
        s.close((err) => (err ? rejectP(err) : resolveP())),
      );
    },
  };
}
