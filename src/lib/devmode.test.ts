import { describe, expect, it } from "vitest";
import { GAP_MS, NO_TAPS, showsHint, tap, TAPS_NEEDED } from "./devmode";

describe("developer mode taps", () => {
  it("turns on at the seventh tap in a row, then starts again", () => {
    let state = NO_TAPS;
    let last = tap(state, 0);
    for (let i = 1; i < TAPS_NEEDED; i++) {
      expect(last.done).toBe(false);
      state = last.state;
      last = tap(state, i * 300);
    }
    expect(last.done).toBe(true);
    expect(last.state).toEqual(NO_TAPS);
  });

  it("starts the count again after a pause", () => {
    let r = tap(NO_TAPS, 0);
    r = tap(r.state, 200);
    r = tap(r.state, 200 + GAP_MS + 1);
    expect(r.remaining).toBe(TAPS_NEEDED - 1);
  });

  it("shows the remaining count only from the third tap", () => {
    const one = tap(NO_TAPS, 0);
    const two = tap(one.state, 100);
    const three = tap(two.state, 200);
    expect([showsHint(one), showsHint(two), showsHint(three)]).toEqual([false, false, true]);
    expect(three.remaining).toBe(4);
  });
});
