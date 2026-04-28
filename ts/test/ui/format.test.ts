import { describe, it, expect } from "vitest";
import {
  formatDuration,
  formatNumber,
  shortenSession,
  tokensPerSecond,
  truncate,
} from "../../src/ui/format.js";

describe("formatNumber", () => {
  it("inserts thousands separators", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });
});

describe("formatDuration", () => {
  it("renders seconds for short durations", () => {
    expect(formatDuration(5_000)).toBe("5s");
  });
  it("renders minutes + seconds", () => {
    expect(formatDuration(125_000)).toBe("2m 5s");
  });
  it("renders hours + minutes for long durations", () => {
    expect(formatDuration(2 * 3600 * 1000 + 30 * 60 * 1000)).toBe("2h 30m");
  });
  it("renders days for very long durations", () => {
    expect(formatDuration(2 * 86400 * 1000)).toBe("2d 0h 0m");
  });
});

describe("tokensPerSecond", () => {
  it("computes integer throughput", () => {
    expect(tokensPerSecond(1000, 1000)).toBe(1000);
    expect(tokensPerSecond(150, 1000)).toBe(150);
  });
  it("returns 0 for zero/negative runtime", () => {
    expect(tokensPerSecond(1000, 0)).toBe(0);
  });
});

describe("shortenSession", () => {
  it("returns the session id unchanged when short", () => {
    expect(shortenSession("abc123")).toBe("abc123");
  });
  it("returns dash for null", () => {
    expect(shortenSession(null)).toBe("—");
  });
  it("shortens with ellipsis", () => {
    expect(shortenSession("019cabcdef0123456789")).toBe("019c...456789");
  });
});

describe("truncate", () => {
  it("leaves short strings", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });
  it("adds an ellipsis when truncating", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
  });
});
