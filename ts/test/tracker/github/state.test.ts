import { describe, it, expect } from "vitest";
import {
  extractState,
  deriveBranchName,
  parseBlockedBy,
  parseRepoFromUrl,
} from "../../../src/tracker/github/state.js";

describe("extractState", () => {
  const known = ["status:todo", "status:in-progress", "status:done"];

  it("returns the first known label encountered", () => {
    expect(extractState(["status:todo", "bug"], known)).toBe("status:todo");
  });

  it("returns null when no known label is present", () => {
    expect(extractState(["bug", "enhancement"], known)).toBeNull();
  });

  it("returns null for empty label list", () => {
    expect(extractState([], known)).toBeNull();
  });

  it("is case-sensitive", () => {
    expect(extractState(["Status:Todo"], known)).toBeNull();
  });
});

describe("deriveBranchName", () => {
  it("uses issue number and a slugified title", () => {
    expect(deriveBranchName(123, "Add OAuth Support")).toBe(
      "claude/issue-123-add-oauth-support",
    );
  });

  it("collapses runs of non-alphanumeric characters into one dash", () => {
    expect(deriveBranchName(7, "Fix: bug --> crash!!")).toBe(
      "claude/issue-7-fix-bug-crash",
    );
  });

  it("trims leading and trailing dashes", () => {
    expect(deriveBranchName(9, "  hello  ")).toBe("claude/issue-9-hello");
  });

  it("truncates very long titles", () => {
    const long = "a".repeat(100);
    const result = deriveBranchName(1, long);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.startsWith("claude/issue-1-")).toBe(true);
  });

  it("falls back to just the issue number for empty/garbage titles", () => {
    expect(deriveBranchName(42, "!!!")).toBe("claude/issue-42");
    expect(deriveBranchName(42, "")).toBe("claude/issue-42");
  });
});

describe("parseBlockedBy", () => {
  it("extracts simple `Blocked by #N` mentions", () => {
    const body = "This is blocked by #42 and Blocked by #7.";
    expect(parseBlockedBy(body, "owner/repo")).toEqual([
      { repo: "owner/repo", number: 42 },
      { repo: "owner/repo", number: 7 },
    ]);
  });

  it("extracts cross-repo `owner/repo#N` mentions", () => {
    const body = "Blocked by other-owner/other-repo#99";
    expect(parseBlockedBy(body, "owner/repo")).toEqual([
      { repo: "other-owner/other-repo", number: 99 },
    ]);
  });

  it("ignores mentions outside of a `Blocked by` context", () => {
    expect(parseBlockedBy("See #5 for context.", "owner/repo")).toEqual([]);
  });

  it("deduplicates", () => {
    const body = "Blocked by #5\nAlso blocked by #5";
    expect(parseBlockedBy(body, "owner/repo")).toEqual([
      { repo: "owner/repo", number: 5 },
    ]);
  });

  it("handles empty/null bodies", () => {
    expect(parseBlockedBy("", "owner/repo")).toEqual([]);
    expect(parseBlockedBy(null, "owner/repo")).toEqual([]);
  });
});

describe("parseRepoFromUrl", () => {
  it("extracts owner/repo from a github issue url", () => {
    expect(
      parseRepoFromUrl("https://github.com/openai/symphony/issues/42"),
    ).toEqual({ owner: "openai", repo: "symphony", number: 42 });
  });

  it("returns null for non-issue urls", () => {
    expect(parseRepoFromUrl("https://example.com/")).toBeNull();
  });
});
