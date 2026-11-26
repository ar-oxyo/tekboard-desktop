// Draws what Artix proposes for a board. Artix never writes drawing code: it fills a small
// JSON document (the contract of src-tauri/src/board_contract.rs), which the backend has
// already checked and normalised. Here the document becomes Excalidraw skeletons, laid out by
// TekBoard: a layered layout for graphs, lifelines for sequences. Pure, tested in boardSpec.test.ts.
import type { Skeleton } from "./boards";

export type Shape = "box" | "round" | "diamond" | "ellipse" | "note" | "text";
export type Tone = "plain" | "accent" | "warn" | "ok" | "muted";

export interface SpecNode {
  id: string;
  label: string;
  shape: Shape;
  group?: string;
  tone: Tone;
}
export interface SpecEdge {
  from: string;
  to: string;
  label?: string;
  style: "solid" | "dashed";
  arrow: "end" | "both" | "none";
}
export type BoardSpec =
  | { type: "graph"; direction: "TB" | "LR"; nodes: SpecNode[]; edges: SpecEdge[]; groups: Array<{ id: string; label: string }> }
  | { type: "sequence"; participants: Array<{ id: string; label: string }>; messages: Array<{ from: string; to: string; label: string; reply: boolean }> }
  | { type: "annotations"; notes: Array<{ anchor: string; note: string }> };

const SHAPES = new Set<Shape>(["box", "round", "diamond", "ellipse", "note", "text"]);

/**
 * A last guard on what the backend sends (it already enforces the contract): the right
 * structure, known shapes, links between declared ids. `null` when anything is off.
 */
export function readSpec(value: unknown): BoardSpec | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const str = (x: unknown) => typeof x === "string";
  if (v.type === "graph" && Array.isArray(v.nodes)) {
    const nodes = v.nodes as SpecNode[];
    const ids = new Set(nodes.map((n) => n?.id));
    if (!nodes.every((n) => n && str(n.id) && str(n.label) && SHAPES.has(n.shape))) return null;
    const edges = (Array.isArray(v.edges) ? v.edges : []) as SpecEdge[];
    if (!edges.every((e) => e && ids.has(e.from) && ids.has(e.to))) return null;
    return { type: "graph", direction: v.direction === "LR" ? "LR" : "TB", nodes, edges, groups: (Array.isArray(v.groups) ? v.groups : []) as Array<{ id: string; label: string }> };
  }
  if (v.type === "sequence" && Array.isArray(v.participants) && Array.isArray(v.messages)) {
    const ids = new Set((v.participants as Array<{ id: string }>).map((p) => p?.id));
    const messages = v.messages as Array<{ from: string; to: string; label: string; reply: boolean }>;
    if (!messages.every((m) => m && ids.has(m.from) && ids.has(m.to) && str(m.label))) return null;
    return { type: "sequence", participants: v.participants as Array<{ id: string; label: string }>, messages };
  }
  if (v.type === "annotations" && Array.isArray(v.notes)) {
    const notes = v.notes as Array<{ anchor: string; note: string }>;
    return notes.every((n) => n && str(n.anchor) && str(n.note)) ? { type: "annotations", notes } : null;
  }
  return null;
}

// Drawing colours (board content, not interface): Excalidraw's own light palette.
const INK = "#1e1e1e";
const TONE: Record<Tone, { strokeColor: string; backgroundColor: string }> = {
  plain: { strokeColor: INK, backgroundColor: "#e7f5ff" },
  accent: { strokeColor: INK, backgroundColor: "#a5d8ff" },
  warn: { strokeColor: INK, backgroundColor: "#ffd8a8" },
  ok: { strokeColor: INK, backgroundColor: "#b2f2bb" },
  muted: { strokeColor: "#868e96", backgroundColor: "#f1f3f5" },
};
const NOTE = { strokeColor: "#e8b500", backgroundColor: "#fff3bf" };

/** Size of a node for its label: about 8.5 px per character at 16 px, wrapped past 220 px. */
export function nodeSize(n: Pick<SpecNode, "label" | "shape">): { w: number; h: number } {
  const chars = [...n.label].length;
  const w = Math.max(n.shape === "text" ? 60 : 120, Math.min(240, Math.round(chars * 8.5) + 40));
  const lines = Math.max(1, Math.ceil((chars * 8.5) / (w - 32)));
  const base = 30 + lines * 20;
  const h = n.shape === "diamond" ? base + 34 : n.shape === "ellipse" ? base + 14 : n.shape === "text" ? 24 * lines : base;
  return { w: n.shape === "diamond" ? w + 50 : w, h };
}

/**
 * Layers of a graph: each node one layer below the furthest of its parents (longest path),
 * with the links that close a cycle ignored. Then, inside each layer, two sweeps that order
 * the nodes by the mean position of their neighbours, to keep links short and uncrossed.
 */
export function layers(ids: string[], edges: Array<{ from: string; to: string }>): string[][] {
  const index = new Map(ids.map((id, i) => [id, i]));
  const out = new Map(ids.map((id) => [id, [] as string[]]));
  for (const e of edges) if (e.from !== e.to) out.get(e.from)?.push(e.to);
  // Depth-first: a link back to a node still being visited closes a cycle.
  const state = new Map<string, 0 | 1 | 2>();
  const forward: Array<[string, string]> = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id) ?? []) {
      const s = state.get(to) ?? 0;
      if (s === 1) continue;
      forward.push([id, to]);
      if (s === 0) visit(to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.get(id)) visit(id);
  const level = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const [a, b] of forward) {
      if (level.get(b)! < level.get(a)! + 1) {
        level.set(b, level.get(a)! + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const rows: string[][] = [];
  for (const id of ids) (rows[level.get(id)!] ??= []).push(id);
  const filled = rows.filter((r) => r && r.length);
  const pos = new Map<string, number>();
  const place = () => filled.forEach((r) => r.forEach((id, i) => pos.set(id, i)));
  place();
  const neighbours = (id: string, up: boolean) => forward.filter(([a, b]) => (up ? b === id : a === id)).map(([a, b]) => (up ? a : b));
  for (const up of [true, false, true]) {
    const order = up ? filled : [...filled].reverse();
    for (const row of order) {
      const key = (id: string) => {
        const n = neighbours(id, up);
        return n.length ? n.reduce((s, x) => s + pos.get(x)!, 0) / n.length : pos.get(id)!;
      };
      row.sort((a, b) => key(a) - key(b) || index.get(a)! - index.get(b)!);
      place();
    }
  }
  return filled;
}

const GAP_LAYER = 80;
const GAP_NODE = 48;

function graphShapes(spec: Extract<BoardSpec, { type: "graph" }>, prefix: string): Skeleton[] {
  const id = (n: string) => `${prefix}-${n}`;
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const size = new Map(spec.nodes.map((n) => [n.id, nodeSize(n)]));
  const rows = layers(spec.nodes.map((n) => n.id), spec.edges);
  const lr = spec.direction === "LR";
  const at = new Map<string, { x: number; y: number }>();
  let along = 0;
  for (const row of rows) {
    // Across: the row centred on 0. Along: rows one after the other.
    const across = row.map((n) => (lr ? size.get(n)!.h : size.get(n)!.w));
    const total = across.reduce((s, w) => s + w, 0) + GAP_NODE * (row.length - 1);
    const depth = Math.max(...row.map((n) => (lr ? size.get(n)!.w : size.get(n)!.h)));
    let cursor = -total / 2;
    row.forEach((n, i) => {
      const s = size.get(n)!;
      const offset = lr ? (depth - s.w) / 2 : (depth - s.h) / 2;
      at.set(n, lr ? { x: along + offset, y: cursor } : { x: cursor, y: along + offset });
      cursor += across[i] + GAP_NODE;
    });
    along += depth + GAP_LAYER;
  }
  const out: Skeleton[] = [];
  // Groups behind their nodes: a dashed frame with its name.
  for (const g of spec.groups) {
    const members = spec.nodes.filter((n) => n.group === g.id);
    if (!members.length) continue;
    const x0 = Math.min(...members.map((n) => at.get(n.id)!.x)) - 24;
    const y0 = Math.min(...members.map((n) => at.get(n.id)!.y)) - 40;
    const x1 = Math.max(...members.map((n) => at.get(n.id)!.x + size.get(n.id)!.w)) + 24;
    const y1 = Math.max(...members.map((n) => at.get(n.id)!.y + size.get(n.id)!.h)) + 24;
    out.push({ type: "rectangle", id: id(`group-${g.id}`), x: x0, y: y0, width: x1 - x0, height: y1 - y0, strokeColor: "#868e96", backgroundColor: "transparent", strokeStyle: "dashed", roundness: { type: 3 } });
    out.push({ type: "text", x: x0 + 12, y: y0 + 8, text: g.label, fontSize: 14, strokeColor: "#868e96" });
  }
  for (const n of spec.nodes) {
    const p = at.get(n.id)!;
    const s = size.get(n.id)!;
    if (n.shape === "text") {
      out.push({ type: "text", id: id(n.id), x: p.x, y: p.y, text: n.label, fontSize: 16, strokeColor: TONE[n.tone].strokeColor });
      continue;
    }
    const type = n.shape === "diamond" ? "diamond" : n.shape === "ellipse" ? "ellipse" : "rectangle";
    const style = n.shape === "note" ? NOTE : TONE[n.tone];
    out.push({ type, id: id(n.id), x: p.x, y: p.y, width: s.w, height: s.h, ...style, fillStyle: "solid", roundness: n.shape === "round" ? { type: 3 } : null, label: { text: n.label, fontSize: 16 } });
  }
  for (const e of spec.edges) {
    const a = at.get(e.from)!;
    const sa = size.get(e.from)!;
    if (!byId.has(e.to)) continue;
    out.push({
      type: "arrow",
      x: a.x + sa.w / 2,
      y: a.y + sa.h / 2,
      start: { id: id(e.from) },
      end: { id: id(e.to) },
      strokeColor: INK,
      strokeStyle: e.style,
      startArrowhead: e.arrow === "both" ? "arrow" : null,
      endArrowhead: e.arrow === "none" ? null : "arrow",
      ...(e.label ? { label: { text: e.label, fontSize: 14 } } : {}),
    });
  }
  return out;
}

const COL = 220;
const ROW = 56;

function sequenceShapes(spec: Extract<BoardSpec, { type: "sequence" }>, prefix: string): Skeleton[] {
  const out: Skeleton[] = [];
  const col = new Map(spec.participants.map((p, i) => [p.id, i]));
  const bottom = 96 + spec.messages.length * ROW;
  spec.participants.forEach((p, i) => {
    const x = i * COL;
    out.push({ type: "rectangle", id: `${prefix}-p-${p.id}`, x, y: 0, width: 160, height: 48, ...TONE.accent, fillStyle: "solid", roundness: { type: 3 }, label: { text: p.label, fontSize: 16 } });
    out.push({ type: "line", x: x + 80, y: 48, points: [[0, 0], [0, bottom - 48]], strokeColor: "#868e96", strokeStyle: "dashed" });
  });
  spec.messages.forEach((m, k) => {
    const from = col.get(m.from)! * COL + 80;
    const to = col.get(m.to)! * COL + 80;
    const y = 90 + k * ROW;
    // A message to oneself loops out to the right.
    const points = from === to ? [[0, 0], [60, 0], [60, 24], [0, 24]] : [[0, 0], [to - from, 0]];
    out.push({ type: "arrow", x: from, y, points, strokeColor: INK, strokeStyle: m.reply ? "dashed" : "solid", endArrowhead: "arrow", label: { text: m.label, fontSize: 14 } });
  });
  return out;
}

let runs = 0;

/**
 * The skeletons of a diagram document (annotations are placed by `annotationShapes`). Ids get
 * a prefix of their own, so a second diagram never collides with the first.
 */
export function specShapes(spec: BoardSpec, prefix = `ai${Date.now().toString(36)}${(runs++).toString(36)}`): Skeleton[] {
  if (spec.type === "graph") return graphShapes(spec, prefix);
  if (spec.type === "sequence") return sequenceShapes(spec, prefix);
  return [];
}
