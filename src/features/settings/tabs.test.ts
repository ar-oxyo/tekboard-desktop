import { describe, expect, it } from "vitest";
import { resolveTab, visibleTabs } from "./tabs";

describe("settings tabs", () => {
  it("sends the ids of the former layout to their new tab", () => {
    expect(resolveTab("doctor", false)).toBe("tools");
    expect(resolveTab("updates", false)).toBe("about");
    expect(resolveTab("my", false)).toBe("accounts");
    expect(resolveTab("ai", false)).toBe("ai");
  });

  it("keeps the developer tab hidden outside the developer mode", () => {
    expect(resolveTab("developer", false)).toBeNull();
    expect(resolveTab("developer", true)).toBe("developer");
    expect(visibleTabs(false).some((x) => x.id === "developer")).toBe(false);
  });

  it("ignores unknown ids", () => {
    expect(resolveTab("nope", true)).toBeNull();
    expect(resolveTab(null, true)).toBeNull();
  });
});
