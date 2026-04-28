import { describe, it, expect } from "vitest";
import { resolveEnvIndirection } from "../../src/config/env.js";

describe("resolveEnvIndirection", () => {
  it("returns plain strings unchanged", () => {
    expect(resolveEnvIndirection("hello", {})).toBe("hello");
  });

  it("resolves $VAR against the provided env map", () => {
    expect(resolveEnvIndirection("$GITHUB_TOKEN", { GITHUB_TOKEN: "abc" })).toBe("abc");
  });

  it("throws when $VAR is missing", () => {
    expect(() => resolveEnvIndirection("$MISSING", {})).toThrow(/MISSING/);
  });

  it("treats a bare $ as a literal string", () => {
    expect(resolveEnvIndirection("$", {})).toBe("$");
  });

  it("only resolves when the entire value is a $VAR token", () => {
    expect(resolveEnvIndirection("price: $10", {})).toBe("price: $10");
    expect(resolveEnvIndirection("$lower", {})).toBe("$lower");
  });
});
