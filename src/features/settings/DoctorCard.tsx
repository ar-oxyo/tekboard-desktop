// TekBoard Doctor: every dependency in one list, with its state, what it affects, how to fix it
// and, when it is safe, a button that fixes it. The report can be copied, anonymised, for a
// GitHub issue.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CircleDashed, CircleX, ClipboardCopy, RefreshCw, Stethoscope, Wrench } from "lucide-react";
import { useState } from "react";
import { Modal } from "../../components/Modal";
import { Badge, Button, Card, CardTitle, cn, Code, ErrorNote, Spinner } from "../../components/ui";
import { api, asAppError, type DoctorCheck, type DoctorStatus } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useUi } from "../../lib/store";
import { useMySync } from "../myepitech/useMySync";

export const DOCTOR_KEY = ["doctor"] as const;

const LOOK: Record<DoctorStatus, { icon: typeof CircleCheck; tone: string; label: string }> = {
  ok: { icon: CircleCheck, tone: "text-ok", label: t("fonctionnel") },
  warn: { icon: CircleAlert, tone: "text-warn", label: t("avertissement") },
  error: { icon: CircleX, tone: "text-danger", label: t("erreur") },
  unconfigured: { icon: CircleDashed, tone: "text-faint", label: t("non configuré") },
};

/** Problems that deserve the user's attention (errors only: warnings are not pushed at them). */
export function doctorProblems(checks: DoctorCheck[]): DoctorCheck[] {
  return checks.filter((c) => c.status === "error");
}

export function DoctorCard({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const sync = useMySync();
  const report = useQuery({ queryKey: DOCTOR_KEY, queryFn: () => api.doctorRun(false), staleTime: 60_000 });
  const deep = useMutation({ mutationFn: () => api.doctorRun(true), onSuccess: (r) => qc.setQueryData(DOCTOR_KEY, r) });
  const [confirm, setConfirm] = useState<DoctorCheck | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const fix = useMutation({
    mutationFn: (id: string) => api.doctorFix(id),
    onSuccess: (msg) => {
      toast({ kind: "ok", title: t("Réparé"), detail: msg });
      void qc.invalidateQueries({ queryKey: DOCTOR_KEY });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast({ kind: "error", title: t("Réparation impossible"), detail: asAppError(e).message }),
  });
  const exportReport = useMutation({ mutationFn: api.doctorExport, onSuccess: setExported, onError: (e) => toast({ kind: "error", title: t("Export impossible"), detail: asAppError(e).message }) });

  function act(c: DoctorCheck) {
    const a = c.action!;
    if (a.id.startsWith("fix:")) {
      if (a.confirm) setConfirm(c);
      else fix.mutate(a.id.slice(4));
    } else if (a.id.startsWith("open:")) {
      useUi.setState({ page: "settings", settingsTab: a.id.slice(5) });
      useUi.getState().setPage("settings");
    } else if (a.id === "my-connect") {
      void sync.sync().then(() => qc.invalidateQueries({ queryKey: DOCTOR_KEY }));
    }
  }

  const checks = report.data?.checks ?? [];
  const fixable = checks.filter((c) => c.status !== "ok" && c.action?.id.startsWith("fix:") && !c.action.confirm);
  const counts = (s: DoctorStatus) => checks.filter((c) => c.status === s).length;
  const shown = compact ? checks.filter((c) => c.category === "Outils" || c.category === "GitHub" || c.category === "Epitech") : checks;
  const categories = [...new Set(shown.map((c) => c.category))];
  const busy = report.isFetching || deep.isPending;

  return (
    <Card>
      <CardTitle
        right={
          <span className="flex items-center gap-2">
            {!compact && fixable.length > 0 && (
              <Button size="sm" icon={<Wrench className="size-3.5" />} busy={fix.isPending} onClick={() => fixable.forEach((c) => fix.mutate(c.action!.id.slice(4)))} title={t("Applique les réparations sans risque (permissions…). Celles qui modifient tes réglages demandent confirmation une par une.")}>
                {t("Réparer ({n})", { n: fixable.length })}
              </Button>
            )}
            {!compact && (
              <Button size="sm" variant="ghost" icon={<ClipboardCopy className="size-3.5" />} busy={exportReport.isPending} disabled={!report.data} onClick={() => exportReport.mutate()}>
                {t("Exporter le rapport")}
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<RefreshCw className={cn("size-3.5", busy && "anim-spin")} />} disabled={busy} onClick={() => deep.mutate()} title={t("Relance tout, avec un vrai test de l'IA et la recherche de mise à jour")}>
              {t("Relancer le diagnostic")}
            </Button>
          </span>
        }
      >
        <span className="flex items-center gap-2"><Stethoscope className="size-4 text-accent" /> TekBoard Doctor</span>
      </CardTitle>
      <div className="flex flex-col gap-4 p-4">
        {report.isLoading && <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> {t("Diagnostic en cours…")}</p>}
        {report.error && <ErrorNote>{asAppError(report.error).message}</ErrorNote>}
        {report.data && !compact && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="ok">{counts("ok")} {t("fonctionnel(s)")}</Badge>
            {counts("warn") > 0 && <Badge tone="warn">{counts("warn")} {t("avertissement(s)")}</Badge>}
            {counts("error") > 0 && <Badge tone="danger">{counts("error")} {t("erreur(s)")}</Badge>}
            {counts("unconfigured") > 0 && <Badge>{counts("unconfigured")} {t("non configuré(s)")}</Badge>}
            <span className="ml-auto text-faint">{report.data.system} · TekBoard {report.data.version}</span>
          </div>
        )}
        {categories.map((cat) => (
          <section key={cat}>
            <h3 className="mb-1.5 text-xs font-medium text-muted">{cat}</h3>
            <ul className="flex flex-col divide-y divide-ink/5 rounded-lg border border-line">
              {shown.filter((c) => c.category === cat).map((c) => {
                const L = LOOK[c.status];
                return (
                  <li key={c.id} className="anim-fade flex items-start gap-3 px-3 py-2 text-sm">
                    <L.icon className={cn("mt-0.5 size-4 shrink-0", L.tone)} aria-label={L.label} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium text-fg">{c.title}</span>
                        <span className="selectable min-w-0 text-xs break-words text-muted">{c.detail}</span>
                      </p>
                      {c.status !== "ok" && c.affects && <p className="text-xs text-faint">{t("Concerne : {what}", { what: c.affects })}</p>}
                      {c.status !== "ok" && c.command && <div className="mt-1"><Code>{c.command}</Code></div>}
                    </div>
                    {c.action && (c.status !== "ok" || c.action.id.startsWith("fix:")) && (
                      <Button size="sm" variant={c.status === "ok" ? "ghost" : "secondary"} busy={fix.isPending && fix.variables === c.action.id.slice(4)} onClick={() => act(c)}>
                        {c.action.label}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.action?.label ?? ""}
        description={confirm?.action?.confirm ?? ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>{t("Annuler")}</Button>
            <Button variant="primary" onClick={() => { fix.mutate(confirm!.action!.id.slice(4)); setConfirm(null); }}>{t("Confirmer")}</Button>
          </>
        }
      >
        <p className="px-5 pb-4 text-sm text-muted">{confirm?.detail}</p>
      </Modal>
      <Modal
        open={exported !== null}
        onClose={() => setExported(null)}
        width="w-[760px]"
        title={t("Rapport de diagnostic anonymisé")}
        description={t("Chemins personnels, comptes, e-mails, clés et jetons sont masqués. Relis-le avant de le partager.")}
        footer={
          <>
            <Button variant="ghost" onClick={() => void api.openHelpUrl("https://github.com/ar-oxyo/tekboard-desktop/issues/new")}>{t("Ouvrir une issue GitHub")}</Button>
            <Button variant="primary" icon={<ClipboardCopy className="size-3.5" />} onClick={() => void navigator.clipboard.writeText(exported ?? "").then(() => toast({ kind: "ok", title: t("Rapport copié") }), () => toast({ kind: "error", title: t("Copie impossible : sélectionne le texte et copie-le à la main.") }))}>
              {t("Copier")}
            </Button>
          </>
        }
      >
        <pre className="selectable mx-5 mb-4 max-h-[55vh] overflow-auto rounded-lg bg-well p-3 font-mono text-xs whitespace-pre-wrap">{exported}</pre>
      </Modal>
    </Card>
  );
}
