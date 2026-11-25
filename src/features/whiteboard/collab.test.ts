import { afterEach, describe, expect, it, vi } from "vitest";

// Messages between the two sessions go through this fake Connect.
const routes = new Map<string, (from: string, msg: Record<string, unknown>) => void>();
let sender = "";
vi.mock("../../lib/api", () => ({
  api: {
    sessionSend: async (fp: string, msg: Record<string, unknown>) => routes.get(fp)?.(sender, JSON.parse(JSON.stringify(msg))),
    sessionBroadcast: async (fps: string[], msg: Record<string, unknown>) => {
      for (const fp of fps) routes.get(fp)?.(sender, JSON.parse(JSON.stringify(msg)));
      return fps.length;
    },
  },
}));
vi.mock("../../lib/store", () => ({ useUi: { getState: () => ({ toast: () => undefined, setPage: () => undefined }) } }));

import { BoardSession, chunks, type SceneAdapter, type SessionState } from "./collab";
import type { BoardFile } from "../../lib/api";

function scene(initial: Array<{ id: string; version: number; type: string; fileId?: string; customData?: Record<string, unknown> }> = []) {
  const els = new Map(initial.map((e) => [e.id, { ...e }]));
  const files: Record<string, BoardFile> = {};
  const s: SceneAdapter & { els: typeof els; filesMap: typeof files } = {
    els,
    filesMap: files,
    elements: () => [...els.values()],
    apply: (remote) => {
      for (const r of remote) {
        const cur = els.get(String(r.id));
        if (!cur || cur.version < Number(r.version)) els.set(String(r.id), r as never);
      }
    },
    files: () => files,
    addFiles: (fs) => fs.forEach((f) => (files[f.id] = f)),
    setView: () => undefined,
  };
  return s;
}

const flush = () => new Promise((r) => setTimeout(r, 150));

/** Routes messages to `fp`, which answers as itself while it handles them. */
function route(fp: string, handle: (from: string, msg: Record<string, unknown>) => void) {
  routes.set(fp, (from, msg) => {
    const prev = sender;
    sender = fp;
    handle(from, msg);
    sender = prev;
  });
}

afterEach(() => routes.clear());

describe("board collaboration", () => {
  it("syncs elements both ways, enforces permissions and refuses strangers", async () => {
    const hostScene = scene([{ id: "r1", version: 3, type: "rectangle" }, { id: "img", version: 1, type: "image", fileId: "f1" }]);
    hostScene.addFiles([{ id: "f1", mimeType: "image/png", dataURL: "data:image/png;base64," + "A".repeat(400_000) }]);
    let hostState: SessionState | null = null;
    const host = BoardSession.host("b1", "Archi", { fp: "H", nick: "Hôte" }, hostScene, (s) => (hostState = s));
    route("H", (from, msg) => host.incoming(from, msg));
    // A stranger is refused.
    const stranger: Array<Record<string, unknown>> = [];
    route("X", (_f, m) => stranger.push(m));
    sender = "X";
    host.incoming("X", { t: "board.join", session: host.state.session, nick: "x" });
    await flush();
    expect(stranger.at(-1)?.t).toBe("board.bye");

    // The invited guest joins and gets everything, images included (in several parts).
    const guestScene = scene();
    sender = "H";
    host.invite("G", "Hôte");
    let guestState: SessionState | null = null;
    sender = "G";
    const guest = BoardSession.join({ host: "H", session: host.state.session, name: "Archi", hostNick: "Hôte", at: 0 }, { fp: "G", nick: "Lea" }, guestScene, (s) => (guestState = s));
    route("G", (from, msg) => guest.incoming(from, msg));
    sender = "G";
    // The join message went out before the route existed: send it again.
    guest.rejoin();
    await flush();
    sender = "H";
    await flush();
    expect(guestState!.mode).toBe("edit");
    expect(guestScene.els.get("r1")?.version).toBe(3);
    expect(guestScene.filesMap.f1?.dataURL.length).toBe(hostScene.filesMap.f1.dataURL.length);
    expect(hostState!.participants.map((p) => p.fp)).toEqual(["H", "G"]);

    // The guest draws: the host gets it.
    guestScene.els.set("t1", { id: "t1", version: 1, type: "text" });
    sender = "G";
    guest.localChanged();
    await flush();
    expect(hostScene.els.has("t1")).toBe(true);

    // View only: further drawings are refused by the host.
    sender = "H";
    host.setMode("G", "view");
    await flush();
    expect(guestState!.mode).toBe("view");
    guestScene.els.set("t2", { id: "t2", version: 1, type: "text" });
    sender = "G";
    guest.localChanged();
    await flush();
    expect(hostScene.els.has("t2")).toBe(false);

    // Cursors reach the others; a lost host is noticed.
    sender = "H";
    host.pointer(10, 20, "pointer", []);
    await flush();
    expect(guestState!.pointers[0]).toMatchObject({ fp: "H", x: 10, y: 20 });
    guest.incoming("H", { t: "connect.gone" });
    expect(guestState!.lost).toBe(true);
    host.leave();
  });

  it("keeps Artix proposals local, and notices a host that never answers", async () => {
    vi.useFakeTimers();
    try {
      const hostScene = scene([{ id: "a", version: 1, type: "rectangle" }]);
      const host = BoardSession.host("b2", "B", { fp: "H", nick: "H" }, hostScene, () => undefined);
      const got: Array<Record<string, unknown>> = [];
      route("G", (_f, m) => got.push(m));
      route("H", (from, msg) => host.incoming(from, msg));
      host.invite("G", "H");
      sender = "G";
      host.incoming("G", { t: "board.join", session: host.state.session, nick: "g" });
      got.length = 0;
      hostScene.els.set("p", { id: "p", version: 1, type: "rectangle", customData: { tekPreview: true } } as never);
      hostScene.els.set("k", { id: "k", version: 1, type: "rectangle" });
      host.localChanged();
      await vi.advanceTimersByTimeAsync(200);
      const sent = got.filter((m) => m.t === "board.ops").flatMap((m) => m.elements as Array<{ id: string }>).map((e) => e.id);
      expect(sent).toEqual(["k"]);
      host.leave();

      // Nobody answers the join: after a while the guest is told.
      let st: SessionState | null = null;
      routes.clear();
      const guest = BoardSession.join({ host: "Z", session: "s@Z", name: "x", hostNick: "z", at: 0 }, { fp: "G", nick: "g" }, scene(), (s) => (st = s));
      expect(st!.waiting).toBe(true);
      await vi.advanceTimersByTimeAsync(11_000);
      expect(st!.lost).toBe(true);
      expect(st!.waiting).toBe(false);
      guest.leave();
    } finally {
      vi.useRealTimers();
    }
  });

  it("splits large updates under the message limit", () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, version: 1, text: "x".repeat(10_000) }));
    const parts = chunks(big, 60_000);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.flat()).toHaveLength(50);
    expect(parts.every((p) => JSON.stringify(p).length < 70_000)).toBe(true);
    // Counted in bytes: accented or CJK text takes more room than its length says.
    const wide = Array.from({ length: 20 }, (_, i) => ({ id: `w${i}`, version: 1, text: "漢".repeat(10_000) }));
    expect(chunks(wide, 60_000).every((p) => new TextEncoder().encode(JSON.stringify(p)).length < 70_000)).toBe(true);
  });
});
