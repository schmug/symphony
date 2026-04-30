import { describe, it, expect, beforeEach } from "vitest";
import { WorkspaceManager } from "../../src/workspace/manager.js";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function freshRoot() {
  return await mkdtemp(join(tmpdir(), "symphony-ws-"));
}

describe("WorkspaceManager", () => {
  let root: string;
  beforeEach(async () => {
    root = await freshRoot();
  });

  describe("pathFor", () => {
    it("derives a deterministic descendant path", () => {
      const mgr = new WorkspaceManager({ root });
      const a = mgr.pathFor("schmug/dmarcheck#42");
      const b = mgr.pathFor("schmug/dmarcheck#42");
      expect(a).toBe(b);
      expect(a.startsWith(root)).toBe(true);
      expect(a).not.toBe(root);
    });

    it("rejects identifiers that would slug to empty", () => {
      const mgr = new WorkspaceManager({ root });
      expect(() => mgr.pathFor("###")).toThrow();
    });
  });

  describe("ensure", () => {
    it("creates the workspace directory and runs after_create exactly once", async () => {
      const calls: string[] = [];
      const mgr = new WorkspaceManager({
        root,
        hooks: { after_create: "echo created" },
        runHook: async (hook) => {
          calls.push(hook);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      });

      const first = await mgr.ensure("schmug/repo#1");
      expect(first.created).toBe(true);
      expect(calls).toHaveLength(1);
      const exists = await stat(first.path);
      expect(exists.isDirectory()).toBe(true);

      const second = await mgr.ensure("schmug/repo#1");
      expect(second.created).toBe(false);
      expect(calls).toHaveLength(1);
    });

    it("propagates hook env vars to the runner", async () => {
      const captured: Record<string, string>[] = [];
      const mgr = new WorkspaceManager({
        root,
        hooks: { after_create: "echo" },
        runHook: async (_h, _cwd, env) => {
          captured.push(env);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      });
      await mgr.ensure("schmug/repo#9", { ISSUE_ID: "9" });
      expect(captured[0]).toEqual({ ISSUE_ID: "9" });
    });

    it("throws when the after_create hook fails", async () => {
      const mgr = new WorkspaceManager({
        root,
        hooks: { after_create: "false" },
        runHook: async () => ({ exitCode: 1, stdout: "", stderr: "boom" }),
      });
      await expect(mgr.ensure("schmug/repo#3")).rejects.toThrow(/boom/);
    });

    it("creates the dir even when no after_create hook is configured", async () => {
      const mgr = new WorkspaceManager({ root });
      const result = await mgr.ensure("schmug/repo#4");
      expect(result.created).toBe(true);
      expect(result.hookResult).toBeNull();
      const entries = await readdir(root);
      expect(entries.length).toBeGreaterThan(0);
    });
  });

  describe("remove", () => {
    it("runs before_remove and deletes the directory", async () => {
      const calls: string[] = [];
      const mgr = new WorkspaceManager({
        root,
        hooks: { before_remove: "echo bye" },
        runHook: async (hook) => {
          calls.push(hook);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      });
      const { path } = await mgr.ensure("schmug/repo#5");
      const result = await mgr.remove("schmug/repo#5");
      expect(result.removed).toBe(true);
      expect(calls).toHaveLength(1);
      await expect(stat(path)).rejects.toThrow();
    });

    it("is a no-op when the workspace doesn't exist", async () => {
      const mgr = new WorkspaceManager({ root });
      const result = await mgr.remove("schmug/repo#nothing");
      expect(result.removed).toBe(false);
      expect(result.hookResult).toBeNull();
    });

    it("removes the directory even if before_remove returns non-zero", async () => {
      const mgr = new WorkspaceManager({
        root,
        hooks: { before_remove: "false" },
        runHook: async () => ({ exitCode: 1, stdout: "", stderr: "warn" }),
      });
      const { path } = await mgr.ensure("schmug/repo#6");
      const result = await mgr.remove("schmug/repo#6");
      expect(result.removed).toBe(true);
      expect(result.hookResult?.exitCode).toBe(1);
      await expect(stat(path)).rejects.toThrow();
    });
  });
});
