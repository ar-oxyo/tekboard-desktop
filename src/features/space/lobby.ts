// Always loaded (it is tiny): spaces announced by contacts and invitations, kept until the
// TekSpace screen opens. Other TekSpace messages go to the space engine once it is loaded.
import { onSession } from "../../lib/sessionBus";
import { create } from "zustand";
import { useUi } from "../../lib/store";
import { t } from "../../lib/i18n";

export interface Hosted {
  space: string;
  name: string;
  hostNick: string;
  count: number;
  v: number;
  host: string;
  at: number;
}

interface Lobby {
  spaces: Record<string, Hosted>;
  invites: Hosted[];
  /** Set by the space engine while it is loaded. */
  handler: ((from: string, msg: Record<string, unknown>) => void) | null;
}

export const useSpaceLobby = create<Lobby>(() => ({ spaces: {}, invites: [], handler: null }));

/** Announces older than this are forgotten (hosts repeat them every 30 s). */
export const ANNOUNCE_TTL = 90_000;

export function liveSpaces(spaces: Record<string, Hosted>, now: number): Hosted[] {
  return Object.values(spaces).filter((s) => now - s.at < ANNOUNCE_TTL).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function handleSpace(from: string, msg: Record<string, unknown>) {
  const tp = msg.t;
  if (tp === "space.announce" || tp === "space.invite") {
    const h: Hosted = { space: String(msg.space ?? "").slice(0, 64), name: String(msg.name ?? "").slice(0, 60), hostNick: String(msg.hostNick ?? "").slice(0, 24), count: Number(msg.count ?? 0) || 0, v: Number(msg.v ?? 1) || 1, host: from, at: Date.now() };
    if (!h.space) return;
    if (tp === "space.announce") useSpaceLobby.setState((s) => ({ spaces: { ...s.spaces, [h.space]: h } }));
    else {
      useSpaceLobby.setState((s) => ({ invites: [...s.invites.filter((i) => i.space !== h.space), h], spaces: { ...s.spaces, [h.space]: h } }));
      useUi.getState().toast({ kind: "info", title: t("{n} t'invite dans « {s} »", { n: h.hostNick, s: h.name }), detail: t("Un espace TekSpace, pour travailler ensemble."), action: { label: t("Voir"), run: () => useUi.getState().setPage("space") } });
    }
  }
  useSpaceLobby.getState().handler?.(from, msg);
}

onSession("space.", handleSpace);
