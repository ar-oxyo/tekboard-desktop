// TekBoard Connect: people around you on the same network, by choice only. Turning it on,
// a pseudonym and a status, pairing with a code you both check, contacts you trust or
// block, an invitation code when discovery does not work, and what the network allows.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Copy, Link2, Network, Radar, ShieldCheck, Trash2, UserPlus, Wifi, WifiOff, X } from "lucide-react";
import { api, asAppError, type ConnectConfig, type ConnectDiagnosis, type ConnectState, type ConnectStatus, type PairRequest, type PeerView } from "../../lib/api";
import { CHOOSABLE, CONNECT_KEY, groupPeople, looksLikeTarget, STATUS } from "../../lib/connect";
import { useUi } from "../../lib/store";
import { Menu, MenuItem } from "../../components/Menu";
import { Select } from "../../components/Select";
import { Badge, Button, Card, CardTitle, cn, Dot, EmptyState, ErrorNote, Field, Input, Spinner } from "../../components/ui";
import { timeAgo } from "../../lib/format";
import { Avatar } from "./Avatar";
import { t } from "../../lib/i18n";

export function useConnect() {
  return useQuery({ queryKey: CONNECT_KEY, queryFn: api.connectState, staleTime: Infinity });
}

export function ConnectPage() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const state = useConnect();
  const [busy, setBusy] = useState(false);
  const s = state.data;
  if (state.error) return <ErrorNote title={t("TekBoard Connect indisponible")}>{asAppError(state.error).message}</ErrorNote>;
  if (!s) return <Spinner />;
  const configure = async (patch: Partial<ConnectConfig>) => {
    setBusy(true);
    try {
      const next: ConnectConfig = { enabled: s.enabled, profile: s.profile, port: s.port ?? 0, interface: s.interface, space: s.space, ...patch };
      qc.setQueryData(CONNECT_KEY, await api.connectConfigure(next));
    } catch (e) {
      toast({ kind: "error", title: t("Connect"), detail: asAppError(e).message });
    } finally {
      setBusy(false);
    }
  };
  if (!s.enabled) return <Intro state={s} busy={busy} onEnable={(profile) => void configure({ enabled: true, profile })} />;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4">
      <div className="space-y-4">
        {s.requests.filter((r) => r.state !== "silent").map((r) => (
          <RequestCard key={r.id} r={r} />
        ))}
        {s.problems.length > 0 && (
          <div className="space-y-1">
            {s.problems.map((p, i) => (
              <p key={i} className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-warn">
                {p}
              </p>
            ))}
          </div>
        )}
        <People state={s} />
      </div>
      <div className="space-y-4">
        <ProfileCard state={s} busy={busy} onSave={(profile) => void configure({ profile })} onDisable={() => void configure({ enabled: false })} />
        <InviteCard state={s} />
        <DiagnosisCard state={s} onInterface={(iface) => void configure({ interface: iface })} />
      </div>
    </div>
  );
}

function Intro({ state, busy, onEnable }: { state: ConnectState; busy: boolean; onEnable: (p: ConnectState["profile"]) => void }) {
  const [nick, setNick] = useState(state.profile.nick);
  return (
    <Card hero className="mx-auto max-w-2xl p-6">
      <div className="flex items-start gap-4">
        <Network className="mt-1 size-8 text-accent" />
        <div className="space-y-3">
          <h2 className="display text-[20px] text-fg">TekBoard Connect</h2>
          <p className="text-[13px] text-muted">{t("Retrouve les autres utilisateurs de TekBoard sur le même réseau pour partager du code, des tests ou des rapports, coder ensemble dans VS Code ou travailler côte à côte dans TekSpace. Tout est facultatif.")}</p>
          <ul className="space-y-1.5 text-[13px] text-muted">
            <li className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> {t("Rien ne passe par Internet ni par un serveur : les ordinateurs se parlent directement, en chiffré (TLS 1.3, identité par certificat).")}
            </li>
            <li className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> {t("La première connexion se fait à deux : chacun vérifie le même code à 6 chiffres. Tu peux bloquer quelqu'un à tout moment.")}
            </li>
            <li className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> {t("Seuls ton pseudonyme, ton avatar et ton statut sont annoncés. Aucun fichier ne part sans que tu le choisisses, et rien de reçu ne s'exécute tout seul.")}
            </li>
            <li className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> {t("TekBoard ne scanne jamais le réseau et ne contourne pas ses règles : si l'école isole les appareils, il te le dit.")}
            </li>
          </ul>
          <div className="flex items-end gap-2 pt-2">
            <Field label={t("Pseudonyme")}>
              <Input className="w-56" value={nick} maxLength={24} onChange={(e) => setNick(e.target.value)} />
            </Field>
            <Button variant="primary" icon={<Wifi className="size-3.5" />} busy={busy} onClick={() => onEnable({ ...state.profile, nick: nick.trim() || state.profile.nick })}>
              {t("Activer Connect")}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function RequestCard({ r }: { r: PairRequest }) {
  const toast = useUi((s) => s.toast);
  const answer = (accept: boolean) => void api.connectAnswer(r.id, accept).catch((e) => toast({ kind: "error", title: t("Connect"), detail: asAppError(e).message }));
  const text = r.state === "incoming" ? t("{n} veut se connecter à toi.", { n: r.profile.nick }) : r.state === "waiting" ? t("Demande envoyée à {n}, en attente de sa réponse.", { n: r.profile.nick }) : t("{n} a accepté. Confirme que vous voyez le même code.", { n: r.profile.nick });
  return (
    <Card hero className="flex items-center gap-4 p-4">
      <Avatar profile={r.profile} fp={r.fp} size={40} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-fg">{text}</p>
        <p className="text-xs text-faint">
          {r.addr} · {t("empreinte")} {r.short}
        </p>
      </div>
      <div className="text-center">
        <p className="text-[11px] text-faint">{t("Code à comparer")}</p>
        <p className="display font-mono text-[22px] tracking-widest text-accent-strong tabular">{r.code}</p>
      </div>
      {r.state === "waiting" ? (
        <Button size="sm" variant="ghost" onClick={() => answer(false)}>
          {t("Annuler")}
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => answer(true)}>
            {t("Le code est identique")}
          </Button>
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => answer(false)}>
            {t("Refuser")}
          </Button>
        </div>
      )}
    </Card>
  );
}

function People({ state }: { state: ConnectState }) {
  const g = groupPeople(state.peers);
  const empty = g.online.length + g.nearby.length + g.offline.length === 0;
  return (
    <Card>
      <CardTitle right={<span className="text-xs text-faint">{state.mdns ? t("Recherche sur le réseau…") : t("Découverte automatique indisponible")}</span>}>
        <Radar className="size-4 text-faint" /> {t("Personnes")}
      </CardTitle>
      {empty ? (
        <EmptyState icon={<Radar className="size-6" />} title={t("Personne pour l'instant")}>
          {t("Les TekBoard qui ont activé Connect sur ce réseau apparaissent ici. Sinon, échangez vos codes d'invitation (à droite).")}
        </EmptyState>
      ) : (
        <div className="divide-y divide-white/5">
          <Group title={t("En ligne")} people={g.online} />
          <Group title={t("À proximité")} people={g.nearby} />
          <Group title={t("Contacts absents")} people={g.offline} />
          {g.blocked.length > 0 && <Group title={t("Bloqués")} people={g.blocked} />}
        </div>
      )}
    </Card>
  );
}

function Group({ title, people }: { title: string; people: PeerView[] }) {
  if (people.length === 0) return null;
  return (
    <section className="px-2 py-2">
      <h3 className="px-2 pb-1 text-xs text-faint">
        {title} · {people.length}
      </h3>
      <ul>
        {people.map((p) => (
          <PersonRow key={p.fp} p={p} />
        ))}
      </ul>
    </section>
  );
}

function PersonRow({ p }: { p: PeerView }) {
  const toast = useUi((s) => s.toast);
  const err = (e: unknown) => toast({ kind: "error", title: t("Connect"), detail: asAppError(e).message });
  const status = p.trusted && !p.online ? STATUS.offline : STATUS[p.profile.status] ?? STATUS.available;
  return (
    <li className="row-hover flex items-center gap-3 rounded-md px-2 py-2">
      <Avatar profile={p.profile} fp={p.fp} size={32} online={p.online} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-fg">
          {p.profile.nick} {!p.trusted && !p.blocked && <span className="text-xs text-faint">· {t("non vérifié")}</span>}
        </p>
        <p className="truncate text-xs text-faint">
          <Dot tone={status.tone}>{status.label}</Dot>
          <span className="ml-2 font-mono">{p.short}</span>
          {!p.online && p.lastSeen ? <span className="ml-2">{t("vu {w}", { w: timeAgo(p.lastSeen) })}</span> : null}
        </p>
      </div>
      {!p.trusted && !p.blocked && (
        <Button size="sm" icon={<UserPlus className="size-3.5" />} onClick={() => void api.connectPair(p.fp).catch(err)}>
          {t("Se connecter")}
        </Button>
      )}
      <Menu>
        {p.blocked ? (
          <MenuItem icon={<Ban className="size-3.5" />} onSelect={() => void api.connectBlock(p.fp, false).catch(err)}>
            {t("Débloquer")}
          </MenuItem>
        ) : (
          <MenuItem icon={<Ban className="size-3.5" />} danger onSelect={() => void api.connectBlock(p.fp, true).catch(err)}>
            {t("Bloquer")}
          </MenuItem>
        )}
        {p.trusted && (
          <MenuItem icon={<Trash2 className="size-3.5" />} onSelect={() => void api.connectForget(p.fp).catch(err)}>
            {t("Oublier ce contact")}
          </MenuItem>
        )}
      </Menu>
    </li>
  );
}

function ProfileCard({ state, busy, onSave, onDisable }: { state: ConnectState; busy: boolean; onSave: (p: ConnectState["profile"]) => void; onDisable: () => void }) {
  const [nick, setNick] = useState(state.profile.nick);
  const changed = nick.trim() !== state.profile.nick;
  return (
    <Card>
      <CardTitle right={<Badge tone={state.running ? "ok" : "warn"}>{state.running ? t("Actif") : t("Démarrage…")}</Badge>}>{t("Toi")}</CardTitle>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <Avatar profile={state.profile} fp={state.fp} size={44} online={state.running} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex gap-2">
              <Input value={nick} maxLength={24} onChange={(e) => setNick(e.target.value)} aria-label={t("Pseudonyme")} />
              {changed && (
                <Button size="sm" variant="primary" busy={busy} onClick={() => onSave({ ...state.profile, nick: nick.trim() })}>
                  OK
                </Button>
              )}
            </div>
            <Select<ConnectStatus> size="sm" label={t("Statut")} value={state.profile.status} onChange={(status) => onSave({ ...state.profile, status })} options={CHOOSABLE.map((s) => ({ value: s, label: STATUS[s].label, hint: s === "invisible" ? t("personne ne te voit") : undefined }))} />
          </div>
        </div>
        <p className="font-mono text-[11px] text-faint" title={state.fp}>
          {t("Empreinte de cet appareil")} : {state.short}
        </p>
        <Button size="sm" variant="ghost" icon={<WifiOff className="size-3.5" />} busy={busy} onClick={onDisable}>
          {t("Désactiver Connect")}
        </Button>
      </div>
    </Card>
  );
}

function InviteCard({ state }: { state: ConnectState }) {
  const toast = useUi((s) => s.toast);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const dial = async () => {
    setBusy(true);
    try {
      await api.connectDial(target.trim());
      toast({ kind: "info", title: t("Demande envoyée"), detail: t("Comparez le code affiché des deux côtés.") });
      setTarget("");
    } catch (e) {
      toast({ kind: "error", title: t("Connexion impossible"), detail: asAppError(e).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardTitle>
        <Link2 className="size-4 text-faint" /> {t("Invitation")}
      </CardTitle>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted">{t("Quand la découverte ne marche pas, donne ce code à ton ami (Teams, oral…) ou colle le sien.")}</p>
        {state.invite ? (
          <div className="flex gap-2">
            <code className="selectable min-w-0 flex-1 truncate rounded bg-raised px-2 py-1.5 font-mono text-[11px] text-fg" title={state.invite}>
              {state.invite}
            </code>
            <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => void navigator.clipboard.writeText(state.invite!).then(() => toast({ kind: "ok", title: t("Code copié") }))}>
              {t("Copier")}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-faint">{t("Pas encore à l'écoute.")}</p>
        )}
        <div className="flex gap-2">
          <Input placeholder="tb1:… / 10.0.0.5:41234" className="font-mono text-xs" value={target} onChange={(e) => setTarget(e.target.value)} />
          <Button size="sm" busy={busy} disabled={!looksLikeTarget(target)} disabledReason={t("Code d'invitation (tb1:…) ou IP:PORT")} onClick={() => void dial()}>
            {t("Se connecter")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DiagnosisCard({ state, onInterface }: { state: ConnectState; onInterface: (iface: string) => void }) {
  const [target, setTarget] = useState("");
  const [diag, setDiag] = useState<ConnectDiagnosis | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setDiag(await api.connectDiagnose(target.trim() || null));
    } catch (e) {
      setDiag({ interfaces: [], listening: null, mdns: false, seen: 0, probe: null, probeText: asAppError(e).message, advice: [] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardTitle right={<span className="text-xs text-faint">{state.ip ? `${state.ip}:${state.port}` : ""}</span>}>
        <Network className="size-4 text-faint" /> {t("Réseau")}
      </CardTitle>
      <div className="space-y-3 p-4">
        <div className="flex gap-2">
          <Input placeholder={t("Adresse d'un ami à tester (facultatif)")} className="font-mono text-xs" value={target} onChange={(e) => setTarget(e.target.value)} />
          <Button size="sm" busy={busy} onClick={() => void run()}>
            {t("Diagnostiquer")}
          </Button>
        </div>
        {diag && (
          <div className="space-y-2 text-[12px]">
            {diag.advice.map((a, i) => (
              <p key={i} className="text-warn">
                {a}
              </p>
            ))}
            {diag.probeText && <p className={cn(diag.probe?.result === "open" ? "text-ok" : "text-muted")}>{diag.probeText}</p>}
            <p className="text-muted">
              {t("mDNS : {s} · {n} appareil(s) vu(s)", { s: diag.mdns ? t("actif") : t("indisponible"), n: diag.seen })}
            </p>
            <Select<string>
              size="sm"
              label={t("Interface")}
              value={state.interface || ""}
              onChange={onInterface}
              options={[{ value: "", label: t("Automatique") }, ...diag.interfaces.map((i) => ({ value: i.name, label: `${i.name} · ${i.ip}`, hint: i.kind === "virtual" ? t("virtuelle") : i.default ? t("par défaut") : i.kind }))]}
            />
          </div>
        )}
      </div>
    </Card>
  );
}
