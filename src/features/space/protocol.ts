// What TekSpace participants say to each other over TekBoard Connect, and the shared state.
// The host keeps the state; clients send intentions; everything received is checked.
import type { Dir } from "./map";

export const SPACE_VERSION = 1;
/** Position updates at most this often (ms), in both directions. */
export const MOVE_EVERY = 100;

export type Privacy = "open" | "reserved";
export type Sound = "rain" | "cafe" | "fire" | "forest" | "library" | "brown";
export const SOUNDS: Sound[] = ["rain", "cafe", "fire", "forest", "library", "brown"];

export interface Player {
  fp: string;
  nick: string;
  avatar: string;
  status: string;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  seat: string | null;
  /** A small reaction shown above the avatar for a few seconds. */
  react?: { e: Reaction; at: number } | null;
}

/** Small social signals, rate-limited by the host. */
export type Reaction = "wave" | "coffee" | "clap" | "fire" | "brain";
export const REACTIONS: Array<{ id: Reaction; emoji: string }> = [
  { id: "wave", emoji: "👋" },
  { id: "coffee", emoji: "☕" },
  { id: "clap", emoji: "👏" },
  { id: "fire", emoji: "🔥" },
  { id: "brain", emoji: "🧠" },
];

/** A line of the table's chat: kept by the host for the session only (never stored). */
export interface ChatLine {
  by: string;
  nick: string;
  text: string;
  at: number;
}

/** What someone at the table is listening to, read from their own player or account. It is
 * what they hear, not a synchronised playback. */
export interface Music {
  title: string;
  artist: string;
  /** Small cover as a data URL, when there is one. */
  art: string | null;
  playing: boolean;
  /** `mpris` (the desktop player) or `spotify` (their Spotify account). */
  source: "mpris" | "spotify";
  /** Unix ms of the reading. */
  at: number;
  by?: string;
  byNick?: string;
}

export interface Focus {
  phase: "work" | "break";
  /** Unix ms. */
  endsAt: number;
  workMin: number;
  breakMin: number;
  cycle: number;
  by: string;
}

export interface Pin {
  by: string;
  title: string;
  text: string;
  at: number;
}

export interface TableState {
  id: string;
  owner: string | null;
  privacy: Privacy;
  members: string[];
  topic: string;
  goals: Record<string, { text: string; done: boolean }>;
  focus: Focus | null;
  ambience: { sound: Sound; since: number } | null;
  jam: string | null;
  pins: Pin[];
  /** The table's whiteboard, hosted by one of the people seated there. */
  board: TableBoard | null;
  /** Chat of the session (last 50 lines, not stored). Absent from older hosts. */
  chat?: ChatLine[];
  /** Music shared at the table. Absent from older hosts. */
  music?: Music | null;
}

export interface TableBoard {
  session: string;
  name: string;
  host: string;
  hostNick: string;
}

export interface SpaceState {
  v: number;
  id: string;
  name: string;
  host: string;
  players: Record<string, Player>;
  tables: Record<string, TableState>;
}

/** Positions only: `[fp, x, y, dir, moving, seat]`. */
export type PlayerTick = [string, number, number, Dir, boolean, string | null];

export type ClientMsg =
  | { t: "space.join"; space: string; v: number; nick: string; avatar: string; status: string }
  | { t: "space.leave"; space: string }
  | { t: "space.move"; space: string; x: number; y: number; dir: Dir; moving: boolean }
  | { t: "space.sit"; space: string; seat: string }
  | { t: "space.stand"; space: string }
  | { t: "space.table"; space: string; table: string; topic?: string; privacy?: Privacy; members?: string[]; jam?: string | null }
  | { t: "space.goal"; space: string; table: string; text: string; done: boolean }
  | { t: "space.focus"; space: string; table: string; action: "start" | "stop"; workMin?: number; breakMin?: number }
  | { t: "space.ambience"; space: string; table: string; sound: Sound | null }
  | { t: "space.pin"; space: string; table: string; title: string; text: string }
  | { t: "space.unpin"; space: string; table: string; index: number }
  | { t: "space.board"; space: string; table: string; board: { session: string; name: string } | null }
  | { t: "space.profile"; space: string; nick: string; avatar: string; status: string }
  | { t: "space.say"; space: string; table: string; text: string }
  | { t: "space.react"; space: string; react: Reaction }
  | { t: "space.music"; space: string; table: string; music: Music | null };

export type HostMsg =
  | { t: "space.welcome"; state: SpaceState }
  | { t: "space.state"; state: SpaceState }
  | { t: "space.ticks"; space: string; players: PlayerTick[] }
  | { t: "space.bye"; space: string; reason: string }
  /** The host refused a text (moderation): said to its author only. */
  | { t: "space.refused"; space: string; reason: string };

export interface Announce {
  t: "space.announce";
  space: string;
  name: string;
  hostNick: string;
  count: number;
  v: number;
}

export interface Invite {
  t: "space.invite";
  space: string;
  name: string;
  hostNick: string;
}

const DIRS: Dir[] = ["down", "up", "left", "right"];

export const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").slice(0, max) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A Spotify Jam invitation link (no other site): open.spotify.com/socialsession/… or spotify.link/…. */
export function validJam(url: string): boolean {
  // Same rule as the backend (`commands_connect::valid_jam`), which is the one that opens it.
  return url.length <= 300 && (/^https:\/\/open\.spotify\.com\/socialsession\/[A-Za-z0-9_-]+(\?[A-Za-z0-9=&_-]*)?$/.test(url) || /^https:\/\/spotify\.link\/[A-Za-z0-9_-]+$/.test(url));
}

/** A message from a client, checked and cleaned; `null` when it does not make sense. */
export function readClient(raw: Record<string, unknown>): ClientMsg | null {
  const t = raw.t;
  const space = clip(raw.space, 64);
  if (!space) return null;
  switch (t) {
    case "space.join":
      return { t, space, v: num(raw.v) ?? 0, nick: clip(raw.nick, 24) || "?", avatar: clip(raw.avatar, 48), status: clip(raw.status, 16) };
    case "space.leave":
    case "space.stand":
      return { t, space };
    case "space.move": {
      const x = num(raw.x);
      const y = num(raw.y);
      const dir = DIRS.includes(raw.dir as Dir) ? (raw.dir as Dir) : null;
      return x === null || y === null || !dir ? null : { t, space, x, y, dir, moving: raw.moving === true };
    }
    case "space.sit":
      return typeof raw.seat === "string" ? { t, space, seat: clip(raw.seat, 32) } : null;
    case "space.table": {
      const table = clip(raw.table, 32);
      if (!table) return null;
      const out: ClientMsg = { t, space, table };
      if (typeof raw.topic === "string") out.topic = clip(raw.topic, 120);
      if (raw.privacy === "open" || raw.privacy === "reserved") out.privacy = raw.privacy;
      if (Array.isArray(raw.members)) out.members = raw.members.filter((m): m is string => typeof m === "string").map((m) => m.slice(0, 64)).slice(0, 32);
      if (raw.jam === null || (typeof raw.jam === "string" && (raw.jam === "" || validJam(raw.jam)))) out.jam = raw.jam ? (raw.jam as string) : null;
      return out;
    }
    case "space.goal":
      return { t, space, table: clip(raw.table, 32), text: clip(raw.text, 140), done: raw.done === true };
    case "space.focus": {
      const action = raw.action === "start" || raw.action === "stop" ? raw.action : null;
      if (!action) return null;
      const workMin = Math.min(120, Math.max(5, Math.round(num(raw.workMin) ?? 25)));
      const breakMin = Math.min(30, Math.max(1, Math.round(num(raw.breakMin) ?? 5)));
      return { t, space, table: clip(raw.table, 32), action, workMin, breakMin };
    }
    case "space.ambience": {
      const sound = raw.sound === null ? null : SOUNDS.includes(raw.sound as Sound) ? (raw.sound as Sound) : undefined;
      return sound === undefined ? null : { t, space, table: clip(raw.table, 32), sound };
    }
    case "space.pin":
      return { t, space, table: clip(raw.table, 32), title: clip(raw.title, 80) || "Note", text: clip(raw.text, 2000) };
    case "space.unpin":
      return { t, space, table: clip(raw.table, 32), index: Math.max(0, Math.floor(num(raw.index) ?? -1)) };
    case "space.board": {
      const table = clip(raw.table, 32);
      if (!table) return null;
      if (raw.board === null) return { t, space, table, board: null };
      const b = raw.board as Record<string, unknown> | undefined;
      const session = clip(b?.session, 120);
      return session && /^[\w-]+@[\w-]+$/.test(session) ? { t, space, table, board: { session, name: clip(b?.name, 80) || "Tableau" } } : null;
    }
    case "space.profile":
      return { t, space, nick: clip(raw.nick, 24) || "?", avatar: clip(raw.avatar, 48), status: clip(raw.status, 16) };
    case "space.say": {
      const text = clip(raw.text, 300).trim();
      return text ? { t, space, table: clip(raw.table, 32), text } : null;
    }
    case "space.react":
      return REACTIONS.some((r) => r.id === raw.react) ? { t, space, react: raw.react as Reaction } : null;
    case "space.music": {
      const table = clip(raw.table, 32);
      if (!table) return null;
      if (raw.music === null) return { t, space, table, music: null };
      const m = raw.music as Record<string, unknown> | undefined;
      const title = clip(m?.title, 120).trim();
      if (!title || (m?.source !== "mpris" && m?.source !== "spotify")) return null;
      const art = typeof m?.art === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(m.art) && m.art.length <= 200_000 ? m.art : null;
      return { t, space, table, music: { title, artist: clip(m?.artist, 120), art, playing: m?.playing === true, source: m.source, at: num(m?.at) ?? 0 } };
    }
    default:
      return null;
  }
}
