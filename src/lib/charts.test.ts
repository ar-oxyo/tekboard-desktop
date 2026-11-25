import { describe, expect, it } from "vitest";
import { bytes, compact, duration, linear, log, nearest } from "./charts";

describe("chart scales", () => {
  it("linear scales start at zero with round ticks", () => {
    const s = linear(3, 97, 0, 100);
    expect(s.domain).toEqual([0, 100]);
    expect(s.ticks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(s(50)).toBe(50);
    const inv = linear(0, 10, 200, 0);
    expect(inv(10)).toBe(0);
    expect(linear(5, 5, 0, 1, false).domain[1]).toBeGreaterThan(5);
  });

  it("log scales sit on powers of ten", () => {
    const s = log(3, 4000, 0, 300);
    expect(s.domain).toEqual([1, 10000]);
    expect(s.ticks).toEqual([1, 10, 100, 1000, 10000]);
    expect(s(100)).toBeCloseTo(150);
    expect(log(2, 50, 0, 1).ticks).toContain(5);
  });

  it("formats values for axes and tooltips", () => {
    expect(compact(32000)).toBe("32k");
    expect(compact(2_500_000)).toBe("2.5M");
    expect(duration(1530)).toBe("1.53 s");
    expect(duration(0.042)).toBe("42 µs");
    expect(bytes(2048)).toBe("2 Kio");
    expect(nearest([10, 20, 40], 33)).toBe(2);
  });
});
