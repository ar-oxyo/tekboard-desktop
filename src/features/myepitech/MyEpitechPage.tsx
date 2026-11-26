// MY Epitech: one "Sync" button signs in on the real site when needed, syncs, and closes what it opened.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, GraduationCap, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { CodeView } from "../../components/DiffView";
import { Button, Card, CardTitle, cn, Dot, EmptyState, ErrorNote, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type MyEntry } from "../../lib/api";
import { formatBytes, timeAgo } from "../../lib/format";
import { useUi } from "../../lib/store";
import { MyProgress, MyProjects } from "./MyOverview";
import { useMySync } from "./useMySync";
import { locale, plural, t } from "../../lib/i18n";

const CONSENT_KEY = "tekboard.my.consent";

export function MyEpitechPage() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const status = useQuery({ queryKey: ["my-status"], queryFn: api.myStatus, refetchInterval: 4000, staleTime: 0 });
  const data = useQuery({ queryKey: ["my-data"], queryFn: api.myData, staleTime: 0 });
  const mySync = useMySync();
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
  const forget = useMutation({
    mutationFn: (eraseCache: boolean) => api.myForget(eraseCache),
    onSuccess: () => {
      setConfirmForget(false);
      toast({ kind: "ok", title: t("Session effacée") });
      void qc.invalidateQueries({ queryKey: ["my-status"] });
      void qc.invalidateQueries({ queryKey: ["my-data"] });
    },
    onError: (e) => toast({ kind: "error", title: t("Non effacé"), detail: asAppError(e).message }),
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
  const syncButton = (
    <Button variant="primary" icon={<RefreshCw className={cn("size-3.5", mySync.busy && "anim-spin")} />} disabled={!consent || mySync.busy} disabledReason={!consent ? t("Coche d'abord l'accord ci-dessous") : null} onClick={() => void mySync.sync()}>
      {mySync.label}
    </Button>
  );

  return (
    <>
      <PageHeader title="MY Epitech" subtitle={t("Ton propre compte, en lecture seule. Tu te connectes sur le vrai site, TekBoard ne voit jamais ton mot de passe")} actions={syncButton} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <div className="flex h-11 items-center gap-1 border-b border-ink/6 px-3">
            {([["projects", t("Projets et rendus")], ["progress", t("Crédits et validations")], ["raw", t("Réponses brutes")]] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={cn("h-7 rounded-md px-2.5 text-sm transition-colors duration-150", tab === id ? "bg-raised text-fg" : "text-muted hover:text-fg")}>{label}</button>
            ))}
          </div>
          {tab === "projects" && <MyProjects />}
          {tab === "progress" && <MyProgress />}
          {tab === "raw" && (data.error ? (
            <div className="p-4"><ErrorNote>{asAppError(data.error).message}</ErrorNote></div>
          ) : entries.length === 0 ? (
            <EmptyState icon={<GraduationCap className="size-5" />} title={t("Rien de synchronisé")}>{t("Clique sur « Sync » : MY Epitech s'ouvre si tu dois te connecter, puis se referme une fois la synchronisation faite.")}</EmptyState>
          ) : (
            <ul className="py-1">{entries.map((e) => <EntryRow key={e.route} entry={e} />)}</ul>
          ))}
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle right={s ? <Dot tone={s.connected ? "ok" : mySync.phase === "sign-in" ? "info" : "neutral"}>{s.connected ? t("Connecté") : mySync.phase === "sign-in" ? t("En attente de connexion") : t("Non connecté")}</Dot> : <Spinner />}>{t("Connexion")}</CardTitle>
            <div className="flex flex-col gap-3 p-4 text-sm">
              <button type="button" aria-expanded={showHow} onClick={() => setHow(!showHow)} className="flex items-center gap-1 text-left text-xs text-muted hover:text-fg">
                {showHow ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} {t("Comment marche la connexion, et ce qui est gardé")}
              </button>
              {showHow && (
                <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs leading-relaxed text-muted">
                  <li>{t("« Sync » utilise ta session si elle est encore valide. Sinon une fenêtre my.epitech.eu s'ouvre : la connexion Microsoft et la double authentification se font là, comme dans un navigateur.")}</li>
                  <li>{t("Dès que tu es connecté, la synchronisation démarre seule et la fenêtre ouverte pour l'occasion se referme. Une fenêtre MY Epitech que tu as ouverte toi-même n'est jamais fermée.")}</li>
                  <li>{t("TekBoard reçoit le jeton d'accès du site depuis cette fenêtre et le garde seulement en mémoire. Il n'est écrit ni en base ni dans les journaux.")}</li>
                  <li>{t("Une synchronisation fait environ {n} requêtes en lecture seule (plus trois par projet en cours et un téléchargement par nouveau sujet), une demi-seconde d'écart, sur ton propre compte.", { n: s?.routes ?? 20 })}</li>
                  <li>{t("Les réponses sont gardées sur cet ordinateur pour être lisibles hors ligne. Vérifie que cet usage respecte les règles de ton école.")}</li>
                </ul>
              )}
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-(--color-accent)" checked={consent} onChange={(e) => accept(e.target.checked)} />
                {t("J'accepte de garder une session MY Epitech dans TekBoard sur cet ordinateur")}
              </label>
              <div className="flex flex-wrap gap-2">
                {syncButton}
                {(s?.sessionStored || s?.connected || entries.length > 0) && !confirmForget && <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmForget(true)}>{t("Effacer la session…")}</Button>}
              </div>
              {confirmForget && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs">
                  <span className="mr-auto text-danger">{t("Se déconnecter ici et supprimer la session gardée ?")}</span>
                  <Button size="sm" variant="danger" busy={forget.isPending} onClick={() => forget.mutate(false)}>{t("Effacer la session")}</Button>
                  <Button size="sm" variant="danger" busy={forget.isPending} onClick={() => forget.mutate(true)}>{t("Session et données synchronisées")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmForget(false)}>{t("Garder")}</Button>
                </div>
              )}
              {mySync.phase === "sign-in" && <p className="text-xs text-info">{t("Connecte-toi dans la fenêtre MY Epitech : la synchronisation démarrera toute seule.")}</p>}
              {s?.connected && <p className="selectable text-xs text-muted">{s.account ? t("Connecté en tant que {who}.", { who: s.account }) + " " : ""}{s.expiresAt ? t("Session valable jusqu'à {h}.", { h: new Date(s.expiresAt * 1000).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) }) : ""}</p>}
              {s && (
                <p className="text-xs text-muted">
                  {s.syncMinutes > 0 ? t("Synchronisation automatique toutes les {d} tant que la session est valide", { d: s.syncMinutes >= 60 ? `${s.syncMinutes / 60} h` : `${s.syncMinutes} min` }) : t("Synchronisation automatique désactivée")}
                  {s.lastSync ? ` · ${t("dernière {when}", { when: timeAgo(s.lastSync) })}` : ""}.{" "}
                  <button type="button" className="text-accent-strong hover:underline" onClick={() => useUi.getState().setPage("settings")}>
                    {t("Modifier dans Réglages")}
                  </button>
                </p>
              )}
            </div>
          </Card>
          <Card>
            <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)} className="flex h-11 w-full items-center gap-2 px-4 text-left text-sm font-medium">
              <span className="mr-auto">{t("Historique des synchronisations")}</span>
              <span className="text-xs font-normal text-faint">{(data.data?.history.length ?? 0) === 0 ? t("aucune") : plural(data.data!.history.length, "{n} synchro", "{n} synchros")}</span>
              {showHistory ? <ChevronDown className="size-3.5 text-faint" /> : <ChevronRight className="size-3.5 text-faint" />}
            </button>
            {showHistory &&
              ((data.data?.history.length ?? 0) === 0 ? (
                <p className="border-t border-ink/6 px-4 py-4 text-sm text-muted">{t("Aucune synchronisation")}</p>
              ) : (
                <ul className="max-h-80 overflow-y-auto border-t border-ink/6 py-1">
                  {data.data!.history.map((h) => (
                    <li key={h.at} className="selectable px-4 py-2 text-xs text-muted" title={h.detail || undefined}>
                      <span className="flex items-center gap-3">
                        <span className="mr-auto text-fg">{timeAgo(h.at)}</span>
                        <span className="font-mono">{t("{n} lus", { n: h.ok })}</span>
                        {h.failed > 0 && <Dot tone="warn" mono>{t("{n} indisponibles", { n: h.failed })}</Dot>}
                      </span>
                      {h.detail && <p className="mt-1 font-mono text-2xs leading-relaxed text-faint">{h.detail}</p>}
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
          <span className="block text-sm">{entry.label} <span className="font-mono text-2xs text-faint">{entry.route}</span></span>
          <span className="block truncate text-xs text-muted">{ok ? summary(entry.body) : entry.status === 0 ? "no answer" : `not available (HTTP ${entry.status})`}</span>
        </span>
        <Dot tone={ok ? "ok" : "warn"} mono>{entry.status || "—"}</Dot>
        <span className="w-24 shrink-0 text-right text-xs text-faint">{formatBytes(entry.size)} · {timeAgo(entry.fetchedAt)}</span>
      </button>
      {open && <CodeView text={text.length > 60000 ? `${text.slice(0, 60000)}\n… (${formatBytes(text.length - 60000)} more)` : text} className="mx-4 mb-2 max-h-96 rounded-md" />}
    </li>
  );
}
