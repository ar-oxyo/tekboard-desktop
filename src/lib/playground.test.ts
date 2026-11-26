import { describe, expect, it } from "vitest";
import type { DraftFile, JobView } from "./api";
import { artixRequest, lineDiff, DEFAULT_SETTINGS, fileNameError, identifiersOf, nextFileName, resultOf, runHeadline, sortFiles, starterFor } from "./playground";

const f = (name: string, content = "", library: string | null = null): DraftFile => ({ name, content, library });

describe("playground helpers", () => {
  it("collects identifiers without keywords, comments or strings", () => {
    const ids = identifiersOf('int my_strlen(char const *str) { /* hidden_one */ int count = 0; // nope_two\n printf("not_this"); return count; }');
    expect(ids).toEqual(["count", "my_strlen", "printf", "str"]);
  });

  it("orders files and finds free names", () => {
    const files = [f("util.h"), f("lib/x.c", "", "libmy"), f("b.c"), f("main.c")];
    expect(sortFiles(files).map((x) => x.name)).toEqual(["main.c", "b.c", "util.h", "lib/x.c"]);
    expect(nextFileName([f("file1.c")], ".c")).toBe("file2.c");
    expect(nextFileName([], ".h")).toBe("header1.h");
  });

  it("checks file names like the backend", () => {
    expect(fileNameError("../x.c", [])).not.toBeNull();
    expect(fileNameError(".hidden.c", [])).not.toBeNull();
    expect(fileNameError("notes.txt", [])).not.toBeNull();
    expect(fileNameError("MAIN.c", [f("main.c")])).not.toBeNull();
    expect(fileNameError("main.c", [f("main.c")], "main.c")).toBeNull();
    expect(fileNameError("inc/my.h", [])).toBeNull();
  });

  it("gives headers a guard", () => {
    expect(starterFor("inc/my_list.h")).toContain("#ifndef MY_LIST_H_");
    expect(starterFor("a.c")).toBe("");
  });

  it("says what a run did", () => {
    const job = (summary: Record<string, unknown>) => ({ summary }) as unknown as JobView;
    expect(runHeadline(resultOf(job({ compile: { ok: false, diagnostics: [{ severity: "error" }, { severity: "error" }], output: "", command: "", durationMs: 1 } })))?.tone).toBe("danger");
    const run = { exitCode: null, signal: 11, signalName: "SIGSEGV (segfault)", timedOut: false, memory: [], stdout: "", stderr: "", durationMs: 3 };
    expect(runHeadline(resultOf(job({ compile: { ok: true, diagnostics: [] }, run })))?.text).toContain("SIGSEGV");
    expect(runHeadline(resultOf(job({ compile: { ok: true, diagnostics: [] }, run: { ...run, signal: null, exitCode: 0 } })))?.tone).toBe("ok");
    expect(runHeadline(resultOf(null))).toBeNull();
  });

  it("builds bounded requests for Artix without the library files", () => {
    const draft = { title: "essai", settings: { ...DEFAULT_SETTINGS, stdin: "42\n" }, files: [f("main.c", "int main(void) { return 0; }"), f("lib/big.c", "x".repeat(50000), "libmy")] };
    const r = resultOf({ summary: { compile: { ok: true, output: "", diagnostics: [], command: "", durationMs: 1 }, run: { exitCode: 0, signal: null, signalName: null, timedOut: false, memory: [], stdout: "ok\n", stderr: "", durationMs: 2 } } } as unknown as JobView);
    const text = artixRequest("behavior", draft, r);
    expect(text).toContain("main.c");
    expect(text).toContain("lib/big.c");
    expect(text).not.toContain("xxxxxxxxxx");
    expect(text).toContain("42");
    expect(text.length).toBeLessThan(20000);
  });
});

describe("line diff", () => {
  it("keeps common lines and marks what changed", () => {
    const d = lineDiff("a\nb\nc", "a\nx\nc");
    expect(d.map((l) => `${l.kind}:${l.text}`)).toEqual(["same:a", "del:b", "add:x", "same:c"]);
    expect(lineDiff("same", "same").every((l) => l.kind === "same")).toBe(true);
    expect(lineDiff("", "new").some((l) => l.kind === "add" && l.text === "new")).toBe(true);
  });
});
