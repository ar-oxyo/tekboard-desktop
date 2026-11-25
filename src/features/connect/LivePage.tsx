// TekLive: code together in VS Code with P2P Live Share, started from TekBoard. TekBoard
// runs the relay on this computer, opens the project in VS Code where its bridge opens the
// extension's server list (TekBoard's relay first: press Enter), then shows who is in the
// session and sends the invitation to TekBoard contacts. Guests join in one click.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleStop, Copy, ExternalLink, Info, LogIn, Play, Puzzle, Send, Users, X } from "lucide-react";
import { api, asAppError, type LiveSession } from "../../lib/api";
import { useUi } from "../../lib/store";
import { recipients } from "../../lib/share";
import { ProjectPicker } from "../../components/ProjectPicker";
import { Badge, Button, Card, CardTitle, Spinner } from "../../components/ui";
import { useConnect } from "./ConnectPage";
import { Avatar } from "./Avatar";
import { t } from "../../lib/i18n";

export const LIVE_KEY = ["teklive"] as const;

function elapsed(since: number, now: number): string {
  const s = Math.max(0, Math.floor(now / 1000 - since));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min ${String(s % 60).padStart(2, "0")}`;
}

export function LivePage() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const preset = useUi((s) => s.liveRepo);
  const setup = useQuery({ queryKey: ["teklive-setup"], queryFn: api.liveSetup, staleTime: 30_000 });
  const session = useQuery({ queryKey: LIVE_KEY, queryFn: api.liveState, staleTime: Infinity });
  const invites = useQuery({ queryKey: ["teklive-invites"], queryFn: api.liveInvitations, staleTime: 0, refetchInterval: 10_000 });
  const [project, setProject] = useState<string | null>(preset);
  const [contactsOnly, setContactsOnly] = useState(true);
  const [showProject, setShowProject] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (preset) setProject(preset);
  }, [preset]);
  const err = (e: unknown) => toast({ kind: "error", title: "TekLive", detail: asAppError(e).message });
  const install = async (what: "extension" | "bridge") => {
    const msg =
      what === "extension"
        ? t("Installer l'extension P2P Live Share (kermanx.p2p-live-share, version testée 0.1.4) dans VS Code ?")
        : t("Installer TekBoard Bridge dans VS Code ? Cette petite extension, fournie par TekBoard, règle le serveur de P2P Live Share et lance sa commande d'hébergement quand tu démarres une session. Elle ne fait rien d'autre.");
    if (!window.confirm(msg)) return;
    setBusy(what);
    try {
      toast({ kind: "ok", title: await api.liveInstall(what) });
      await qc.invalidateQueries({ queryKey: ["teklive-setup"] });
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };
  const start = async () => {
    if (!project) return;
    setBusy("start");
    try {
      qc.setQueryData(LIVE_KEY, await api.liveStart(project, contactsOnly, showProject));
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };
  const s = setup.data;
  const live = session.data && session.data.state !== "stopped" ? session.data : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4">
      <div className="space-y-4">
        {(invites.data ?? []).map((inv) => (
          <Card hero key={inv.id} className="flex items-center gap-4 p-4">
            <LogIn className="size-6 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg">{inv.project ? t("{h} t'invite à coder sur « {p} »", { h: inv.host, p: inv.project }) : t("{h} t'invite à une session de code", { h: inv.host })}</p>
              <p className="truncate font-mono text-2xs text-faint">{inv.link}</p>
            </div>
            <Button
              variant="primary"
              busy={busy === inv.id}
              onClick={async () => {
                if (!s?.extension) {
                  if (!s?.code) return err({ message: t("VS Code n'est pas installé") });
                  await install("extension");
                }
                setBusy(inv.id);
                try {
                  await api.liveJoin(inv.id);
                  toast({ kind: "ok", title: t("VS Code s'ouvre"), detail: t("P2P Live Share rejoint la session tout seul ; il peut te demander ton nom la première fois.") });
                  void qc.invalidateQueries({ queryKey: ["teklive-invites"] });
                } catch (e) {
                  err(e);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {t("Rejoindre")}
            </Button>
            <Button variant="ghost" icon={<X className="size-3.5" />} onClick={() => void api.liveDecline(inv.id).then(() => qc.invalidateQueries({ queryKey: ["teklive-invites"] }))}>
              {t("Refuser")}
            </Button>
          </Card>
        ))}
        {live ? <SessionCard s={live} /> : <StartCard project={project} setProject={setProject} contactsOnly={contactsOnly} setContactsOnly={setContactsOnly} showProject={showProject} setShowProject={setShowProject} ready={!!s && s.missing.length === 0} busy={busy === "start"} onStart={() => void start()} />}
      </div>
      <div className="space-y-4">
        <Card>
          <CardTitle>
            <Puzzle className="size-4 text-faint" /> {t("VS Code")}
          </CardTitle>
          <div className="space-y-2 p-4 text-sm">
            {!s ? (
              <Spinner />
            ) : (
              <>
                <Row ok={!!s.code} label="VS Code" value={s.codeVersion ?? t("absent")} />
                <Row ok={!!s.extension} label="P2P Live Share" value={s.extension ?? t("non installée")} action={!s.extension && s.code ? <Button size="sm" busy={busy === "extension"} onClick={() => void install("extension")}>{t("Installer")}</Button> : null} />
                <Row ok={!!s.bridge && !s.missing.some((m) => m.includes("Bridge"))} label="TekBoard Bridge" value={s.bridge ?? t("non installée")} action={s.code && s.missing.some((m) => m.includes("Bridge")) ? <Button size="sm" busy={busy === "bridge"} onClick={() => void install("bridge")}>{s.bridge ? t("Mettre à jour") : t("Installer")}</Button> : null} />
              </>
            )}
          </div>
        </Card>
        <Card>
          <CardTitle>
            <Info className="size-4 text-faint" /> {t("Bon à savoir")}
          </CardTitle>
          <ul className="space-y-2 p-4 text-xs text-muted">
            <li>{t("La session passe par un relais lancé par TekBoard sur cet ordinateur, sur le réseau local seulement : rien ne passe par Internet ni par un serveur, et rien ne change dans le pare-feu.")}</li>
            <li>{t("P2P Live Share n'a pas de droits par participant : toute personne qui rejoint peut modifier les fichiers du projet. N'invite que des personnes de confiance ; « contacts TekBoard seulement » refuse les autres adresses.")}</li>
            <li>{t("Rien d'autre n'est partagé par défaut : un terminal ou un serveur ne l'est que si tu le partages toi-même dans VS Code.")}</li>
            <li>{t("Les invités ne voient pas forcément leur nom ici : le relais ne voit que les connexions, pas les noms choisis dans l'extension.")}</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Row({ ok, label, value, action }: { ok: boolean; label: string; value: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className={ok ? "text-ok" : "text-warn"}>●</span>
      <span className="text-fg">{label}</span>
      <span className="truncate text-xs text-faint">{value}</span>
      <span className="ml-auto">{action}</span>
    </div>
  );
}

function StartCard(p: { project: string | null; setProject: (v: string | null) => void; contactsOnly: boolean; setContactsOnly: (v: boolean) => void; showProject: boolean; setShowProject: (v: boolean) => void; ready: boolean; busy: boolean; onStart: () => void }) {
  return (
    <Card>
      <CardTitle>
        <Users className="size-4 text-faint" /> {t("Collaborer sur un projet")}
      </CardTitle>
      <div className="space-y-3 p-4">
        <p className="text-sm text-muted">{t("TekBoard démarre le relais, ouvre le projet dans VS Code et y prépare P2P Live Share. Dans VS Code, la liste des serveurs s'ouvre avec celui de TekBoard en premier : appuie sur Entrée. Le lien d'invitation apparaît alors ici.")}</p>
        <ProjectPicker value={p.project} onChange={p.setProject} />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" className="accent-(--color-accent)" checked={p.contactsOnly} onChange={(e) => p.setContactsOnly(e.target.checked)} />
          {t("Contacts TekBoard seulement (les autres adresses sont refusées)")}
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" className="accent-(--color-accent)" checked={p.showProject} onChange={(e) => p.setShowProject(e.target.checked)} />
          {t("Indiquer le nom du projet dans les invitations")}
        </label>
        <Button variant="primary" icon={<Play className="size-3.5" />} busy={p.busy} disabled={!p.project || !p.ready} disabledReason={!p.ready ? t("Installe d'abord ce qui manque (à droite)") : t("Choisis un projet")} onClick={p.onStart}>
          {t("Démarrer la session")}
        </Button>
      </div>
    </Card>
  );
}

function SessionCard({ s }: { s: LiveSession }) {
  const toast = useUi((st) => st.toast);
  const connect = useConnect();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const people = recipients(connect.data?.peers ?? []);
  const guests = Math.max(0, s.peers.length - 1);
  return (
    <Card hero>
      <CardTitle right={<Badge tone={s.state === "live" ? "ok" : "warn"}>{s.state === "live" ? t("En direct · {d}", { d: elapsed(s.startedAt, now) }) : t("En attente de VS Code")}</Badge>}>
        <Users className="size-4 text-faint" /> {s.name}
      </CardTitle>
      <div className="space-y-4 p-4">
        {s.state === "waiting" && (
          <p className="text-sm text-muted">
            {t("Dans VS Code, choisis")} <code className="font-mono text-fg">{s.server}</code> {t("(premier de la liste) et appuie sur Entrée. Si la liste ne s'est pas ouverte, lance « P2P Live Share: Host a Session ».")}
          </p>
        )}
        {s.link && (
          <div className="flex gap-2">
            <code className="selectable min-w-0 flex-1 truncate rounded bg-raised px-2 py-1.5 font-mono text-2xs text-fg" title={s.link}>
              {s.link}
            </code>
            <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => void navigator.clipboard.writeText(s.link!).then(() => toast({ kind: "ok", title: t("Lien copié"), detail: t("Dans VS Code : P2P Live Share → Join, puis colle le lien.") }))}>
              {t("Copier")}
            </Button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat n={guests} label={t("invité(s) connecté(s)")} />
          <Stat n={s.invited.length} label={t("invitation(s) envoyée(s)")} />
          <Stat n={s.refused} label={t("connexion(s) refusée(s)")} />
        </div>
        {s.guests.length > 0 && <p className="text-xs text-faint">{t("Adresses des invités : {a}", { a: s.guests.join(", ") })}</p>}
        <section>
          <h3 className="mb-2 text-xs text-faint">{t("Inviter des contacts TekBoard")}</h3>
          {people.length === 0 ? (
            <p className="text-sm text-muted">{t("Aucun contact connecté. Active Connect et appaire-toi avec tes amis, ou copie le lien.")}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-1.5">
              {people.map((p) => {
                const sent = s.invited.includes(p.fp);
                return (
                  <li key={p.fp} className="flex items-center gap-2 rounded-md border border-ink/8 px-2.5 py-1.5">
                    <Avatar profile={p.profile} fp={p.fp} size={24} online />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{p.profile.nick}</span>
                    <Button size="sm" variant={sent ? "ghost" : "secondary"} icon={<Send className="size-3" />} disabled={!s.link} disabledReason={t("En attente du lien")} onClick={() => void api.liveInvite(p.fp).then(() => toast({ kind: "ok", title: t("Invitation envoyée à {n}", { n: p.profile.nick }) }), (e) => toast({ kind: "error", title: "TekLive", detail: asAppError(e).message }))}>
                      {sent ? t("Renvoyer") : t("Inviter")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <div className="flex gap-2">
          <Button variant="danger" icon={<CircleStop className="size-3.5" />} onClick={() => void api.liveStop()}>
            {t("Arrêter la session")}
          </Button>
          <Button variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => useUi.getState().openSheet(s.project)}>
            {t("Fiche du projet")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-md bg-ink/4 py-2">
      <p className="display text-xl text-fg tabular">{n}</p>
      <p className="text-2xs text-faint">{label}</p>
    </div>
  );
}
