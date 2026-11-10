import { describe, expect, it } from "vitest";
import type { CatalogFile, LibFileState } from "../../lib/api";
import { buildRequest, fileTitle, filterFiles, isEmptyRequest, matches } from "./model";

function file(rel: string, fn: string, extra: Partial<CatalogFile> = {}): CatalogFile {
  return {
    rel,
    category: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "",
    isHeader: rel.endsWith(".h"),
    functions: rel.endsWith(".h") ? [] : [{ name: fn, signature: `int ${fn}(char const *str)`, line: 8, doc: null, header: "my.h" }],
    staticFunctions: [],
    headers: ["my.h"],
    deps: [],
    description: null,
    tags: [],
    autoTags: [],
    declaredDeps: [],
    lines: 10,
    hash: "h",
    parseErrors: false,
    ...extra,
  };
}

const files = [
  file("utils/my_strlen.c", "my_strlen", { autoTags: ["string"] }),
  file("utils/my_list_size.c", "my_list_size", { autoTags: ["linked list"] }),
  file("mem/my_memcpy.c", "my_memcpy", { autoTags: ["memory"], description: "Copy bytes, used for allocation helpers" }),
  file("my.h", ""),
];
const all = { query: "", category: null, tag: null, state: "all" as const };

describe("library search", () => {
  it("searches names, tags, descriptions, files and signatures", () => {
    const find = (q: string) => filterFiles(files, { ...all, query: q }, new Map()).map(fileTitle);
    expect(find("my_str")).toEqual(["my_strlen"]);
    expect(find("string")).toEqual(["my_strlen"]);
    expect(find("linked list")).toEqual(["my_list_size"]);
    expect(find("allocation")).toEqual(["my_memcpy"]);
    expect(find("mem/")).toEqual(["my_memcpy"]);
    expect(find("char const")).toHaveLength(3);
    expect(find("nothing-like-this")).toEqual([]);
  });

  it("never lists headers and applies category, tag and state filters", () => {
    expect(filterFiles(files, all, new Map())).toHaveLength(3);
    expect(filterFiles(files, { ...all, category: "mem" }, new Map()).map(fileTitle)).toEqual(["my_memcpy"]);
    expect(filterFiles(files, { ...all, tag: "memory" }, new Map()).map(fileTitle)).toEqual(["my_memcpy"]);
    const states = new Map<string, LibFileState>([
      ["utils/my_strlen.c", "installed"],
      ["mem/my_memcpy.c", "modified"],
      ["utils/my_list_size.c", "absent"],
    ]);
    expect(filterFiles(files, { ...all, state: "in" }, states).map(fileTitle)).toEqual(["my_strlen", "my_memcpy"]);
    expect(filterFiles(files, { ...all, state: "out" }, states).map(fileTitle)).toEqual(["my_list_size"]);
    expect(filterFiles(files, { ...all, state: "attention" }, states).map(fileTitle)).toEqual(["my_memcpy"]);
  });

  it("glues words with underscores", () => {
    expect(matches(files[1], "list size")).toBe(true);
  });
});

describe("library request", () => {
  it("adds what is ticked and missing, removes what is unticked and present", () => {
    const r = buildRequest("lib/my", new Set(["a.c", "b.c"]), new Set(["b.c", "c.c"]), new Set(["b.c", "zzz.c"]), new Set(), false);
    expect(r).toEqual({ libDir: "lib/my", add: ["a.c"], remove: ["c.c"], replace: ["b.c"], exclude: [], init: false });
    expect(isEmptyRequest(r)).toBe(false);
  });

  it("is empty when nothing changes", () => {
    expect(isEmptyRequest(buildRequest("lib/my", new Set(["a.c"]), new Set(["a.c"]), new Set(), new Set(), false))).toBe(true);
    expect(isEmptyRequest(buildRequest("lib/my", new Set(), new Set(), new Set(), new Set(), true))).toBe(false);
  });
});
