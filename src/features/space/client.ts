// The TekSpace session seen from this window: hosting one (the authoritative SpaceHost runs
// here) or joined to someone else's. Messages travel through TekBoard Connect.
import { create } from "zustand";
import { api } from "../../lib/api";
import { SpaceHost, type Transport } from "./host";
import { MOVE_EVERY, readClient, SPACE_VERSION, type ClientMsg, type HostMsg, type Player, type SpaceState } from "./protocol";
import type { Dir } from "./map";
import { useSpaceLobby } from "./lobby";
import { t } from "../../lib/i18n";

type Mode = "idle" | "hosting" | "joining" | "joined";

interface Me {
  fp: string;
  nick: string;
  avatar: string;
  status: string;
}

interface SpaceStore {
  mode: Mode;
  space: SpaceState | null;
  me: Me | null;
  /** Host of the space we are in (ours when hosting). */
  hostFp: string | null;
  error: string | null;
  /** Bumped on every change, for the screen to refresh. */
  version: number;
}

export const useSpace = create<SpaceStore>(() => ({ mode: "idle", space: null, me: null, hostFp: null, error: null, version: 0 }));

let host: SpaceHost | null = null;
let timers: number[] = [];
let lastSent = 0;
let pendingMove: ClientMsg | null = null;
/** Paired contacts online, to announce our space to (refreshed by the screen). */
let audience: () => string[] = () => [];

function bump(patch: Partial<SpaceStore> = {}) {
  useSpace.setState((s) => ({ ...patch, version: s.version + 1 }));
}

function participants(): string[] {
  const s = useSpace.getState();
  return Object.keys(s.space?.players ?? {}).filter((fp) => fp !== s.me?.fp);
}

function clearTimers() {
  timers.forEach((id) => window.clearInterval(id));
  timers = [];
}

export function setAudience(f: () => string[]) {
  audience = f;
}

function announce() {
  const s = useSpace.getState();
  if (s.mode !== "hosting" || !host || !s.me) return;
  const fps = audience();
  if (fps.length) void api.sessionBroadcast(fps, { t: "space.announce", space: host.state.id, name: host.state.name, hostNick: s.me.nick, count: host.count, v: SPACE_VERSION }).catch(() => undefined);
}

export function startHosting(me: Me, name: string) {
  leave();
  const id = `${me.fp.slice(0, 8)}-${Date.now().toString(36)}`;
  const transport: Transport = {
    send: (fp, msg) => {
      if (fp === me.fp) return applyHost(msg);
      void api.sessionSend(fp, msg as unknown as Record<string, unknown>).catch(() => undefined);
    },
    broadcast: (msg, except) => {
      applyHost(msg);
      const to = Object.keys(host?.state.players ?? {}).filter((fp) => fp !== me.fp && fp !== except);
      if (to.length) void api.sessionBroadcast(to, msg as unknown as Record<string, unknown>).catch(() => undefined);
    },
  };
  const self: Player = { fp: me.fp, nick: me.nick, avatar: me.avatar, status: me.status, x: 0, y: 0, dir: "down", moving: false, seat: null };
  host = new SpaceHost(id, name.trim().slice(0, 60) || t("Espace de {n}", { n: me.nick }), self, transport);
  bump({ mode: "hosting", me, hostFp: me.fp, space: host.state, error: null });
  timers.push(window.setInterval(() => host?.flushTicks(), MOVE_EVERY));
  timers.push(window.setInterval(() => host?.tick(), 1000));
  timers.push(window.setInterval(announce, 30_000));
  announce();
}

/** The host's own view follows its state directly. */
function applyHost(msg: HostMsg) {
  if (msg.t === "space.ticks" || msg.t === "space.state" || msg.t === "space.welcome") bump({ space: host?.state ?? null });
}

export function join(me: Me, space: string, hostFp: string) {
  leave();
  bump({ mode: "joining", me, hostFp, space: null, error: null });
  void api.sessionSend(hostFp, { t: "space.join", space, v: SPACE_VERSION, nick: me.nick, avatar: me.avatar, status: me.status }).catch((e) => bump({ mode: "idle", error: String((e as { message?: string }).message ?? e) }));
  // No answer: the host left or the network drops the messages.
  window.setTimeout(() => {
    if (useSpace.getState().mode === "joining") bump({ mode: "idle", error: t("L'hôte ne répond pas : l'espace est peut-être fermé.") });
  }, 8000);
}

export function send(msg: ClientMsg) {
  const s = useSpace.getState();
  if (s.mode === "hosting" && host && s.me) {
    host.handle(s.me.fp, msg);
    if (msg.t !== "space.move") bump({ space: host.state });
    return;
  }
  if (s.mode === "joined" && s.hostFp) void api.sessionSend(s.hostFp, msg as unknown as Record<string, unknown>).catch(() => undefined);
}

/** Local movement, sent at most every MOVE_EVERY ms (the last one always goes out). */
export function moveLocal(x: number, y: number, dir: Dir, moving: boolean) {
  const s = useSpace.getState();
  if (!s.space || !s.me) return;
  const me = s.space.players[s.me.fp];
  if (me) Object.assign(me, { x, y, dir, moving });
  pendingMove = { t: "space.move", space: s.space.id, x, y, dir, moving };
  const now = Date.now();
  if (now - lastSent >= MOVE_EVERY || !moving) {
    lastSent = now;
    send(pendingMove);
    pendingMove = null;
  }
}

export function leave(reason?: string) {
  const s = useSpace.getState();
  if (s.mode === "hosting" && host) {
    const fps = participants();
    if (fps.length) void api.sessionBroadcast(fps, { t: "space.bye", space: host.state.id, reason: t("l'hôte a fermé l'espace") }).catch(() => undefined);
  } else if ((s.mode === "joined" || s.mode === "joining") && s.hostFp && s.space) {
    void api.sessionSend(s.hostFp, { t: "space.leave", space: s.space.id }).catch(() => undefined);
  }
  clearTimers();
  host = null;
  bump({ mode: "idle", space: null, hostFp: null, error: reason ?? null });
}

/** Messages from Connect (registered with the lobby while TekSpace is loaded). */
export function incoming(from: string, raw: Record<string, unknown>) {
  const s = useSpace.getState();
  if (s.mode === "hosting" && host) {
    if (raw.t === "connect.gone") return host.remove(from);
    const msg = readClient(raw);
    if (msg) host.handle(from, msg);
    return;
  }
  if (from !== s.hostFp) return;
  if (raw.t === "connect.gone") return leave(t("Connexion perdue avec l'hôte."));
  const msg = raw as unknown as HostMsg;
  switch (msg.t) {
    case "space.welcome":
    case "space.state":
      if (msg.state && typeof msg.state === "object" && msg.state.v === SPACE_VERSION) {
        // Keep our own position: the host's copy may be a step behind.
        const mine = s.me && s.space?.players[s.me.fp];
        const next = msg.state;
        if (mine && next.players[mine.fp] && !next.players[mine.fp].seat && !mine.seat) Object.assign(next.players[mine.fp], { x: mine.x, y: mine.y, dir: mine.dir });
        bump({ mode: "joined", space: next });
      }
      break;
    case "space.ticks":
      if (!s.space || !Array.isArray(msg.players)) break;
      for (const tick of msg.players) {
        const [fp, x, y, dir, moving, seat] = tick;
        const p = s.space.players[fp];
        if (!p || typeof x !== "number" || typeof y !== "number") continue;
        // Our own position only comes back when the host refused a move.
        if (fp === s.me?.fp && Math.hypot(p.x - x, p.y - y) < 1.5) continue;
        Object.assign(p, { x, y, dir, moving, seat });
      }
      bump();
      break;
    case "space.bye":
      leave(t("Tu as quitté l'espace : {r}", { r: String(msg.reason ?? "") }));
      break;
  }
}

// From the first visit to TekSpace on, its messages come here, even while another screen
// is shown: a hosted space keeps running in the background (without drawing anything).
useSpaceLobby.setState({ handler: incoming });
