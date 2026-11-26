import { describe, expect, it } from "vitest";
import { isStale, STALE_AFTER_S } from "./myFreshness";

describe("MY Epitech freshness", () => {
  it("is stale only past a day, and never for an unknown date", () => {
    const now = 1_000_000;
    expect(isStale(now - 3600, now)).toBe(false);
    expect(isStale(now - STALE_AFTER_S, now)).toBe(false);
    expect(isStale(now - STALE_AFTER_S - 1, now)).toBe(true);
    expect(isStale(null, now)).toBe(false);
    expect(isStale(undefined, now)).toBe(false);
  });
});
