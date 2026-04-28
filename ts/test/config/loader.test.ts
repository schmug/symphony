import { describe, it, expect } from "vitest";
import { loadWorkflow } from "../../src/config/loader.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "..", "fixtures");

async function withTmpFile(
  contents: string,
  fn: (path: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "symphony-test-"));
  const path = join(dir, "workflow.md");
  await writeFile(path, contents);
  try {
    await fn(path);
  } finally {
    await unlink(path).catch(() => {});
  }
}

describe("loadWorkflow", () => {
  it("loads the minimal fixture and returns parsed config + prompt", async () => {
    const result = await loadWorkflow(join(fixturesDir, "workflow-minimal.md"), {});
    expect(result.config.tracker.kind).toBe("memory");
    expect(result.config.polling.interval_ms).toBe(5000);
    expect(result.promptTemplate.trim()).toBe(
      "You are working on issue {{ issue.identifier }}.",
    );
    expect(result.sourcePath).toContain("workflow-minimal.md");
  });

  it("resolves $GITHUB_TOKEN against the provided env", async () => {
    const result = await loadWorkflow(join(fixturesDir, "workflow-full.md"), {
      GITHUB_TOKEN: "ghp_fake",
    });
    expect(result.config.tracker.kind).toBe("github");
    if (result.config.tracker.kind === "github") {
      expect(result.config.tracker.api_key).toBe("ghp_fake");
      expect(result.config.tracker.repos).toEqual([
        "schmug/dmarcheck",
        "schmug/donthype-me",
      ]);
    }
  });

  it("throws a clear error when the file does not exist", async () => {
    await expect(loadWorkflow("/nonexistent/path.md", {})).rejects.toThrow(
      /not found|ENOENT/i,
    );
  });

  it("throws a clear error when frontmatter is missing", async () => {
    await withTmpFile("Just a prompt, no frontmatter.\n", async (path) => {
      await expect(loadWorkflow(path, {})).rejects.toThrow(/frontmatter/i);
    });
  });

  it("throws a clear error when frontmatter fails schema validation", async () => {
    await withTmpFile("---\ntracker:\n  kind: jira\n---\nbody\n", async (path) => {
      await expect(loadWorkflow(path, {})).rejects.toThrow();
    });
  });
});
