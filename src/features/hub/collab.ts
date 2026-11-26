// Projet HUB shared through Connect (paired devices on the same network, no server). The
// owner's device is the reference: it checks the role of every device that writes to it
// (`hub_member_role`, in Rust) before answering or applying anything, and sends members a
// snapshot without local paths or fingerprints. A member keeps a copy (`hub_import`) and only
// accepts one it asked for (an accepted invitation, a refresh) from the device that owns it.
//
//   owner → member  hub.invite  { id, name, role, owner }
//   member → owner  hub.join    { id }                       (accept, or refresh a copy)
//   owner → member  hub.state   { id, role, owner, snapshot } | hub.denied { id }
//   editor → owner  hub.op      { id, op: { add: item } | { toggle: { title, done } } }
import { create } from "zustand";
import { api, type HubProject } from "../../lib/api";
import { t } from "../../lib/i18n";
import { onSession } from "../../lib/sessionBus";
import { useUi } from "../../lib/store";

export interface HubInvite {
  from: string;
  id: number;
  name: string;
  role: "editor" | "viewer";
  owner: string;
  at: number;
}

/** Invitations received while TekBoard is open (they are not kept: the owner can send again). */
export const useHubInvites = create<{ invites: HubInvite[]; drop: (i: HubInvite) => void }>((set) => ({
  invites: [],
  drop: (i) => set((s) => ({ invites: s.invites.filter((x) => !(x.from === i.from && x.id === i.id)) })),
}));

const asked = new Set<string>();
const keyOf = (fp: string, id: number) => `${fp}#${id}`;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const role = (v: unknown) => (v === "editor" || v === "viewer" ? v : null);

let nick: string | null = null;
async function myNick(): Promise<string> {
  if (nick) return nick;
  nick = (await api.connectState()).profile.nick || t("Quelqu'un");
  return nick;
}

const send = (fp: string, msg: Record<string, unknown>) => api.sessionSend(fp, msg).catch(() => undefined);

/** One of my projects changed: its members that are online get the new state. */
export async function broadcast(id: number): Promise<number> {
  const detail = await api.hubGet(id);
  if (detail.project.role !== "owner") return 0;
  const members = detail.items.filter((i) => i.kind === "member" && i.url);
  if (!members.length) return 0;
  const snapshot = await api.hubSnapshot(id);
  const owner = await myNick();
  await Promise.all(members.map((m) => send(m.url!, { t: "hub.state", id, role: m.role ?? "viewer", owner, snapshot })));
  return members.length;
}

/** Adds a paired device as a member and sends it the invitation. */
export async function invite(project: HubProject, fp: string, memberNick: string, memberRole: "editor" | "viewer") {
  await api.hubItemSave({ projectId: project.id, kind: "member", title: memberNick, url: fp, role: memberRole });
  await api.sessionSend(fp, { t: "hub.invite", id: project.id, name: project.name, role: memberRole, owner: await myNick() });
}

/** Accepts an invitation: asks the owner's device for the project. */
export async function accept(i: HubInvite) {
  asked.add(keyOf(i.from, i.id));
  useHubInvites.getState().drop(i);
  await api.sessionSend(i.from, { t: "hub.join", id: i.id });
}

/** Asks the owner's device for the latest state of a copy. */
export async function refresh(copy: HubProject): Promise<boolean> {
  if (!copy.owner || copy.remoteId === null) return false;
  asked.add(keyOf(copy.owner, copy.remoteId));
  try {
    await api.sessionSend(copy.owner, { t: "hub.join", id: copy.remoteId });
    return true;
  } catch {
    return false;
  }
}

export type HubOp = { add: { kind: "milestone" | "link" | "log" | "decision"; title: string; body?: string; url?: string | null; dueDay?: string | null } } | { toggle: { title: string; done: boolean } };

/** An editor's change, sent to the owner's device, which applies it if the role allows it. */
export async function propose(copy: HubProject, op: HubOp) {
  if (!copy.owner || copy.remoteId === null) throw new Error(t("Copie sans propriétaire"));
  asked.add(keyOf(copy.owner, copy.remoteId));
  await api.sessionSend(copy.owner, { t: "hub.op", id: copy.remoteId, op: { ...op, author: await myNick() } });
}

async function handle(from: string, msg: Record<string, unknown>) {
  const id = Number(msg.id);
  if (msg.t !== "connect.gone" && !Number.isInteger(id)) return;
  switch (msg.t) {
    case "hub.invite": {
      const r = role(msg.role);
      const name = str(msg.name, 120);
      if (!r || !name) return;
      const inv: HubInvite = { from, id, name, role: r, owner: str(msg.owner, 60) || t("Quelqu'un"), at: Date.now() };
      useHubInvites.setState((s) => ({ invites: [...s.invites.filter((x) => !(x.from === from && x.id === id)), inv] }));
      useUi.getState().toast({ kind: "info", title: t("{who} t'invite dans le projet HUB « {name} »", { who: inv.owner, name }), action: { label: t("Voir"), run: () => useUi.getState().setPage("hub") } });
      return;
    }
    case "hub.join": {
      // Answered only to a member of one of my projects, with its own role.
      const r = await api.hubMemberRole(id, from).catch(() => null);
      if (!r) return void send(from, { t: "hub.denied", id });
      return void send(from, { t: "hub.state", id, role: r, owner: await myNick(), snapshot: await api.hubSnapshot(id) });
    }
    case "hub.state": {
      const k = keyOf(from, id);
      const r = role(msg.role);
      const known = (await api.hubList().catch(() => [])).some((x) => x.project.owner === from && x.project.remoteId === id);
      if (!r || !(asked.has(k) || known) || !msg.snapshot || typeof msg.snapshot !== "object") return;
      const first = !known;
      const copy = await api.hubImport(from, str(msg.owner, 60), id, r, msg.snapshot as Record<string, unknown>);
      asked.delete(k);
      if (first) useUi.getState().toast({ kind: "ok", title: t("Projet HUB partagé : {n}", { n: copy.name }), detail: r === "editor" ? t("Tu peux y ajouter des jalons, des liens et des entrées de journal.") : t("En lecture seule.") });
      return;
    }
    case "hub.denied": {
      asked.delete(keyOf(from, id));
      useUi.getState().toast({ kind: "error", title: t("Accès refusé à ce projet HUB"), detail: t("Son propriétaire t'a retiré des membres, ou le projet n'existe plus.") });
      return;
    }
    case "hub.op": {
      if ((await api.hubMemberRole(id, from).catch(() => null)) !== "editor") return;
      const op = msg.op as Record<string, unknown> | undefined;
      const author = str(op?.author, 60) || null;
      const add = op?.add as Record<string, unknown> | undefined;
      const toggle = op?.toggle as Record<string, unknown> | undefined;
      try {
        if (add && ["milestone", "link", "log", "decision"].includes(String(add.kind))) {
          await api.hubItemSave({ projectId: id, kind: add.kind as "milestone", title: str(add.title, 200), body: str(add.body, 8000), url: str(add.url, 2000) || null, dueDay: str(add.dueDay, 10) || null, author });
        } else if (toggle) {
          const detail = await api.hubGet(id);
          const m = detail.items.find((i) => i.kind === "milestone" && i.title === str(toggle.title, 200));
          if (m) await api.hubItemSave({ ...m, done: toggle.done === true });
        } else return;
        await broadcast(id);
      } catch {
        /* an invalid change is ignored; the member keeps the owner's state */
      }
      return;
    }
  }
}

onSession("hub.", (from, msg) => void handle(from, msg));
