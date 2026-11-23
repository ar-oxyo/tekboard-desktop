import lib from "../../src-tauri/src/lib.rs?raw";
import { describe, expect, it } from "vitest";
import { COMMAND_DOMAINS, keysFor } from "./sync";

describe("data-changed → queries", () => {
  it("a MY Epitech sync refreshes the planning (the calendar used to stay stale)", () => {
    expect(keysFor(["my"])).toContainEqual(["plan"]);
  });
  it("repositories refresh the plan too (rekey moves entries)", () => {
    expect(keysFor(["repos"])).toContainEqual(["plan"]);
  });
  it("each key is listed once", () => {
    const keys = keysFor(["my", "repos", "plan"]).map((k) => JSON.stringify(k));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("unknown domains are ignored", () => {
    expect(keysFor(["nope"])).toEqual([]);
  });
  it("every writing command named in the table exists in the backend", () => {
    const registered = new Set([...lib.matchAll(/commands\w*::(\w+)/g)].map((m) => m[1]));
    for (const c of Object.keys(COMMAND_DOMAINS)) expect(registered, c).toContain(c);
  });
  it("every planning write refreshes the plan", () => {
    for (const c of ["plan_event_save", "plan_event_delete", "plan_task_save", "plan_apply", "plan_log_add"]) expect(COMMAND_DOMAINS[c]).toContain("plan");
  });
});
