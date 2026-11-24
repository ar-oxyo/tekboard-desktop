// The other tabs of a project sheet: its tests and checks, its documents.
import { useQuery } from "@tanstack/react-query";
import { FileText, FlaskConical, GitBranch, PackageOpen, ShieldCheck } from "lucide-react";
import { Badge, Button, Spinner } from "../../components/ui";
import { api, type RepoInfo, type RunKind } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useUi } from "../../lib/store";
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE } from "../testing/Report";
import { t } from "../../lib/i18n";

export function TestingTab({ repo }: { repo: RepoInfo }) {
  const openTesting = useUi((s) => s.openTesting);
  const runs = useQuery({ queryKey: ["runs", repo.path, "all"], queryFn: () => api.runsList(repo.path, null, 30), staleTime: 0 });
  // The most recent run of each kind: the project's current state at a glance.
  const latest = new Map<RunKind, NonNullable<typeof runs.data>[number]>();
  for (const r of runs.data ?? []) if (!latest.has(r.kind)) latest.set(r.kind, r);
  return (
    <div className="flex flex-col gap-3">
      {runs.isLoading ? <Spinner /> : latest.size === 0 ? (
        <p className="text-[13px] text-muted">{t("Rien n'a encore été lancé sur ce projet.")}</p>
      ) : (
        <ul className="rounded-lg border border-line bg-bg py-1">
          {[...latest.values()].map((r) => (
            <li key={r.id}>
              <button type="button" className="row-hover flex h-9 w-full items-center gap-2.5 px-3 text-left text-[13px]" onClick={() => { openTesting(repo.path); useUi.setState({ runId: r.id }); }}>
                <span className="w-36 shrink-0">{KIND_LABEL[r.kind] ?? r.kind}</span>
                <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                <span className="ml-auto text-xs text-faint">{timeAgo(r.startedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<FlaskConical className="size-3.5" />} onClick={() => openTesting(repo.path)}>{t("Ouvrir les tests")}</Button>
        <span className="flex items-center gap-1.5 text-xs text-muted"><GitBranch className="size-3.5" />TestRepo · <ShieldCheck className="size-3.5" />{t("Moulinette d'Artix, Banana et génération de tests sont là")}</span>
      </div>
    </div>
  );
}

export function DocsTab({ repo, subjects, onOpenSubject }: { repo: RepoInfo; subjects: Array<{ id: number; name: string }>; onOpenSubject: (id: number) => void }) {
  const openTool = useUi((s) => s.openTool);
  const setPage = useUi((s) => s.setPage);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="mb-1 block text-xs font-medium text-muted">Sujet</span>
        {subjects.length === 0 ? (
          <p className="text-[13px] text-muted">{t("Aucun sujet n'est lié.")} <button type="button" className="text-accent-strong hover:underline" onClick={() => { useUi.getState().closeSheet(); setPage("subjects"); }}>{t("Lie-en un depuis École → Sujets")}</button> {t("pour l'ouvrir d'ici et que la moulinette le lise.")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {subjects.map((s) => <li key={s.id}><Button size="sm" icon={<FileText className="size-3.5" />} onClick={() => onOpenSubject(s.id)}>{s.name}</Button></li>)}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button icon={<FileText className="size-3.5" />} onClick={() => openTool("readme", repo.path)}>{t("Générer le README")}</Button>
        <Button icon={<PackageOpen className="size-3.5" />} onClick={() => openTool("package", repo.path)}>{t("Paquet pour une IA")}</Button>
      </div>
      <p className="text-xs text-faint">{t("Le README est proposé, comparé à l'actuel et écrit seulement quand tu valides. L'archive est créée sur cet ordinateur et n'est envoyée nulle part.")}</p>
    </div>
  );
}
