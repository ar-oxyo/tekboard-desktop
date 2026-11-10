// Pure logic of the Library screen: search, filters, and turning ticked boxes into a request.
import type { CatalogFile, LibFileState, LibPlanRequest } from "../../lib/api";

export type StateFilter = "all" | "in" | "out" | "attention";

export interface Filters {
  query: string;
  category: string | null;
  tag: string | null;
  state: StateFilter;
}

/** Every word of the query must appear in the name, signature, file, folder, description, tags or header. */
export function matches(file: CatalogFile, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [
    file.rel,
    file.category,
    file.description ?? "",
    ...file.tags,
    ...file.autoTags,
    ...file.headers,
    ...file.functions.flatMap((f) => [f.name, f.signature, f.doc ?? "", f.header ?? ""]),
  ]
    .join("\n")
    .toLowerCase();
  // "linked list" should find my_list_size: also try the words glued with "_".
  return words.every((w) => hay.includes(w)) || hay.includes(words.join("_"));
}

export const isPresent = (s: LibFileState | undefined) => s !== undefined && s !== "absent";
export const needsAttention = (s: LibFileState | undefined) => s === "update" || s === "modified" || s === "modified_update" || s === "differs";

export function filterFiles(files: CatalogFile[], f: Filters, states: Map<string, LibFileState>): CatalogFile[] {
  return files.filter((file) => {
    if (file.isHeader) return false;
    if (f.category !== null && file.category !== f.category) return false;
    if (f.tag !== null && !file.tags.includes(f.tag) && !file.autoTags.includes(f.tag)) return false;
    const st = states.get(file.rel);
    if (f.state === "in" && !isPresent(st)) return false;
    if (f.state === "out" && isPresent(st)) return false;
    if (f.state === "attention" && !needsAttention(st)) return false;
    return matches(file, f.query);
  });
}

/** Short label of a file: its exported functions, or its name when it exports none. */
export function fileTitle(file: CatalogFile): string {
  return file.functions.length > 0 ? file.functions[0].name : (file.rel.split("/").pop() ?? file.rel);
}

/** What ticking and unticking amounts to, compared with what the project holds. */
export function buildRequest(libDir: string, desired: Set<string>, present: Set<string>, replace: Set<string>, exclude: Set<string>, init: boolean): LibPlanRequest {
  const add = [...desired].filter((r) => !present.has(r)).sort();
  const remove = [...present].filter((r) => !desired.has(r)).sort();
  return { libDir, add, remove, replace: [...replace].filter((r) => desired.has(r)).sort(), exclude: [...exclude].sort(), init };
}

export const isEmptyRequest = (r: LibPlanRequest) => r.add.length === 0 && r.remove.length === 0 && r.replace.length === 0 && !r.init;

export function counts<T extends string>(values: T[]): Array<[T, number]> {
  const m = new Map<T, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
