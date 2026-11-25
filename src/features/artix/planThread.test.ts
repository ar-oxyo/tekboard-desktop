import { describe, expect, it } from "vitest";
import { planThreadTitle } from "./planThread";

describe("plan conversations", () => {
  it("names a week by its Monday, so the whole week shares one conversation", () => {
    const wed = planThreadTitle("week", new Date(2026, 10, 25, 10));
    const sun = planThreadTitle("week", new Date(2026, 10, 29, 23));
    const nextMon = planThreadTitle("week", new Date(2026, 10, 30, 8));
    expect(wed).toBe(sun);
    expect(wed).toContain("23/11");
    expect(nextMon).not.toBe(wed);
  });

  it("gives a day its own conversation and leaves project plans where they were asked", () => {
    expect(planThreadTitle("day", new Date(2026, 10, 25))).not.toBe(planThreadTitle("day", new Date(2026, 10, 26)));
    expect(planThreadTitle("two_weeks", new Date(2026, 10, 25), "/home/x/proj")).toBeNull();
  });
});
