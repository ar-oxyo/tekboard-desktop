import { describe, expect, it } from "vitest";
import { layers, nodeSize, readSpec, specShapes, type BoardSpec } from "./boardSpec";

const graph: BoardSpec = {
  type: "graph",
  direction: "TB",
  nodes: [
    { id: "start", label: "Début", shape: "round", tone: "plain" },
    { id: "read", label: "Lire n", shape: "box", tone: "plain", group: "io" },
    { id: "test", label: "n > 0 ?", shape: "diamond", tone: "accent" },
    { id: "end", label: "Fin", shape: "round", tone: "muted" },
  ],
  edges: [
    { from: "start", to: "read", style: "solid", arrow: "end" },
    { from: "read", to: "test", style: "solid", arrow: "end" },
    { from: "test", to: "read", label: "non", style: "dashed", arrow: "end" },
    { from: "test", to: "end", label: "oui", style: "solid", arrow: "end" },
  ],
  groups: [{ id: "io", label: "Entrées" }],
};

describe("board documents", () => {
  it("lays a graph out in layers, a cycle included", () => {
    expect(layers(["start", "read", "test", "end"], graph.type === "graph" ? graph.edges : [])).toEqual([["start"], ["read"], ["test"], ["end"]]);
  });

  it("draws every node, every link bound to its ends, and the group behind", () => {
    const shapes = specShapes(graph, "t");
    const nodes = shapes.filter((s) => s.label && s.type !== "arrow");
    expect(nodes.map((s) => s.type)).toEqual(["rectangle", "rectangle", "diamond", "rectangle"]);
    const arrows = shapes.filter((s) => s.type === "arrow");
    expect(arrows).toHaveLength(4);
    expect(arrows[2]).toMatchObject({ start: { id: "t-test" }, end: { id: "t-read" }, strokeStyle: "dashed" });
    expect(shapes[0]).toMatchObject({ id: "t-group-io", strokeStyle: "dashed" });
    // Layers go down: each node sits below the previous one.
    const ys = ["t-start", "t-read", "t-test", "t-end"].map((id) => shapes.find((s) => s.id === id)!.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it("gives two diagrams different ids", () => {
    const a = specShapes(graph).find((s) => s.type === "diamond")!.id;
    const b = specShapes(graph).find((s) => s.type === "diamond")!.id;
    expect(a).not.toEqual(b);
  });

  it("draws a sequence as lifelines and messages from top to bottom", () => {
    const seq: BoardSpec = { type: "sequence", participants: [{ id: "c", label: "Client" }, { id: "s", label: "Serveur" }], messages: [{ from: "c", to: "s", label: "GET /", reply: false }, { from: "s", to: "c", label: "200", reply: true }] };
    const shapes = specShapes(seq, "q");
    expect(shapes.filter((s) => s.type === "line")).toHaveLength(2);
    const msgs = shapes.filter((s) => s.type === "arrow");
    expect(msgs[1].y).toBeGreaterThan(msgs[0].y);
    expect(msgs[1]).toMatchObject({ strokeStyle: "dashed" });
  });

  it("refuses what does not follow the contract", () => {
    expect(readSpec(graph)).not.toBeNull();
    expect(readSpec({ type: "graph", nodes: [{ id: "a", label: "x", shape: "hexagon" }] })).toBeNull();
    expect(readSpec({ type: "graph", nodes: [{ id: "a", label: "x", shape: "box" }], edges: [{ from: "a", to: "b" }] })).toBeNull();
    expect(readSpec({ type: "draw" })).toBeNull();
    expect(readSpec("flowchart TD")).toBeNull();
  });

  it("sizes a node for its label", () => {
    expect(nodeSize({ label: "x", shape: "box" }).w).toBe(120);
    expect(nodeSize({ label: "une étiquette nettement plus longue que les autres", shape: "box" }).w).toBe(240);
    expect(nodeSize({ label: "x", shape: "diamond" }).h).toBeGreaterThan(nodeSize({ label: "x", shape: "box" }).h);
  });
});
