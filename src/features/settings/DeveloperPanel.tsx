// Settings → Developer (developer mode only). Local diagnostics gathered from what TekBoard
// already measures: versions, services, task logs, the MY Epitech sync history, the anonymised
// report, and the experiments. It grants no right of any kind and never shows a secret: tokens
// and keys stay in the backend, the report is anonymised there (doctor/anonymize.rs).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, FolderOpen, PawPrint, Power } from "lucide-react";
import { useState } from "react";
import { Modal } from "../../components/Modal";
import { Button, Dot, ErrorNote, Notice, Section, Spinner } from "../../components/ui";
import { api, asAppError, type Run } from "../../lib/api";
import { formatBytes, timeAgo } from "../../lib/format";
import { useDevMode, useEnv, usePref, useUiScale } from "../../lib/hooks";
import { CONNECT_KEY } from "../../lib/connect";
import { t } from "../../lib/i18n";
import { useUi } from "../../lib/store";
import { ReportModal } from "./DoctorCard";

/** Shows the technical details of MY Epitech (raw answers, sync history) on its page. */
export const MY_DETAILS_PREF = "dev.myDetails";

export function DeveloperPanel() {
  const [, setDev] = useDevMode();
  const toast = useUi((s) => s.toast);
  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <Notice
        tone="info"
        action={
          <Button
            size="sm"
            icon={<Power className="size-3.5" />}
            onClick={() => {
              setDev(false);
              useUi.setState({ settingsTab: "about" });
              toast({ kind: "ok", title: t("Mode développeur désactivé"), action: { label: t("Annuler"), run: () => setDev(true) } });
            }}
          >
            {t("Désactiver")}
          </Button>
        }
      >
        {t("Diagnostic local de cette copie de TekBoard. Ce mode ne donne aucun droit de plus et n'affiche ni jeton ni clé.")}
      </Notice>
      <SystemInfo />
      <Services />
      <Logs />
      <Experiments />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-baseline gap-3 py-1.5 text-sm">
      <span className="text-xs text-faint">{label}</span>
      <span className="selectable min-w-0 break-words text-muted">{children}</span>
    </div>
  );
}

function startupMs(): number | null {
  try {
    const mark = performance.getEntriesByName("tekboard-ready")[0];
    return mark ? Math.round(mark.startTime) : null;
  } catch {
    return null;
  }
}

function SystemInfo() {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["update-info"], queryFn: api.updateInfo, staleTime: Infinity });
  const places = useQuery({ queryKey: ["data-locations"], queryFn: api.dataLocations });
  const [scale] = useUiScale();
  const root = document.documentElement;
  const engine = /AppleWebKit\/([\d.]+)/.exec(navigator.userAgent)?.[1];
  const ready = startupMs();
  const report = useMutation({ mutationFn: api.doctorExport });
  const [text, setText] = useState<string | null>(null);
  const PLACE: Record<string, string> = { data: t("Données"), session: t("Session MY Epitech"), cache: t("Cache") };
  return (
    <Section
      title={t("Système")}
      action={
        <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} busy={report.isPending} onClick={() => report.mutate(undefined, { onSuccess: setText })}>
          {t("Rapport anonymisé")}
        </Button>
      }
    >
      <div className="pt-2">
        <Row label={t("Version")}>{info.data ? `${info.data.version} · ${info.data.install}` : "…"}</Row>
        <Row label={t("Affichage")}>{`${root.dataset.theme ?? "aurora"} · ${root.dataset.mode ?? "dark"} · ${Math.round(scale * 100)} %${root.dataset.lite === "on" ? ` · ${t("allégé")}` : ""}`}</Row>
        <Row label={t("Écran")}>{`${window.screen.width} × ${window.screen.height} · ${t("facteur {f}", { f: window.devicePixelRatio })} · ${t("fenêtre {w} × {h}", { w: window.innerWidth, h: window.innerHeight })}`}</Row>
        <Row label={t("Moteur web")}>{engine ? `WebKit ${engine}` : navigator.userAgent}</Row>
        <Row label={t("Démarrage")}>{ready !== null ? t("{ms} ms jusqu'à l'appli utilisable", { ms: ready }) : t("non mesuré")}</Row>
        <Row label={t("Requêtes en cache")}>{qc.getQueryCache().getAll().length}</Row>
        {(places.data ?? []).map((p) => (
          <Row key={p.kind} label={PLACE[p.kind] ?? p.kind}>
            <span className="flex items-center gap-2">
              <span className="min-w-0 truncate font-mono text-xs">{p.path}</span>
              <span className="shrink-0 text-xs text-faint">{formatBytes(p.bytes)}</span>
              {p.kind !== "session" && (
                <button type="button" className="shrink-0 text-faint hover:text-fg" title={t("Ouvrir le dossier")} aria-label={t("Ouvrir le dossier")} onClick={() => void api.dataOpen(p.kind as "data" | "cache")}>
                  <FolderOpen className="size-3.5" />
                </button>
              )}
            </span>
          </Row>
        ))}
      </div>
      {report.error && <ErrorNote title={t("Rapport impossible")}>{asAppError(report.error).message}</ErrorNote>}
      <ReportModal text={text} onClose={() => setText(null)} />
    </Section>
  );
}

function Services() {
  const my = useQuery({ queryKey: ["my-status"], queryFn: api.myStatus, staleTime: 10_000 });
  const connect = useQuery({ queryKey: CONNECT_KEY, queryFn: api.connectState, staleTime: 10_000 });
  const ai = useQuery({ queryKey: ["ai-provider-status"], queryFn: api.aiProviderStatus, staleTime: 30_000 });
  const env = useEnv();
  const missing = (env.data?.tools ?? []).filter((x) => !x.path);
  const m = my.data;
  const c = connect.data;
  return (
    <Section title={t("Services")}>
      <div className="pt-2">
        <Row label="MY Epitech">
          {m ? (
            <>
              <Dot tone={m.connected ? "ok" : "neutral"}>{m.connected ? t("session active") : m.sessionStored ? t("session gardée, non ouverte") : t("pas de session")}</Dot>
              {m.expiresAt ? ` · ${t("expire à {h}", { h: new Date(m.expiresAt * 1000).toLocaleTimeString() })}` : ""}
              {` · ${t("{n} routes", { n: m.routes })} · ${m.syncMinutes > 0 ? t("synchro toutes les {n} min", { n: m.syncMinutes }) : t("synchro manuelle")}`}
              {m.windowOpen ? ` · ${m.windowHidden ? t("fenêtre cachée ouverte") : t("fenêtre ouverte")}` : ""}
            </>
          ) : (
            <Spinner />
          )}
        </Row>
        <Row label="Connect">
          {c ? (
            <>
              <Dot tone={c.running ? "ok" : "neutral"}>{c.running ? t("à l'écoute") : c.enabled ? t("activé, arrêté") : t("désactivé")}</Dot>
              {c.running && c.ip ? ` · ${c.ip}:${c.port ?? "?"} · ${c.interface || "?"} · mDNS ${c.mdns ? t("oui") : t("non")} · ${t("{n} pairs", { n: c.peers.length })}` : ""}
              {c.problems.length > 0 && <span className="block text-xs text-warn">{c.problems.join(" · ")}</span>}
            </>
          ) : connect.error ? (
            asAppError(connect.error).message
          ) : (
            <Spinner />
          )}
        </Row>
        <Row label="Artix">{ai.data ? `${ai.data.provider}${ai.data.model ? ` · ${ai.data.model}` : ""} · ${ai.data.configured ? t("configuré") : t("non configuré")}${ai.data.detail ? ` · ${ai.data.detail}` : ""}` : <Spinner />}</Row>
        <Row label={t("Outils")}>
          {env.data ? (missing.length === 0 ? t("{n} outils trouvés", { n: env.data.tools.length }) : t("{n} absents : {list}", { n: missing.length, list: missing.map((x) => x.name).join(", ") })) : <Spinner />}
        </Row>
      </div>
    </Section>
  );
}

function Logs() {
  const [view, setView] = useState<"runs" | "my">("runs");
  const runs = useQuery({ queryKey: ["dev-runs"], queryFn: () => api.runsList(null, null, 30), enabled: view === "runs" });
  const my = useQuery({ queryKey: ["my-data"], queryFn: api.myData, enabled: view === "my" });
  const [open, setOpen] = useState<number | null>(null);
  const tab = (id: typeof view, label: string) => (
    <button type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`h-7 rounded-(--btn-radius) px-2.5 text-xs ${view === id ? "bg-ink/7 text-fg" : "text-muted hover:text-fg"}`}>
      {label}
    </button>
  );
  return (
    <Section
      title={t("Journaux")}
      action={
        <div role="tablist" aria-label={t("Journaux")} className="flex gap-0.5">
          {tab("runs", t("Tâches"))}
          {tab("my", t("Synchros MY Epitech"))}
        </div>
      }
    >
      {view === "runs" &&
        (runs.isLoading ? (
          <p className="py-3"><Spinner /></p>
        ) : (runs.data ?? []).length === 0 ? (
          <p className="py-3 text-sm text-muted">{t("Aucune tâche lancée.")}</p>
        ) : (
          <ul className="pt-1">
            {runs.data!.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setOpen(r.id)} className="ink-row flex h-9 w-full items-center gap-3 px-2 text-left text-sm">
                  <Dot tone={r.status === "success" ? "ok" : r.status === "failed" || r.status === "interrupted" ? "danger" : r.status === "warning" ? "warn" : "neutral"} />
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <span className="shrink-0 font-mono text-xs text-faint">{r.kind}</span>
                  <span className="w-24 shrink-0 text-right text-xs text-faint tabular-nums">{(r.durationMs / 1000).toFixed(1)} s · {timeAgo(r.startedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      {view === "my" &&
        ((my.data?.history ?? []).length === 0 ? (
          <p className="py-3 text-sm text-muted">{my.isLoading ? <Spinner /> : t("Aucune synchronisation")}</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto pt-1">
            {my.data!.history.map((h) => (
              <li key={h.at} className="selectable border-b border-line py-1.5 text-xs text-muted last:border-0">
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
      <RunLog id={open} onClose={() => setOpen(null)} />
    </Section>
  );
}

function RunLog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const run = useQuery<Run>({ queryKey: ["run", id], queryFn: () => api.runGet(id!), enabled: id !== null });
  return (
    <Modal open={id !== null} onClose={onClose} width="w-[820px]" title={run.data?.title ?? t("Journal")} description={run.data ? `${run.data.kind} · ${run.data.status} · ${timeAgo(run.data.startedAt)}` : undefined}>
      {run.isLoading ? (
        <p className="px-5 pb-4"><Spinner /></p>
      ) : run.error ? (
        <div className="px-5 pb-4"><ErrorNote>{asAppError(run.error).message}</ErrorNote></div>
      ) : (
        <pre className="selectable mx-5 mb-4 max-h-[60vh] overflow-auto rounded-lg bg-well p-3 font-mono text-xs whitespace-pre-wrap">{run.data?.log || t("Journal vide.")}</pre>
      )}
    </Modal>
  );
}

function Experiments() {
  const [myDetails, setMyDetails] = usePref<boolean>(MY_DETAILS_PREF, true);
  const setPage = useUi((s) => s.setPage);
  const toggle = (on: boolean, set: (v: boolean) => void, title: string, hint: string) => (
    <label className="flex items-start gap-3 py-3">
      <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>
        <span className="block text-sm">{title}</span>
        <span className="block text-xs text-faint">{hint}</span>
      </span>
    </label>
  );
  return (
    <Section title={t("Expérimental et diagnostic")}>
      <div className="divide-y divide-line">
        {toggle(myDetails, setMyDetails, t("Détails techniques de MY Epitech"), t("Réponses brutes de chaque route et historique des synchronisations, sur la page MY Epitech."))}
        <div className="flex items-center justify-between gap-3 py-3">
          <span>
            <span className="block text-sm">Cozy Fox</span>
            <span className="block text-xs text-faint">{t("Compagnon de bureau Cozy Glass. Ta configuration est gardée telle quelle.")}</span>
          </span>
          <Button size="sm" icon={<PawPrint className="size-3.5" />} onClick={() => setPage("cozy")}>
            {t("Ouvrir")}
          </Button>
        </div>
      </div>
    </Section>
  );
}

/** Whether MY Epitech shows its technical details: developer mode and the switch above. */
export function useMyDetails(): boolean {
  const [dev] = useDevMode();
  const [on] = usePref<boolean>(MY_DETAILS_PREF, true);
  return dev && on;
}
