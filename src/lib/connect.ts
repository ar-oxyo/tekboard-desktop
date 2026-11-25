// TekBoard Connect on the screen side: the live state (pushed by the backend with
// `connect-state`), status words and colours, and how people are grouped.
import { listen } from "@tauri-apps/api/event";
import type { QueryClient } from "@tanstack/react-query";
import type { ConnectState, ConnectStatus, PeerView } from "./api";
import { t } from "./i18n";

export const CONNECT_KEY = ["connect"] as const;

export const STATUS: Record<ConnectStatus, { label: string; tone: "ok" | "warn" | "danger" | "info" | "accent" | "neutral" }> = {
  available: { label: t("Disponible"), tone: "ok" },
  coding: { label: t("En train de coder"), tone: "accent" },
  session: { label: t("En session de travail"), tone: "info" },
  dnd: { label: t("Ne pas déranger"), tone: "danger" },
  invisible: { label: t("Invisible"), tone: "neutral" },
  helping: { label: t("Disponible pour aider"), tone: "warn" },
  offline: { label: t("Hors ligne"), tone: "neutral" },
};

export const CHOOSABLE: ConnectStatus[] = ["available", "coding", "session", "helping", "dnd", "invisible"];

/** Keeps the cached state in step with the backend; returns the unlisten promise. */
export function listenConnect(qc: QueryClient) {
  return listen<ConnectState>("connect-state", (e) => qc.setQueryData(CONNECT_KEY, e.payload));
}

export interface PeopleGroups {
  online: PeerView[];
  nearby: PeerView[];
  offline: PeerView[];
  blocked: PeerView[];
}

/** Paired and connected first, then devices seen nearby, then paired but away. Invisible people
 *  are shown as away: they asked not to appear. */
export function groupPeople(peers: PeerView[]): PeopleGroups {
  const g: PeopleGroups = { online: [], nearby: [], offline: [], blocked: [] };
  for (const p of peers) {
    if (p.blocked) g.blocked.push(p);
    else if (p.trusted && p.online && p.profile.status !== "invisible") g.online.push(p);
    else if (!p.trusted && p.discovered) g.nearby.push(p);
    else if (p.trusted) g.offline.push(p);
  }
  const byName = (a: PeerView, b: PeerView) => a.profile.nick.localeCompare(b.profile.nick);
  g.online.sort(byName);
  g.nearby.sort(byName);
  g.offline.sort(byName);
  return g;
}

/** Looks like an invitation code or an address someone pasted. */
export function looksLikeTarget(text: string): boolean {
  const s = text.trim();
  return /^tb1:[^\s]+:\d{1,5}:[0-9a-f]{64}$/.test(s) || /^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(s) || /^\[[0-9a-f:]+\]:\d{1,5}$/i.test(s);
}
