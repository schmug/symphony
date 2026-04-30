import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  assertChildPath,
  expandHome,
  slugifyIdentifier,
} from "./path-safety.js";

export interface WorkspaceManagerOptions {
  root: string;
  hooks?: {
    after_create?: string | undefined;
    before_remove?: string | undefined;
  };
  /** Override for tests. Defaults to the real shell-runner. */
  runHook?: HookRunner;
  /** Override for tests. Defaults to mkdir + rm from node:fs/promises. */
  fs?: WorkspaceFs;
}

export interface WorkspaceFs {
  ensureDir(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export type HookRunner = (
  hook: string,
  cwd: string,
  env: Record<string, string>,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

const defaultFs: WorkspaceFs = {
  async ensureDir(path) {
    await mkdir(path, { recursive: true });
  },
  async removeDir(path) {
    await rm(path, { recursive: true, force: true });
  },
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
};

const defaultRunHook: HookRunner = async (hook, cwd, env) => {
  return await new Promise((resolveP, rejectP) => {
    const child = spawn("/bin/sh", ["-c", hook], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", rejectP);
    child.on("close", (code) => {
      resolveP({ exitCode: code ?? -1, stdout, stderr });
    });
  });
};

export class WorkspaceManager {
  private readonly root: string;
  private readonly hooks: {
    after_create?: string | undefined;
    before_remove?: string | undefined;
  };
  private readonly runHook: HookRunner;
  private readonly fs: WorkspaceFs;

  constructor(opts: WorkspaceManagerOptions) {
    this.root = expandHome(opts.root);
    this.hooks = opts.hooks ?? {};
    this.runHook = opts.runHook ?? defaultRunHook;
    this.fs = opts.fs ?? defaultFs;
  }

  /** Deterministic absolute path for an issue identifier. */
  pathFor(identifier: string): string {
    const slug = slugifyIdentifier(identifier);
    const candidate = join(this.root, slug);
    assertChildPath(this.root, candidate);
    return candidate;
  }

  async exists(identifier: string): Promise<boolean> {
    return this.fs.exists(this.pathFor(identifier));
  }

  /**
   * Create the workspace directory if missing and run the after_create hook
   * exactly once on first creation. Subsequent calls are no-ops.
   */
  async ensure(identifier: string, hookEnv: Record<string, string> = {}): Promise<{
    path: string;
    created: boolean;
    hookResult: { exitCode: number; stdout: string; stderr: string } | null;
  }> {
    const path = this.pathFor(identifier);
    const existed = await this.fs.exists(path);
    if (existed) {
      return { path, created: false, hookResult: null };
    }
    await this.fs.ensureDir(path);
    let hookResult = null;
    if (this.hooks.after_create) {
      hookResult = await this.runHook(this.hooks.after_create, path, hookEnv);
      if (hookResult.exitCode !== 0) {
        throw new Error(
          `after_create hook for ${identifier} exited ${hookResult.exitCode}: ${hookResult.stderr.trim()}`,
        );
      }
    }
    return { path, created: true, hookResult };
  }

  /**
   * Run the before_remove hook (if configured) and remove the workspace
   * directory. Tolerates missing directories. Hook failures are not fatal —
   * they are returned alongside the result.
   */
  async remove(
    identifier: string,
    hookEnv: Record<string, string> = {},
  ): Promise<{
    path: string;
    removed: boolean;
    hookResult: { exitCode: number; stdout: string; stderr: string } | null;
  }> {
    const path = this.pathFor(identifier);
    const existed = await this.fs.exists(path);
    if (!existed) {
      return { path, removed: false, hookResult: null };
    }
    let hookResult = null;
    if (this.hooks.before_remove) {
      hookResult = await this.runHook(this.hooks.before_remove, path, hookEnv);
    }
    await this.fs.removeDir(path);
    return { path, removed: true, hookResult };
  }
}
