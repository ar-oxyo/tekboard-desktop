import { describe, expect, it } from "vitest";
import type { JobView } from "./api";
import { mergeJob } from "./jobs";

const base: JobView = { id: 1, kind: "moulinette", repo: null, title: "t", status: "running", steps: [], log: "a\n", startedAt: 0, durationMs: 0, summary: {}, runId: 3, events: [{ kind: "tool", id: "x", status: "running" }], logTotal: 2, logReset: false, eventsFrom: 0 };

describe("mergeJob", () => {
  it("appends new log text and new activity entries", () => {
    const d = { ...base, log: "b\n", logTotal: 4, events: [{ kind: "tool", id: "y", status: "running" }], eventsFrom: 1 };
    const m = mergeJob(base, d);
    expect(m.log).toBe("a\nb\n");
    expect(m.events.map((e) => e.id)).toEqual(["x", "y"]);
    expect(m.logTotal).toBe(4);
  });
  it("replaces entries re-read from an earlier index (a tool call got its result)", () => {
    const d = { ...base, log: "", events: [{ kind: "tool", id: "x", status: "ok" }], eventsFrom: 0 };
    expect(mergeJob(base, d).events).toEqual([{ kind: "tool", id: "x", status: "ok" }]);
  });
  it("takes the whole log when the backend trimmed it", () => {
    expect(mergeJob(base, { ...base, log: "fresh", logReset: true }).log).toBe("fresh");
  });
});
