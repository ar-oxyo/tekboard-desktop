// MY Epitech: sign in on the real site in its own window, then sync your own data by hand.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, GraduationCap, LogIn, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { CodeView } from "../../components/DiffView";
import { Button, Card, CardTitle, cn, Dot, EmptyState, ErrorNote, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type MyEntry } from "../../lib/api";
import { formatBytes, timeAgo } from "../../lib/format";
import { useUi } from "../../lib/store";
import { MyProgress, MyProjects } from "./MyOverview";

const CONSENT_KEY = "tekboard.my.consent";

export function MyEpitechPage() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const status = useQuery({ queryKey: ["my-status"], queryFn: api.myStatus, refetchInterval: 2000, staleTime: 0 });
  const data = useQuery({ queryKey: ["my-data"], queryFn: api.myData, staleTime: 0 });
  const [consent, setConsent] = useState(() => {
    try {
      return window.localStorage.getItem(CONSENT_KEY) === "yes";
    } catch {
      return false;
    }
  });
  const [confirmForget, setConfirmForget] = useState(false);
  // Explanations are open until the agreement is given, then fold away.
  const [how, setHow] = useState<boolean | null>(null);
  const showHow = how ?? !consent;
  const [tab, setTab] = useState<"projects" | "progress" | "raw">("projects");
  const [showHistory, setShowHistory] = useState(false);
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });
  const connect = useMutation({ mutationFn: api.myConnect, onSuccess: () => void qc.invalidateQueries({ queryKey: ["my-status"] }), onError: fail("The sign-in window did not open") });
  const sync = useMutation({
    mutationFn: api.mySync,
    onSuccess: (r) => {
      toast({ kind: r.unauthorized ? "error" : r.failed > 0 ? "info" : "ok", title: r.unauthorized ? "MY Epitech refused the session" : `Synced: ${r.ok} route(s) read${r.failed ? `, ${r.failed} not available` : ""}${r.subjectsImported ? `, ${r.subjectsImported} subject${r.subjectsImported > 1 ? "s" : ""} added` : ""}`, detail: r.unauthorized ? "Open the sign-in window and sign in again." : r.detail || undefined });
    },
    onError: fail("Not synced"),
  });
  const forget = useMutation({
    mutationFn: (eraseCache: boolean) => api.myForget(eraseCache),
    onSuccess: () => {
      setConfirmForget(false);
      toast({ kind: "ok", title: "Session effacée" });
      void qc.invalidateQueries({ queryKey: ["my-status"] });
      void qc.invalidateQueries({ queryKey: ["my-data"] });
    },
    onError: fail("Not erased"),
  });
  const accept = (v: boolean) => {
    setConsent(v);
    try {
      window.localStorage.setItem(CONSENT_KEY, v ? "yes" : "no");
    } catch {
      /* not remembered */
    }
  };
  const s = status.data;
  const entries = data.data?.entries ?? [];

  return (
    <>
      <PageHeader title="MY Epitech" subtitle="Ton propre compte, en lecture seule. Tu te connectes sur le vrai site, TekBoard ne voit jamais ton mot de passe" />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <div className="flex h-11 items-center gap-1 border-b border-white/6 px-3">
            {([["projects", "Projets et rendus"], ["progress", "Crédits et validations"], ["raw", "Réponses brutes"]] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={cn("h-7 rounded-md px-2.5 text-[13px] transition-colors duration-150", tab === id ? "bg-raised text-fg" : "text-muted hover:text-fg")}>{label}</button>
            ))}
          </div>
          {tab === "projects" && <MyProjects />}
          {tab === "progress" && <MyProgress />}
          {tab === "raw" && (data.error ? (
            <div className="p-4"><ErrorNote>{asAppError(data.error).message}</ErrorNote></div>
          ) : entries.length === 0 ? (
            <EmptyState icon={<GraduationCap className="size-5" />} title="Rien de synchronisé">Connecte-toi, puis clique sur « Synchroniser ». Les réponses de MY Epitech s'affichent ici telles quelles.</EmptyState>
          ) : (
            <ul className="py-1">{entries.map((e) => <EntryRow key={e.route} entry={e} />)}</ul>
          ))}
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle right={s ? <Dot tone={s.connected ? "ok" : s.windowOpen ? "info" : "neutral"}>{s.connected ? "Connecté" : s.windowOpen ? "Waiting for sign-in" : "Non connecté"}</Dot> : <Spinner />}>Connexion</CardTitle>
            <div className="flex flex-col gap-3 p-4 text-[13px]">
              <button type="button" aria-expanded={showHow} onClick={() => setHow(!showHow)} className="flex items-center gap-1 text-left text-xs text-muted hover:text-fg">
                {showHow ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} How the connection works and what is stored
              </button>
              {showHow && (
                <>
              <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs leading-relaxed text-muted">
                <li>Une fenêtre séparée s'ouvre <span className="font-mono">my.epitech.eu</span>. La connexion Microsoft et la double authentification se font là, comme dans un navigateur.</li>
                <li>Cette fenêtre garde sa session dans un dossier à elle sur cet ordinateur, pour rester connecté. « Effacer la session » la supprime.</li>
                <li>TekBoard reçoit le jeton d'accès du site depuis cette fenêtre et le garde seulement en mémoire. Il n'est écrit ni en base ni dans les journaux.</li>
                <li>Syncing happens when you click, or at the interval you set in Settings: about {s?.routes ?? 18} read-only requests (plus three per ongoing project, and one download per new subject PDF), half a second apart, on your own account.</li>
                <li>Les réponses sont gardées sur cet ordinateur pour être lisibles hors ligne. Vérifie que cet usage respecte les règles de ton école.</li>
              </ul>
                </>
              )}
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-(--color-accent)" checked={consent} onChange={(e) => accept(e.target.checked)} />
                J'accepte de garder une session MY Epitech dans TekBoard sur cet ordinateur
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={<LogIn className="size-3.5" />} disabled={!consent} busy={connect.isPending} onClick={() => connect.mutate()}>{s?.windowOpen ? "Afficher la fenêtre de connexion" : "Connect to MY Epitech"}</Button>
                <Button icon={<RefreshCw className="size-3.5" />} disabled={!s?.connected} disabledReason="Connecte-toi d'abord : bouton Se connecter, puis identifie-toi dans la fenêtre MY Epitech" busy={sync.isPending} onClick={() => sync.mutate()}>Synchroniser</Button>
                {(s?.sessionStored || s?.connected || entries.length > 0) && !confirmForget && <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmForget(true)}>Effacer la session…</Button>}
              </div>
              {confirmForget && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs">
                  <span className="mr-auto text-danger">Se déconnecter ici et supprimer la session gardée ?</span>
                  <Button size="sm" variant="danger" busy={forget.isPending} onClick={() => forget.mutate(false)}>Effacer la session</Button>
                  <Button size="sm" variant="danger" busy={forget.isPending} onClick={() => forget.mutate(true)}>Session et données synchronisées</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmForget(false)}>Garder</Button>
                </div>
              )}
              {s?.connected && <p className="selectable text-xs text-muted">{s.account ? `Signed in as ${s.account}. ` : ""}{s.expiresAt ? `This token is valid until ${new Date(s.expiresAt * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}; keep the sign-in window open and the site renews it.` : ""}</p>}
              {s && (
                <p className="text-xs text-muted">
                  {s.syncMinutes > 0 ? `Automatic sync every ${s.syncMinutes >= 60 ? `${s.syncMinutes / 60} h` : `${s.syncMinutes} min`} while connected` : "Automatic sync is off"}
                  {s.lastSync ? ` · last sync ${timeAgo(s.lastSync)}` : ""}.{" "}
                  <button type="button" className="text-accent-strong hover:underline" onClick={() => useUi.getState().setPage("settings")}>
                    Modifier dans Réglages
                  </button>
                </p>
              )}
              {s && !s.connected && s.windowHidden && <p className="text-xs text-warn">La session gardée a été rouverte en arrière-plan mais le site n'a pas transmis de session : il faut se reconnecter. Clique sur « Afficher la fenêtre de connexion ».</p>}
              {s && !s.connected && s.windowOpen && !s.windowHidden && <p className="text-xs text-muted">Connecte-toi dans la fenêtre MY Epitech. L'état passe à « Connecté » peu après le chargement du tableau de bord.</p>}
            </div>
          </Card>
          <Card>
            <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)} className="flex h-11 w-full items-center gap-2 px-4 text-left text-[13px] font-medium">
              <span className="mr-auto">Historique des synchronisations</span>
              <span className="text-xs font-normal text-faint">{(data.data?.history.length ?? 0) === 0 ? "none yet" : `${data.data!.history.length} sync${data.data!.history.length > 1 ? "s" : ""}`}</span>
              {showHistory ? <ChevronDown className="size-3.5 text-faint" /> : <ChevronRight className="size-3.5 text-faint" />}
            </button>
            {showHistory &&
              ((data.data?.history.length ?? 0) === 0 ? (
                <p className="border-t border-white/6 px-4 py-4 text-[13px] text-muted">Aucune synchronisation</p>
              ) : (
                <ul className="max-h-80 overflow-y-auto border-t border-white/6 py-1">
                  {data.data!.history.map((h) => (
                    <li key={h.at} className="selectable px-4 py-2 text-xs text-muted" title={h.detail || undefined}>
                      <span className="flex items-center gap-3">
                        <span className="mr-auto text-fg">{timeAgo(h.at)}</span>
                        <span className="font-mono">{h.ok} read</span>
                        {h.failed > 0 && <Dot tone="warn" mono>{h.failed} not available</Dot>}
                      </span>
                      {h.detail && <p className="mt-1 font-mono text-[11px] leading-relaxed text-faint">{h.detail}</p>}
                    </li>
                  ))}
                </ul>
              ))}
          </Card>
        </div>

      </div>
    </>
  );
}

function summary(body: unknown): string {
  if (Array.isArray(body)) return `${body.length} item${body.length === 1 ? "" : "s"}`;
  if (body && typeof body === "object") {
    const keys = Object.keys(body as object);
    return `${keys.length} field${keys.length === 1 ? "" : "s"}: ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? "…" : ""}`;
  }
  return String(body).slice(0, 80);
}

function EntryRow({ entry }: { entry: MyEntry }) {
  const [open, setOpen] = useState(false);
  const ok = entry.status >= 200 && entry.status < 300;
  const text = open ? JSON.stringify(entry.body, null, 2) : "";
  return (
    <li>
      <button type="button" onClick={() => setOpen(!open)} className="row-hover flex min-h-10 w-full items-center gap-2.5 px-4 py-1.5 text-left">
        {open ? <ChevronDown className="size-3.5 shrink-0 text-faint" /> : <ChevronRight className="size-3.5 shrink-0 text-faint" />}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px]">{entry.label} <span className="font-mono text-[11px] text-faint">{entry.route}</span></span>
          <span className="block truncate text-xs text-muted">{ok ? summary(entry.body) : entry.status === 0 ? "no answer" : `not available (HTTP ${entry.status})`}</span>
        </span>
        <Dot tone={ok ? "ok" : "warn"} mono>{entry.status || "—"}</Dot>
        <span className="w-24 shrink-0 text-right text-xs text-faint">{formatBytes(entry.size)} · {timeAgo(entry.fetchedAt)}</span>
      </button>
      {open && <CodeView text={text.length > 60000 ? `${text.slice(0, 60000)}\n… (${formatBytes(text.length - 60000)} more)` : text} className="mx-4 mb-2 max-h-96 rounded-md" />}
    </li>
  );
}
