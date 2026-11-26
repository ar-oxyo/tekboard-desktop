// Development only: puts the demo profile at a TekSpace table with company, chat, shared
// music, a focus timer and goals (?page=space&space=demo), to look at the table panel.
import { useSpace } from "../features/space/client";
import { emptyTable } from "../features/space/host";
import { TABLES } from "../features/space/map";
import type { Player, SpaceState } from "../features/space/protocol";
import { encodeLook } from "../features/space/avatar";
import { AVATAR_PRESETS } from "../features/space/avatars";

export function seedSpace() {
  const now = Date.now();
  const def = TABLES.find((t) => t.id === "focus-a") ?? TABLES[0];
  const me = "a1b2c3d4e5f60718";
  const p = (fp: string, nick: string, i: number, seat: number, status = "coding"): Player => ({ fp, nick, avatar: encodeLook(AVATAR_PRESETS[i]), status, x: def.seats[seat].x, y: def.seats[seat].y, dir: def.seats[seat].dir, moving: false, seat: def.seats[seat].id, react: i === 3 ? { e: "coffee", at: now } : null });
  const table = { ...emptyTable(def.id), owner: me, topic: "secured · tables de hachage", focus: { phase: "work" as const, endsAt: now + 18 * 60_000, workMin: 25, breakMin: 5, cycle: 2, by: me }, music: { title: "Midnight City", artist: "M83", art: null, playing: true, source: "mpris" as const, at: now, by: "f00dbabe00112233", byNick: "Léo" }, chat: [{ by: "f00dbabe00112233", nick: "Léo", text: "quelqu'un a compris le rehash ?", at: now - 120_000 }, { by: me, nick: "Camille", text: "oui : double la taille et réinsère tout", at: now - 60_000 }], goals: { [me]: { text: "finir ht_delete", done: false }, f00dbabe00112233: { text: "tests de collisions", done: true } } };
  const space: SpaceState = { v: 1, id: "demo", name: "Campus de Camille", host: me, players: { [me]: p(me, "Camille", 0, 0, "available"), f00dbabe00112233: p("f00dbabe00112233", "Léo", 3, 1) }, tables: Object.fromEntries(TABLES.map((t) => [t.id, t.id === def.id ? table : emptyTable(t.id)])) };
  useSpace.setState({ mode: "joined", space, me: { fp: me, nick: "Camille", avatar: "", status: "available" } as never, hostFp: "f00dbabe00112233", error: null, version: 1 });
}
