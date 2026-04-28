import { describe, it, expect } from "vitest";
import {
  assertChildPath,
  expandHome,
  slugifyIdentifier,
} from "../../src/workspace/path-safety.js";
import { homedir } from "node:os";
import { join } from "node:path";

describe("expandHome", () => {
  it("expands ~/ to the user's home directory", () => {
    expect(expandHome("~/code")).toBe(join(homedir(), "code"));
  });

  it("expands a bare ~ to the home directory", () => {
    expect(expandHome("~")).toBe(homedir());
  });

  it("leaves absolute paths alone", () => {
    expect(expandHome("/tmp/x")).toBe("/tmp/x");
  });
});

describe("slugifyIdentifier", () => {
  it("converts a github-style identifier to a filesystem-safe slug", () => {
    expect(slugifyIdentifier("schmug/dmarcheck#42")).toBe("schmug-dmarcheck-42");
  });

  it("collapses multiple separators", () => {
    expect(slugifyIdentifier("a//b##c")).toBe("a-b-c");
  });

  it("throws when the result would be empty", () => {
    expect(() => slugifyIdentifier("###")).toThrow(/empty slug/);
  });
});

describe("assertChildPath", () => {
  it("accepts a direct child", () => {
    expect(() => assertChildPath("/tmp/root", "/tmp/root/child")).not.toThrow();
  });

  it("accepts a deep descendant", () => {
    expect(() =>
      assertChildPath("/tmp/root", "/tmp/root/a/b/c"),
    ).not.toThrow();
  });

  it("rejects the root itself", () => {
    expect(() => assertChildPath("/tmp/root", "/tmp/root")).toThrow(/root itself/);
  });

  it("rejects parent escape via ..", () => {
    expect(() =>
      assertChildPath("/tmp/root", "/tmp/root/../etc"),
    ).toThrow(/not a descendant/);
  });

  it("rejects unrelated paths", () => {
    expect(() => assertChildPath("/tmp/root", "/tmp/other")).toThrow(
      /not a descendant/,
    );
  });
});
