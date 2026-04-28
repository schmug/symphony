#!/usr/bin/env node
import { resolve } from "node:path";
import { render } from "ink";
import React from "react";
import { buildApp } from "./symphony.js";
import { Dashboard } from "./ui/dashboard-tui.js";
import { startWebServer, type RunningServer } from "./ui/web-server.js";

interface ParsedArgs {
  workflowPath: string;
  logsRoot: string;
  showHelp: boolean;
  noTui: boolean;
  webPort: number | null;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    workflowPath: "./WORKFLOW.md",
    logsRoot: "./log",
    showHelp: false,
    noTui: false,
    webPort: 4200,
  };
  let positional = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      out.showHelp = true;
    } else if (arg === "--logs-root") {
      const next = argv[++i];
      if (!next) throw new Error("--logs-root requires a value");
      out.logsRoot = next;
    } else if (arg === "--no-tui") {
      out.noTui = true;
    } else if (arg === "--no-web") {
      out.webPort = null;
    } else if (arg === "--web-port") {
      const next = argv[++i];
      if (!next) throw new Error("--web-port requires a value");
      const port = Number(next);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`--web-port must be an integer in 0..65535`);
      }
      out.webPort = port;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else if (positional === 0) {
      out.workflowPath = arg;
      positional++;
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }
  return out;
}

const HELP = `Symphony — agentic coding orchestrator

Usage:
  symphony [WORKFLOW.md] [options]

Arguments:
  WORKFLOW.md       Path to the workflow file (default: ./WORKFLOW.md)

Options:
  --logs-root DIR   Directory for log files (default: ./log)
  --no-tui          Run without the terminal dashboard (logs to stdout)
  --web-port N      Port for the web dashboard (default: 4200)
  --no-web          Disable the web dashboard
  -h, --help        Show this help

Environment:
  GITHUB_TOKEN      Required when tracker.kind == github
`;

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${HELP}`);
    process.exit(2);
  }
  if (args.showHelp) {
    process.stdout.write(HELP);
    return;
  }

  const workflowPath = resolve(args.workflowPath);
  const logsRoot = resolve(args.logsRoot);

  const app = await buildApp({
    workflowPath,
    logsRoot,
    alsoStdout: args.noTui,
  });

  app.start();
  app.logger.info(
    { workflowPath, logsRoot, projectLabel: app.projectLabel },
    "Symphony started",
  );

  let inkInstance: ReturnType<typeof render> | null = null;
  if (!args.noTui && process.stdout.isTTY) {
    inkInstance = render(
      <Dashboard
        store={app.store}
        pubsub={app.pubsub}
        pollingIntervalMs={app.config.polling.interval_ms}
        maxConcurrent={app.config.agent.max_concurrent_agents}
        projectLabel={app.projectLabel}
      />,
    );
  }

  let webServer: RunningServer | null = null;
  if (args.webPort !== null) {
    webServer = startWebServer({
      store: app.store,
      pubsub: app.pubsub,
      pollingIntervalMs: app.config.polling.interval_ms,
      maxConcurrent: app.config.agent.max_concurrent_agents,
      projectLabel: app.projectLabel,
      port: args.webPort,
    });
    app.logger.info(
      { port: args.webPort, url: `http://127.0.0.1:${args.webPort}/` },
      "Web dashboard listening",
    );
  }

  const shutdown = async (signal: string) => {
    app.logger.info({ signal }, "Shutting down");
    await app.stop();
    if (webServer) await webServer.stop().catch(() => {});
    inkInstance?.unmount();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
