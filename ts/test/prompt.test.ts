import { describe, it, expect } from "vitest";
import { renderPrompt } from "../src/prompt.js";
import type { Issue } from "../src/tracker/types.js";

const issue: Issue = {
  id: "I_1",
  identifier: "schmug/repo#42",
  title: "Add OAuth",
  description: "do the thing",
  state: "status:todo",
  priority: null,
  branchName: "claude/issue-42",
  url: "https://example.com/42",
  assigneeId: null,
  labels: ["status:todo", "feature"],
  blockedBy: [],
  assignedToWorker: true,
  createdAt: null,
  updatedAt: null,
};

describe("renderPrompt", () => {
  it("substitutes simple placeholders", () => {
    expect(renderPrompt("hi {{ issue.identifier }}", { issue })).toBe(
      "hi schmug/repo#42",
    );
  });

  it("formats arrays as comma-separated", () => {
    expect(renderPrompt("labels: {{ issue.labels }}", { issue })).toBe(
      "labels: status:todo, feature",
    );
  });

  it("renders missing keys as empty string", () => {
    expect(renderPrompt("x: {{ issue.nope }}", { issue })).toBe("x: ");
  });

  it("tolerates whitespace inside the placeholder", () => {
    expect(renderPrompt("{{    issue.title    }}", { issue })).toBe("Add OAuth");
  });

  it("leaves non-placeholder text alone", () => {
    expect(renderPrompt("hello {{ issue.title }}!\nDescription: {{ issue.description }}", { issue }))
      .toBe("hello Add OAuth!\nDescription: do the thing");
  });
});
