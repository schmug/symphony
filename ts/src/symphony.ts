import { loadWorkflow } from "./config/loader.js";
import { createTracker } from "./tracker/index.js";
import { WorkspaceManager } from "./workspace/manager.js";
import { Orchestrator } from "./orchestrator.js";
import { PubSub } from "./observability/pubsub.js";
import { StateStore } from "./observability/state-store.js";
import { createLogger } from "./observability/logger.js";
import type { Logger } from "pino";

export interface SymphonyOptions {
  workflowPath: string;
  logsRoot: string;
  /** When set, mirror logs to stdout in addition to the log file. */
  alsoStdout?: boolean;
}

export interface SymphonyApp {
  start(): void;
  stop(): Promise<void>;
  pubsub: PubSub;
  store: StateStore;
  orchestrator: Orchestrator;
  logger: Logger;
  config: import("./config/schema.js").WorkflowConfig;
  projectLabel: string;
}

export async function buildApp(opts: SymphonyOptions): Promise<SymphonyApp> {
  const { config, promptTemplate, sourcePath } = await loadWorkflow(
    opts.workflowPath,
    process.env,
  );
  const logger = createLogger({
    logsRoot: opts.logsRoot,
    alsoStdout: opts.alsoStdout ?? false,
  });
  logger.info({ sourcePath }, "Loaded workflow");

  const tracker = createTracker(config);
  const workspace = new WorkspaceManager({
    root: config.workspace.root,
    hooks: config.hooks,
  });

  const pubsub = new PubSub();
  const store = new StateStore();
  pubsub.subscribe((e) => store.apply(e));
  pubsub.subscribe((e) => {
    if (e.kind === "tick") {
      logger.info(
        {
          candidates: e.tick.candidatesSeen,
          dispatched: e.tick.dispatched,
          reconciled: e.tick.reconciled,
          skippedBackoff: e.tick.skippedBackoff,
          tombstonesCleared: e.tick.tombstonesCleared,
          errors: e.tick.errors,
        },
        "tick",
      );
    } else if (e.kind === "agent" && e.event.type === "error") {
      logger.error(
        { issueId: e.event.issueId, error: e.event.error },
        "agent error",
      );
    } else if (e.kind === "agent" && e.event.type === "stageChanged") {
      logger.info(
        { issueId: e.event.issueId, stage: e.event.stage },
        "agent stage",
      );
    }
  });

  const orchestrator = new Orchestrator({
    config,
    tracker,
    workspace,
    promptTemplate,
    onAgentEvent: (event) => pubsub.publish({ kind: "agent", event }),
    onTick: (tick) => pubsub.publish({ kind: "tick", tick }),
    onRetryEvent: (event) => {
      switch (event.type) {
        case "failureRecorded":
          logger.warn(
            {
              issueId: event.issueId,
              attempts: event.attempts,
              nextEligibleAt: event.nextEligibleAt.toISOString(),
              error: event.error,
            },
            "retry: failure recorded",
          );
          break;
        case "givenUp":
          logger.error(
            {
              issueId: event.issueId,
              attempts: event.attempts,
              error: event.error,
            },
            "retry: gave up",
          );
          break;
        case "tombstoneCleared":
          logger.info(
            { issueId: event.issueId, reason: event.reason },
            "retry: tombstone cleared",
          );
          break;
        case "giveUpCommentFailed":
          logger.error(
            { issueId: event.issueId, error: event.error },
            "retry: give-up comment failed",
          );
          break;
      }
    },
  });

  const projectLabel =
    config.tracker.kind === "github"
      ? config.tracker.repos.join(", ")
      : "memory tracker";

  return {
    start: () => orchestrator.start(),
    stop: () => orchestrator.stop(),
    pubsub,
    store,
    orchestrator,
    logger,
    config,
    projectLabel,
  };
}
