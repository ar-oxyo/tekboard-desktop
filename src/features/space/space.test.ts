import { describe, expect, it } from "vitest";
import { decodeLook, encodeLook, lookFromSeed } from "./avatar";
import { free, MAP, SPAWN, TABLES, walkable, zoneAt } from "./map";
import { findPath } from "./path";
import { readClient, validJam, type HostMsg, type Player } from "./protocol";
import { SpaceHost } from "./host";

const me = (fp: string): Player => ({ fp, nick: fp, avatar: "", status: "available", x: 0, y: 0, dir: "down", moving: false, seat: null });

function host(now = { t: 1_000_000 }) {
  const sent: Array<[string, HostMsg]> = [];
  const h = new SpaceHost("sp1", "Campus", me("H"), { send: (fp, m) => sent.push([fp, m]), broadcast: (m) => sent.push(["*", m]) }, () => now.t);
  return { h, sent, now };
}

describe("campus map", () => {
  it("has reachable rooms, solid furniture and free seats", () => {
    expect(walkable(SPAWN.x, SPAWN.y)).toBe(true);
    expect(MAP.solid[0][0]).toBe(true);
    for (const t of TABLES) {
      expect(walkable(t.x, t.y)).toBe(false);
      for (const s of t.seats) {
        expect(walkable(s.x, s.y), `${s.id}`).toBe(true);
        expect(findPath(SPAWN, s), `path to ${s.id}`).not.toBeNull();
      }
    }
    expect(zoneAt(18, 17 - 1)).toBe("focus");
    expect(free(SPAWN.x, SPAWN.y)).toBe(true);
    expect(free(0, 0)).toBe(false);
  });

  it("finds the shortest route around walls", () => {
    const p = findPath({ x: 20, y: 12 }, { x: 20, y: 11 })!;
    expect(p).toEqual([{ x: 20, y: 11 }]);
    expect(findPath(SPAWN, { x: 0, y: 0 })).toBeNull();
    const into = findPath(SPAWN, { x: 5, y: 5 })!;
    expect(into.length).toBeGreaterThan(8);
    expect(into.every((c) => walkable(c.x, c.y))).toBe(true);
  });
});

describe("avatars", () => {
  it("round-trip and fall back on a stable look", () => {
    const l = { skin: 2, hair: 3, hairColor: 1, outfit: 4, outfitColor: 6, accessory: 2 };
    expect(decodeLook(encodeLook(l))).toEqual(l);
    expect(decodeLook("", "abc")).toEqual(lookFromSeed("abc"));
    expect(decodeLook("s99h1", "x").skin).toBe(lookFromSeed("x").skin);
  });
});

describe("messages", () => {
  it("are checked and cleaned", () => {
    expect(readClient({ t: "space.move", space: "s", x: 1, y: 2, dir: "left", moving: true })).toEqual({ t: "space.move", space: "s", x: 1, y: 2, dir: "left", moving: true });
    expect(readClient({ t: "space.move", space: "s", x: "1", y: 2, dir: "left" })).toBeNull();
    expect(readClient({ t: "space.move", space: "s", x: 1, y: 2, dir: "diag" })).toBeNull();
    expect(readClient({ t: "space.hack", space: "s" })).toBeNull();
    expect(readClient({ t: "space.ambience", space: "s", table: "x", sound: "techno" })).toBeNull();
    const table = readClient({ t: "space.table", space: "s", table: "cowork-a", jam: "https://evil.example/x" });
    expect(table && "jam" in table && table.jam).toBeFalsy();
    expect(validJam("https://open.spotify.com/socialsession/abc123")).toBe(true);
    expect(validJam("https://spotify.link/AbCd")).toBe(true);
    expect(validJam("http://open.spotify.com/socialsession/abc")).toBe(false);
    expect(validJam("https://open.spotify.com/track/abc")).toBe(false);
    const join = readClient({ t: "space.join", space: "s", v: 1, nick: "a\u0007b".repeat(20), avatar: "s1" });
    expect(join && join.t === "space.join" && join.nick.length).toBe(24);
  });
});

describe("host", () => {
  it("welcomes, refuses other versions and moves within the rules", () => {
    const { h, sent, now } = host();
    expect(h.handle("A", { t: "space.join", space: "sp1", v: 99, nick: "A", avatar: "", status: "" })).toBe(false);
    expect(sent.at(-1)?.[1].t).toBe("space.bye");
    expect(h.handle("A", { t: "space.join", space: "sp1", v: 1, nick: "A", avatar: "", status: "" })).toBe(true);
    expect(sent.some(([fp, m]) => fp === "A" && m.t === "space.welcome")).toBe(true);
    now.t += 200;
    expect(h.handle("A", { t: "space.move", space: "sp1", x: SPAWN.x + 1, y: SPAWN.y, dir: "right", moving: true })).toBe(true);
    now.t += 200;
    expect(h.handle("A", { t: "space.move", space: "sp1", x: SPAWN.x + 15, y: SPAWN.y, dir: "right", moving: true }), "teleport").toBe(false);
    now.t += 200;
    expect(h.handle("A", { t: "space.move", space: "sp1", x: SPAWN.x + 1, y: 10, dir: "up", moving: true }), "wall").toBe(false);
    expect(h.flushTicks().map((x) => x[0])).toEqual(["A"]);
    expect(h.handle("Z", { t: "space.move", space: "sp1", x: 1, y: 1, dir: "up", moving: true }), "not joined").toBe(false);
  });

  it("seats people, keeps reserved tables, shares goals, focus and ambience", () => {
    const { h, now } = host();
    for (const fp of ["A", "B"]) h.handle(fp, { t: "space.join", space: "sp1", v: 1, nick: fp, avatar: "", status: "" });
    const table = TABLES.find((t) => t.id === "focus-a")!;
    const [s0, s1, s2] = table.seats;
    // Walk next to the table first: sitting from across the map is refused.
    expect(h.handle("A", { t: "space.sit", space: "sp1", seat: s0.id })).toBe(false);
    h.state.players.A.x = s0.x;
    h.state.players.A.y = s0.y + 0.5;
    h.state.players.B.x = s1.x;
    h.state.players.B.y = s1.y;
    expect(h.handle("A", { t: "space.sit", space: "sp1", seat: s0.id })).toBe(true);
    expect(h.state.tables["focus-a"].owner).toBe("A");
    expect(h.handle("B", { t: "space.sit", space: "sp1", seat: s0.id }), "taken").toBe(false);
    expect(h.handle("A", { t: "space.table", space: "sp1", table: "focus-a", privacy: "reserved", topic: "my_ls" })).toBe(true);
    expect(h.handle("B", { t: "space.sit", space: "sp1", seat: s1.id }), "reserved").toBe(false);
    h.handle("A", { t: "space.table", space: "sp1", table: "focus-a", members: ["B"] });
    expect(h.handle("B", { t: "space.sit", space: "sp1", seat: s1.id })).toBe(true);
    expect(h.handle("B", { t: "space.table", space: "sp1", table: "focus-a", topic: "x" }), "not the owner").toBe(false);
    expect(h.handle("B", { t: "space.goal", space: "sp1", table: "focus-a", text: "finir le parsing", done: false })).toBe(true);
    expect(h.handle("B", { t: "space.focus", space: "sp1", table: "focus-a", action: "start", workMin: 25, breakMin: 5 })).toBe(true);
    expect(h.handle("A", { t: "space.ambience", space: "sp1", table: "focus-a", sound: "rain" })).toBe(true);
    expect(h.handle("A", { t: "space.goal", space: "sp1", table: "cowork-a", text: "x", done: false }), "other table").toBe(false);
    now.t += 25 * 60_000;
    h.tick();
    expect(h.state.tables["focus-a"].focus?.phase).toBe("break");
    now.t += 5 * 60_000;
    h.tick();
    expect(h.state.tables["focus-a"].focus).toMatchObject({ phase: "work", cycle: 2 });
    expect(s2).toBeDefined();
    // The table's board: opened by B, only B (or the owner) closes it, and it ends when B leaves.
    expect(h.handle("B", { t: "space.board", space: "sp1", table: "focus-a", board: { session: "b1@abc", name: "Archi" } })).toBe(true);
    expect(h.state.tables["focus-a"].board).toMatchObject({ host: "B", hostNick: "B", session: "b1@abc" });
    expect(h.handle("A", { t: "space.board", space: "sp1", table: "focus-a", board: { session: "b2@def", name: "x" } })).toBe(true);
    expect(h.state.tables["focus-a"].board?.host, "the owner may replace it").toBe("A");
    expect(h.handle("B", { t: "space.board", space: "sp1", table: "focus-a", board: null }), "not B's anymore").toBe(false);
    expect(readClient({ t: "space.board", space: "sp1", table: "focus-a", board: { session: "../x", name: "x" } }), "bad session").toBeNull();
    h.remove("A");
    expect(h.state.tables["focus-a"].board).toBeNull();
    h.handle("A", { t: "space.join", space: "sp1", v: 1, nick: "A", avatar: "", status: "" });
    // Everyone leaves: the table is free again.
    h.remove("A");
    h.remove("B");
    expect(h.state.tables["focus-a"].owner).toBeNull();
    expect(h.state.tables["focus-a"].focus).toBeNull();
    expect(Object.keys(h.state.players)).toEqual(["H"]);
  });
});

describe("table life (1.0)", () => {
  function seated() {
    const ctx = host();
    const { h } = ctx;
    for (const fp of ["A", "B"]) h.handle(fp, { t: "space.join", space: "sp1", v: 1, nick: fp, avatar: "", status: "" });
    const [s0, s1] = TABLES.find((t) => t.id === "focus-a")!.seats;
    Object.assign(h.state.players.A, { x: s0.x, y: s0.y });
    Object.assign(h.state.players.B, { x: s1.x, y: s1.y });
    h.handle("A", { t: "space.sit", space: "sp1", seat: s0.id });
    h.handle("B", { t: "space.sit", space: "sp1", seat: s1.id });
    return ctx;
  }

  it("lets anyone seated share a Jam, and only them or the owner change it", () => {
    const { h } = seated();
    const table = h.state.tables["focus-a"];
    table.owner = "A";
    const jam = "https://open.spotify.com/socialsession/abc123";
    // B is only a guest: sharing a Jam is allowed, changing the topic is not.
    expect(h.handle("B", { t: "space.table", space: "sp1", table: "focus-a", jam })).toBe(true);
    expect([table.jam, table.jamBy]).toEqual([jam, "B"]);
    expect(h.handle("B", { t: "space.table", space: "sp1", table: "focus-a", topic: "hack" })).toBe(false);
    // The owner may end it; then B's next Jam is B's again, and B ends it.
    expect(h.handle("A", { t: "space.table", space: "sp1", table: "focus-a", jam: null })).toBe(true);
    expect(h.handle("B", { t: "space.table", space: "sp1", table: "focus-a", jam })).toBe(true);
    expect(h.handle("B", { t: "space.table", space: "sp1", table: "focus-a", jam: null })).toBe(true);
    expect([table.jam, table.jamBy]).toEqual([null, null]);
    // A guest never replaces someone else's Jam.
    h.handle("A", { t: "space.table", space: "sp1", table: "focus-a", jam });
    expect(h.handle("B", { t: "space.table", space: "sp1", table: "focus-a", jam: null })).toBe(false);
  });

  it("moderates every public text on the host, and tells only the author", () => {
    const { h, sent } = seated();
    expect(h.handle("A", { t: "space.say", space: "sp1", table: "focus-a", text: "sale n3gre" })).toBe(false);
    expect(h.state.tables["focus-a"].chat ?? []).toHaveLength(0);
    const told = sent.filter(([, m]) => m.t === "space.refused");
    expect(told.map(([fp]) => fp)).toEqual(["A"]);
    expect(h.handle("A", { t: "space.goal", space: "sp1", table: "focus-a", text: "je vais te tuer", done: false })).toBe(false);
    // Swearing is fine.
    expect(h.handle("A", { t: "space.say", space: "sp1", table: "focus-a", text: "putain ce segfault" })).toBe(true);
    // A refused nickname still joins, under a neutral one.
    h.handle("C", { t: "space.join", space: "sp1", v: 1, nick: "tarlouze", avatar: "", status: "" });
    expect(h.state.players.C.nick).toBe("Invité");
  });

  it("keeps a short chat, rate-limits messages and reactions", () => {
    const { h, now } = seated();
    for (let i = 0; i < 60; i++) {
      now.t += 1000;
      h.handle("A", { t: "space.say", space: "sp1", table: "focus-a", text: `m${i}` });
    }
    const chat = h.state.tables["focus-a"].chat!;
    expect(chat).toHaveLength(50);
    expect(chat.at(-1)?.text).toBe("m59");
    expect(h.handle("A", { t: "space.say", space: "sp1", table: "focus-a", text: "trop vite" })).toBe(false);
    expect(h.handle("B", { t: "space.react", space: "sp1", react: "wave" })).toBe(true);
    expect(h.handle("B", { t: "space.react", space: "sp1", react: "clap" })).toBe(false);
    now.t += 2500;
    expect(h.handle("B", { t: "space.react", space: "sp1", react: "clap" })).toBe(true);
    expect(readClient({ t: "space.react", space: "sp1", react: "skull" })).toBeNull();
  });

  it("shares one listening per table, never anyone else's", () => {
    const { h, now } = seated();
    const music = { title: "Song", artist: "Band", art: null, playing: true, source: "mpris" as const, at: now.t };
    expect(h.handle("A", { t: "space.music", space: "sp1", table: "focus-a", music })).toBe(true);
    expect(h.state.tables["focus-a"].music?.byNick).toBe("A");
    // B cannot replace a fresh one, nor stop it (A owns the table and shares it).
    expect(h.handle("B", { t: "space.music", space: "sp1", table: "focus-a", music: { ...music, title: "Other" } })).toBe(false);
    expect(h.handle("B", { t: "space.music", space: "sp1", table: "focus-a", music: null })).toBe(false);
    expect(h.handle("A", { t: "space.music", space: "sp1", table: "focus-a", music: null })).toBe(true);
    // Covers must be small images; anything else is dropped.
    const read = readClient({ t: "space.music", space: "sp1", table: "focus-a", music: { ...music, art: "javascript:alert(1)" } });
    expect(read && read.t === "space.music" ? read.music?.art : "x").toBeNull();
  });
});
