// Whiteboard helpers that need no Excalidraw: the programming shapes library (as Excalidraw
// "skeletons", with arrows bound to their ends so they follow when moved), what Artix reads
// from a board, what it answers, and checks on elements received from others.
// Pure functions, tested in boards.test.ts.

export type Skeleton = Record<string, unknown> & { type: string; x: number; y: number; id?: string };

const BOX = { strokeColor: "#1e1e1e", backgroundColor: "#a5d8ff", fillStyle: "solid", roundness: { type: 3 } };
const NOTE = { strokeColor: "#e8b500", backgroundColor: "#fff3bf", fillStyle: "solid" };

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function box(id: string, x: number, y: number, w: number, h: number, text: string, style: Record<string, unknown> = BOX): Skeleton {
  return { type: "rectangle", id, x, y, width: w, height: h, ...style, label: text ? { text, fontSize: 16 } : undefined };
}

function arrow(from: string, to: string, x: number, y: number, label?: string, extra: Record<string, unknown> = {}): Skeleton {
  return { type: "arrow", x, y, start: { id: from }, end: { id: to }, strokeColor: "#1e1e1e", ...(label ? { label: { text: label, fontSize: 14 } } : {}), ...extra };
}

const list = (s: string) => s.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean);

export type ShapeKind = "array" | "struct" | "pointer" | "memory" | "linkedList" | "tree" | "graph" | "stack" | "queue" | "uml" | "flowchart" | "clientServer" | "deps" | "note";

export interface ShapeDef {
  kind: ShapeKind;
  label: string;
  /** What the user fills in, with an example. */
  input: string;
  example: string;
  multiline?: boolean;
}

export const SHAPES: ShapeDef[] = [
  { kind: "array", label: "Tableau C", input: "Valeurs (séparées par des virgules)", example: "3, 1, 4, 1, 5" },
  { kind: "struct", label: "Structure C", input: "Nom puis champs, un par ligne", example: "node_t\nint data\nstruct node *next", multiline: true },
  { kind: "pointer", label: "Pointeur", input: "Nom du pointeur, valeur pointée", example: "ptr, 42" },
  { kind: "memory", label: "Zones mémoire", input: "Pile ; tas (variables séparées par des virgules)", example: "int a, char *s ; \"hello\", node_t" },
  { kind: "linkedList", label: "Liste chaînée", input: "Valeurs des maillons", example: "1, 2, 3" },
  { kind: "tree", label: "Arbre binaire", input: "Valeurs par niveau (_ = vide)", example: "8, 3, 10, 1, 6, _, 14" },
  { kind: "graph", label: "Graphe", input: "Arêtes (A-B non orientée, A>B orientée)", example: "A-B, B-C, C>A, C-D" },
  { kind: "stack", label: "Pile", input: "Éléments, du bas vers le sommet", example: "a, b, c" },
  { kind: "queue", label: "File", input: "Éléments, de la tête vers la queue", example: "a, b, c" },
  { kind: "uml", label: "Classe UML", input: "Nom, attributs, méthodes (un par ligne, -- entre les parties)", example: "Player\n-- \nname: string\nhp: int\n--\nmove()\nattack()", multiline: true },
  { kind: "flowchart", label: "Organigramme", input: "Étapes, une par ligne (? pour une décision)", example: "Début\nLire n\n? n > 0\nAfficher n\nFin", multiline: true },
  { kind: "clientServer", label: "Client-serveur", input: "Client, serveur, requête, réponse", example: "Client, Serveur, GET /index, 200 OK" },
  { kind: "deps", label: "Dépendances", input: "Liens, un par ligne (a -> b)", example: "main -> parse\nparse -> lexer\nmain -> exec", multiline: true },
  { kind: "note", label: "Note", input: "Texte", example: "À vérifier : free() après chaque malloc", multiline: true },
];

/** The shapes of `kind` built from `input`, around (0, 0). */
export function generate(kind: ShapeKind, input: string): Skeleton[] {
  const out: Skeleton[] = [];
  switch (kind) {
    case "array": {
      const v = list(input).slice(0, 40);
      v.forEach((val, i) => {
        out.push(box(uid("cell"), i * 64, 0, 64, 48, val, { ...BOX, roundness: null }));
        out.push({ type: "text", x: i * 64 + 26, y: 54, text: String(i), fontSize: 14, strokeColor: "#868e96" });
      });
      break;
    }
    case "struct": {
      const [name, ...fields] = input.split("\n").map((l) => l.trim()).filter(Boolean);
      out.push(box(uid("struct"), 0, 0, 260, 44, `struct ${name ?? "s"}`, { ...BOX, backgroundColor: "#ffd8a8" }));
      fields.slice(0, 20).forEach((f, i) => out.push(box(uid("field"), 0, 44 + i * 40, 260, 40, f, { ...BOX, backgroundColor: "#fff4e6", roundness: null })));
      break;
    }
    case "pointer": {
      const [name = "p", value = "?"] = list(input);
      const a = uid("ptr");
      const b = uid("val");
      out.push(box(a, 0, 0, 120, 48, name, { ...BOX, backgroundColor: "#d0bfff" }));
      out.push(box(b, 220, 0, 120, 48, value));
      out.push(arrow(a, b, 120, 24));
      break;
    }
    case "memory": {
      const [stack = "", heap = ""] = input.split(";");
      const zone = (title: string, x: number, items: string[], color: string) => {
        out.push({ type: "text", x: x + 8, y: -34, text: title, fontSize: 18 });
        out.push(box(uid("zone"), x, 0, 220, Math.max(160, items.length * 48 + 24), "", { strokeColor: "#868e96", backgroundColor: "transparent", fillStyle: "solid", strokeStyle: "dashed" }));
        items.forEach((it, i) => out.push(box(uid("mem"), x + 16, 12 + i * 48, 188, 40, it, { ...BOX, backgroundColor: color, roundness: null })));
      };
      zone("Pile (stack)", 0, list(stack).slice(0, 12), "#b2f2bb");
      zone("Tas (heap)", 280, list(heap).slice(0, 12), "#ffc9c9");
      break;
    }
    case "linkedList": {
      const v = list(input).slice(0, 12);
      const nodes = v.map(() => uid("node"));
      v.forEach((val, i) => {
        const x = i * 220;
        out.push(box(nodes[i], x, 0, 90, 56, val, { ...BOX, roundness: null }));
        out.push(box(`${nodes[i]}-next`, x + 90, 0, 50, 56, "next", { ...BOX, backgroundColor: "#e7f5ff", roundness: null }));
        if (i > 0) out.push(arrow(`${nodes[i - 1]}-next`, nodes[i], x - 80, 28));
      });
      if (v.length) {
        const nul = uid("null");
        out.push(box(nul, v.length * 220, 8, 80, 40, "NULL", { strokeColor: "#868e96", backgroundColor: "transparent", fillStyle: "solid" }));
        out.push(arrow(`${nodes[v.length - 1]}-next`, nul, v.length * 220 - 80, 28));
      }
      break;
    }
    case "tree": {
      const v = list(input).slice(0, 31);
      const ids = v.map((x) => (x === "_" ? null : uid("tn")));
      const depth = Math.ceil(Math.log2(v.length + 1));
      const width = 2 ** depth * 70;
      v.forEach((val, i) => {
        const id = ids[i];
        if (!id) return;
        const level = Math.floor(Math.log2(i + 1));
        const pos = i - (2 ** level - 1);
        const slot = width / 2 ** level;
        const x = pos * slot + slot / 2 - 30;
        const y = level * 100;
        out.push({ type: "ellipse", id, x, y, width: 60, height: 60, ...BOX, backgroundColor: "#b2f2bb", label: { text: val, fontSize: 18 } });
        const parent = i > 0 ? ids[Math.floor((i - 1) / 2)] : null;
        if (parent) out.push(arrow(parent, id, x + 30, y - 40));
      });
      break;
    }
    case "graph": {
      const edges = list(input).slice(0, 60).map((e) => {
        const directed = e.includes(">");
        const [a, b] = e.split(/[->]+/).map((s) => s.trim());
        return { a, b, directed };
      }).filter((e) => e.a && e.b);
      const names = [...new Set(edges.flatMap((e) => [e.a, e.b]))].slice(0, 20);
      const ids = new Map(names.map((n) => [n, uid("gn")]));
      const r = 60 + names.length * 22;
      names.forEach((n, i) => {
        const a = (i / names.length) * Math.PI * 2 - Math.PI / 2;
        out.push({ type: "ellipse", id: ids.get(n), x: r + Math.cos(a) * r - 28, y: r + Math.sin(a) * r - 28, width: 56, height: 56, ...BOX, backgroundColor: "#ffec99", label: { text: n, fontSize: 18 } });
      });
      for (const e of edges) if (ids.has(e.a) && ids.has(e.b)) out.push(arrow(ids.get(e.a)!, ids.get(e.b)!, r, r, undefined, e.directed ? {} : { endArrowhead: null }));
      break;
    }
    case "stack": {
      const v = list(input).slice(0, 15);
      v.forEach((val, i) => out.push(box(uid("st"), 0, (v.length - 1 - i) * 44, 140, 44, val, { ...BOX, roundness: null })));
      if (v.length) out.push({ type: "text", x: 156, y: 10, text: "← sommet", fontSize: 16, strokeColor: "#e8590c" });
      break;
    }
    case "queue": {
      const v = list(input).slice(0, 15);
      v.forEach((val, i) => out.push(box(uid("q"), i * 90, 0, 90, 48, val, { ...BOX, roundness: null })));
      if (v.length) {
        out.push({ type: "text", x: 10, y: 60, text: "tête (sortie)", fontSize: 14, strokeColor: "#e8590c" });
        out.push({ type: "text", x: (v.length - 1) * 90, y: 60, text: "queue (entrée)", fontSize: 14, strokeColor: "#1971c2" });
      }
      break;
    }
    case "uml": {
      const parts = input.split(/^--\s*$/m).map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean));
      const [name = ["Classe"], attrs = [], methods = []] = parts;
      out.push(box(uid("uml"), 0, 0, 240, 44, name[0], { ...BOX, backgroundColor: "#d0bfff", roundness: null }));
      const ah = Math.max(40, attrs.length * 24 + 16);
      out.push({ type: "rectangle", x: 0, y: 44, width: 240, height: ah, ...BOX, backgroundColor: "#f3f0ff", roundness: null });
      out.push({ type: "text", x: 10, y: 52, text: attrs.join("\n"), fontSize: 15 });
      const mh = Math.max(40, methods.length * 24 + 16);
      out.push({ type: "rectangle", x: 0, y: 44 + ah, width: 240, height: mh, ...BOX, backgroundColor: "#f3f0ff", roundness: null });
      out.push({ type: "text", x: 10, y: 52 + ah, text: methods.join("\n"), fontSize: 15 });
      break;
    }
    case "flowchart": {
      const steps = input.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 20);
      const ids = steps.map(() => uid("fc"));
      steps.forEach((s, i) => {
        const y = i * 110;
        const decision = s.startsWith("?");
        const text = decision ? s.slice(1).trim() : s;
        const terminal = i === 0 || i === steps.length - 1;
        out.push(decision ? { type: "diamond", id: ids[i], x: 10, y, width: 200, height: 80, ...BOX, backgroundColor: "#ffec99", label: { text, fontSize: 15 } } : { type: terminal ? "ellipse" : "rectangle", id: ids[i], x: 20, y, width: 180, height: 60, ...BOX, backgroundColor: terminal ? "#b2f2bb" : "#a5d8ff", label: { text, fontSize: 15 } });
        if (i > 0) out.push(arrow(ids[i - 1], ids[i], 110, y - 30, steps[i - 1].startsWith("?") ? "oui" : undefined));
      });
      break;
    }
    case "clientServer": {
      const [client = "Client", server = "Serveur", req = "requête", res = "réponse"] = list(input);
      const c = uid("cli");
      const s = uid("srv");
      out.push(box(c, 0, 0, 160, 90, client, { ...BOX, backgroundColor: "#a5d8ff" }));
      out.push(box(s, 360, 0, 160, 90, server, { ...BOX, backgroundColor: "#b2f2bb" }));
      out.push(arrow(c, s, 160, 25, req));
      out.push(arrow(s, c, 360, 65, res));
      break;
    }
    case "deps": {
      const links = input.split("\n").map((l) => l.split("->").map((s) => s.trim())).filter((p) => p.length === 2 && p[0] && p[1]).slice(0, 60);
      const names = [...new Set(links.flat())].slice(0, 30);
      // Level = longest chain from a root, for a left-to-right layout.
      const level = new Map<string, number>(names.map((n) => [n, 0]));
      for (let k = 0; k < names.length; k++) for (const [a, b] of links) if ((level.get(b) ?? 0) <= (level.get(a) ?? 0)) level.set(b, Math.min(names.length, (level.get(a) ?? 0) + 1));
      const rows = new Map<number, number>();
      const ids = new Map(names.map((n) => [n, uid("fn")]));
      for (const n of names) {
        const l = level.get(n) ?? 0;
        const r = rows.get(l) ?? 0;
        rows.set(l, r + 1);
        out.push(box(ids.get(n)!, l * 230, r * 90, 170, 54, `${n}()`, { ...BOX, backgroundColor: "#e7f5ff" }));
      }
      for (const [a, b] of links) out.push(arrow(ids.get(a)!, ids.get(b)!, 0, 0));
      break;
    }
    case "note":
      out.push(box(uid("note"), 0, 0, 220, 140, input.trim().slice(0, 500), { ...NOTE, roundness: null }));
      break;
  }
  return out;
}

/** Offsets shapes so their top-left corner lands at (x, y). */
export function placeAt(shapes: Skeleton[], x: number, y: number): Skeleton[] {
  const minX = Math.min(...shapes.map((s) => s.x));
  const minY = Math.min(...shapes.map((s) => s.y));
  return shapes.map((s) => ({ ...s, x: s.x - minX + x, y: s.y - minY + y }));
}

interface El {
  id: string;
  type: string;
  text?: string;
  isDeleted?: boolean;
  containerId?: string | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  customData?: Record<string, unknown>;
}

/** What Artix reads: the texts, and the arrows between labelled shapes. */
export function summary(elements: readonly El[]): string {
  const live = elements.filter((e) => !e.isDeleted);
  const labelOf = new Map<string, string>();
  for (const e of live) if (e.type === "text" && e.text?.trim()) labelOf.set(e.containerId ?? e.id, e.text.trim());
  const counts: Record<string, number> = {};
  for (const e of live) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const lines: string[] = [`Éléments : ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ") || "aucun"}`];
  const texts = [...new Set(live.filter((e) => e.type === "text" && e.text?.trim()).map((e) => e.text!.trim()))];
  const code = live.filter((e) => typeof e.customData?.code === "string").map((e) => String(e.customData!.code));
  if (texts.length) lines.push("Textes :", ...texts.slice(0, 200).map((t) => `- ${t.replace(/\n/g, " / ")}`));
  if (code.length) lines.push("Blocs de code :", ...code.slice(0, 10).map((c) => "```c\n" + c.slice(0, 3000) + "\n```"));
  const links = live.filter((e) => e.type === "arrow" && (e.startBinding || e.endBinding)).map((e) => {
    const a = e.startBinding ? (labelOf.get(e.startBinding.elementId) ?? "?") : "·";
    const b = e.endBinding ? (labelOf.get(e.endBinding.elementId) ?? "?") : "·";
    const l = labelOf.get(e.id);
    return `- ${a} → ${b}${l ? ` (${l})` : ""}`;
  });
  if (links.length) lines.push("Flèches :", ...links.slice(0, 200));
  return lines.join("\n");
}

/** The ```mermaid``` block of an answer (or the answer when it starts with a diagram keyword). */
export function extractMermaid(answer: string): string | null {
  const m = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(answer);
  const body = (m ? m[1] : answer).trim();
  return /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram)\b/.test(body) ? body : null;
}

export interface Annotation {
  anchor: string;
  note: string;
}

export function extractAnnotations(answer: string): Annotation[] {
  const m = /```(?:json)?\s*\n([\s\S]*?)```/.exec(answer);
  const body = (m ? m[1] : answer).trim();
  const s = body.indexOf("[");
  const e = body.lastIndexOf("]");
  if (s < 0 || e < s) return [];
  try {
    const v = JSON.parse(body.slice(s, e + 1));
    return Array.isArray(v) ? v.filter((a) => typeof a?.anchor === "string" && typeof a?.note === "string").slice(0, 10).map((a) => ({ anchor: a.anchor.slice(0, 200), note: a.note.slice(0, 400) })) : [];
  } catch {
    return [];
  }
}

/** Sticky notes next to the elements their anchors name (unknown anchors are dropped). */
export function annotationShapes(notes: Annotation[], elements: readonly El[]): Skeleton[] {
  const out: Skeleton[] = [];
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const n of notes) {
    const t = elements.find((e) => !e.isDeleted && e.type === "text" && e.text && e.text.toLowerCase().includes(n.anchor.toLowerCase()));
    if (!t) continue;
    const host = (t.containerId && byId.get(t.containerId)) || t;
    const x = (host.x ?? 0) + (host.width ?? 100) + 40;
    const y = host.y ?? 0;
    out.push(box(uid("note"), x, y, 220, 110, n.note, { ...NOTE, roundness: null }));
    out.push({ type: "arrow", x: x, y: y + 20, start: { id: out[out.length - 1].id }, end: { id: host.id }, strokeColor: "#e8b500", strokeStyle: "dashed" });
  }
  return out;
}

const ALLOWED = new Set(["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "frame"]);

/** Elements received from a collaborator: plain objects of known kinds, no embedded pages. */
export function sanitizeRemote(list: unknown, max = 5000): Array<Record<string, unknown>> {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && typeof (e as El).id === "string" && (e as El).id.length <= 100 && ALLOWED.has(String((e as El).type)) && typeof (e as { version?: unknown }).version === "number")
    .slice(0, max);
}

/** Only the elements that changed since `known` (id → version): what a sync message carries. */
export function changedSince<T extends { id: string; version: number }>(elements: readonly T[], known: Map<string, number>): T[] {
  return elements.filter((e) => known.get(e.id) !== e.version);
}
