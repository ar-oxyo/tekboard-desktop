// Subjects library: PDF copies kept by TekBoard, linked to projects.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, FilePlus2, FileText, GraduationCap, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Select } from "../../components/Select";
import { Badge, Button, Card, CardTitle, EmptyState, ErrorNote, IconButton, Input, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type RepoInfo, type Subject, type SubjectImportResult, type SubjectSuggestion } from "../../lib/api";
import { formatBytes, tildify, timeAgo } from "../../lib/format";
import { keys, useHome, useRepos, useSettings, useSubjects } from "../../lib/hooks";
import { displayName, repoOptions } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { useMySync } from "../myepitech/useMySync";
import { t } from "../../lib/i18n";

export function SubjectsPage() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const settings = useSettings();
  const repos = useRepos((settings.data?.roots.length ?? 0) > 0, { all: true });
  const subjects = useSubjects();
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);

  const mySync = useMySync();
  // Opening the screen ties what can be tied for sure, and lists what needs a yes or a no.
  const assoc = useQuery({ queryKey: ["subjects", "associate"], queryFn: api.subjectsAssociate, staleTime: 0 });
  const repoList = repos.data ?? [];
  const list = subjects.data ?? [];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    const byPath = new Map(repoList.map((r) => [r.path, displayName(r).toLowerCase()]));
    return list.filter((s) => s.name.toLowerCase().includes(q) || (s.repoPath ? (byPath.get(s.repoPath) ?? "").includes(q) : false));
  }, [list, query, repoList]);

  const report = (results: SubjectImportResult[]) => {
    const added = results.filter((r) => r.subject && !r.duplicate).length;
    const dup = results.filter((r) => r.duplicate).length;
    const failed = results.filter((r) => r.error);
    void qc.invalidateQueries({ queryKey: keys.subjects });
    void qc.invalidateQueries({ queryKey: keys.activity });
    if (failed.length > 0) toast({ kind: "error", title: `${failed.length} fichier${failed.length === 1 ? "" : "s"} non importé${failed.length === 1 ? "" : "s"}`, detail: failed[0].error ?? undefined });
    if (added + dup > 0) toast({ kind: "ok", title: `${added} document${added === 1 ? "" : "s"} added`, detail: dup > 0 ? `${dup} already in the library (same content) — skipped.` : undefined });
  };

  async function addFiles() {
    const picked = await open({ multiple: true, title: t("Ajouter des sujets"), filters: [{ name: "PDF", extensions: ["pdf"] }] });
    const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    if (paths.length === 0) return;
    try {
      report(await api.subjectsImport(paths.map((path) => ({ path, repoPath: null }))));
    } catch (e) {
      toast({ kind: "error", title: t("Import échoué"), detail: asAppError(e).message });
    }
  }

  return (
    <>
      <PageHeader
        title={t("Sujets")}
        subtitle={t("Tes sujets et documents de cours, au même endroit et liés à leur projet.")}
        actions={
          <>
            <Button variant="ghost" icon={<GraduationCap className="size-4" />} busy={mySync.busy} onClick={() => void mySync.sync()} title={t("Synchronise MY Epitech : télécharge les sujets des projets en cours et les associe à leur dépôt.")}>
              {mySync.busy ? mySync.label : t("Sujets de MY Epitech")}
            </Button>
            <Button icon={<FilePlus2 className="size-4" />} onClick={() => void addFiles()}>
              {t("Ajouter des fichiers…")}
            </Button>
            <Button variant="primary" icon={<Download className="size-4" />} onClick={() => setScanning(true)}>
              {t("Importer depuis Téléchargements")}
            </Button>
          </>
        }
      />

      {scanning && <ScanPanel repos={repoList} onClose={() => setScanning(false)} onImported={report} />}

      {(assoc.data?.suggestions.length ?? 0) > 0 && <Suggestions items={assoc.data!.suggestions} subjects={list} repos={repoList} />}

      {subjects.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted">
          <Spinner /> {t("Chargement…")}
        </p>
      ) : subjects.error ? (
        <ErrorNote>{asAppError(subjects.error).message}</ErrorNote>
      ) : list.length === 0 ? (
        !scanning && (
          <Card>
            <EmptyState icon={<FileText className="size-6" />} title={t("Aucun sujet")} action={<Button onClick={() => setScanning(true)}>{t("Importer depuis Téléchargements")}</Button>}>
              {t("TekBoard copie les PDF choisis dans sa bibliothèque et propose le projet de chacun. Tes téléchargements restent où ils sont.")}
            </EmptyState>
          </Card>
        )
      ) : (
        <>
          <div className="relative mb-3 w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input className="pl-8" aria-label={t("Filtrer par nom ou projet")} placeholder="Filtrer" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Card>
            {shown.length === 0 ? (
              <EmptyState title={t("Rien ne correspond")}>{t("Essaie une autre recherche.")}</EmptyState>
            ) : (
              <ul>
                {shown.map((s) => (
                  <SubjectRow key={s.id} subject={s} repos={repoList} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}

/** Links TekBoard was not sure enough about to make alone. */
function Suggestions({ items, subjects, repos }: { items: SubjectSuggestion[]; subjects: Subject[]; repos: RepoInfo[] }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const decide = useMutation({
    mutationFn: ({ s, accept }: { s: SubjectSuggestion; accept: boolean }) => api.subjectSuggestionDecide(s.subjectId, s.repoPath, accept),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.subjects }),
    onError: (e) => toast({ kind: "error", title: t("Non enregistré"), detail: asAppError(e).message }),
  });
  return (
    <Card className="mb-4">
      <CardTitle>{t("Associations à valider")}</CardTitle>
      <p className="border-b border-white/6 px-4 pb-2 text-xs text-faint">{t("TekBoard n'associe seul que ce qui est certain (même projet MY Epitech, ou un seul dépôt du même nom). Pour le reste, il demande.")}</p>
      <ul className="py-1">
        {items.map((it) => {
          const sub = subjects.find((x) => x.id === it.subjectId);
          const repo = repos.find((r) => r.path === it.repoPath);
          if (!sub) return null;
          return (
            <li key={`${it.subjectId}-${it.repoPath}`} className="flex min-h-10 items-center gap-3 px-4 text-[13px]">
              <FileText className="size-4 shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate font-medium">{sub.name}</span>
              <span className="text-faint">→</span>
              <span className="min-w-0 flex-1 truncate" title={it.repoPath}>{repo ? displayName(repo) : it.repoPath}</span>
              <span className="hidden w-40 shrink-0 truncate text-xs text-faint md:block">{it.reason}</span>
              <Button size="sm" variant="primary" busy={decide.isPending} onClick={() => decide.mutate({ s: it, accept: true })}>
                {t("Associer")}
              </Button>
              <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ s: it, accept: false })}>
                {t("Ce n'est pas ça")}
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ProjectSelect({ value, repos, onChange, className }: { value: string | null; repos: RepoInfo[]; onChange: (path: string | null) => void; className?: string }) {
  return (
    <Select className={className} value={value ?? ""} label={t("Projet")} onChange={(v) => onChange(v || null)} options={[{ value: "", label: t("Aucun projet") }, ...repoOptions(repos)]} />
  );
}

function SubjectRow({ subject, repos }: { subject: Subject; repos: RepoInfo[] }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [armed, setArmed] = useState(false);
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.subjects });
  const openDoc = useMutation({ mutationFn: () => api.subjectOpen(subject.id), onError: fail("Could not open the document") });
  const link = useMutation({ mutationFn: (path: string | null) => api.subjectLink(subject.id, path), onSuccess: refresh, onError: fail("Could not link") });
  const remove = useMutation({ mutationFn: () => api.subjectRemove(subject.id), onSuccess: refresh, onError: fail("Could not remove") });
  const missing = subject.repoPath !== null && !repos.some((r) => r.path === subject.repoPath);
  const briefs = useQuery({ queryKey: ["subject-briefs"], queryFn: api.subjectBriefs });
  const brief = briefs.data?.[String(subject.id)];
  const analyze = useMutation({ mutationFn: () => api.subjectAnalyze(subject.id), onSuccess: () => toast({ kind: "info", title: t("Artix lit le sujet"), detail: t("Le résumé sera gardé : le PDF ne sera plus relu.") }), onError: fail("Sujet non analysé") });

  return (
    <li className="group flex h-12 items-center gap-3 border-b border-white/6 pr-2 pl-4 last:border-b-0 row-hover">
      <FileText className="size-4 shrink-0 text-faint" />
      <button type="button" onClick={() => openDoc.mutate()} className="selectable min-w-0 flex-[2] truncate text-left text-[13px] font-medium hover:text-accent-strong" title="Ouvrir">
        {subject.name}
      </button>
      {missing && <Badge tone="warn" title={t("Le dépôt lié n'est plus dans tes dossiers de projets")}>{t("projet introuvable")}</Badge>}
      {brief ? (
        <Badge tone={brief.stale ? "warn" : "ok"} title={brief.brief.summary ?? ""}>
          {brief.stale ? t("résumé périmé") : `lu${brief.brief.estimateTotalMin ? ` · ~${Math.round(brief.brief.estimateTotalMin / 60)} h` : ""}`}
        </Badge>
      ) : null}
      {(!brief || brief.stale) && (
        <Button size="sm" variant="ghost" busy={analyze.isPending} onClick={() => analyze.mutate()} title={t("Artix lit le sujet une fois et en garde les exigences et une estimation")}>
          {t("Analyser")}
        </Button>
      )}
      <ProjectSelect className="w-52 shrink-0" value={missing ? null : subject.repoPath} repos={repos} onChange={(p) => link.mutate(p)} />
      <span className="hidden w-16 shrink-0 text-right text-xs text-faint md:block">{formatBytes(subject.size)}</span>
      <span className="hidden w-24 shrink-0 text-right text-xs text-faint lg:block">{timeAgo(subject.addedAt)}</span>
      {armed ? (
        <span className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
            {t("Supprimer la copie")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>
            {t("Garder")}
          </Button>
        </span>
      ) : (
        <IconButton label={t("Retirer de la bibliothèque")} className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => setArmed(true)}>
          <Trash2 className="size-4" />
        </IconButton>
      )}
    </li>
  );
}

function ScanPanel({ repos, onClose, onImported }: { repos: RepoInfo[]; onClose: () => void; onImported: (r: SubjectImportResult[]) => void }) {
  const home = useHome();
  const scan = useQuery({ queryKey: ["subjects-scan"], queryFn: () => api.subjectsScan(), staleTime: 0, gcTime: 0 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [links, setLinks] = useState<Record<string, string | null>>({});
  const [ready, setReady] = useState(false);

  const files = useMemo(() => (scan.data?.files ?? []).filter((f) => !f.inLibrary), [scan.data]);
  const already = (scan.data?.files.length ?? 0) - files.length;

  // Pre-tick only the documents a project was found for; the rest stay opt-in.
  useEffect(() => {
    if (!scan.data || ready) return;
    setPicked(new Set(files.filter((f) => f.suggestedRepo).map((f) => f.path)));
    setLinks(Object.fromEntries(files.map((f) => [f.path, f.suggestedRepo])));
    setReady(true);
  }, [scan.data, files, ready]);

  const run = useMutation({
    mutationFn: () => api.subjectsImport(files.filter((f) => picked.has(f.path)).map((f) => ({ path: f.path, repoPath: links[f.path] ?? null }))),
    onSuccess: (results) => {
      onImported(results);
      onClose();
    },
  });

  const toggle = (path: string) => {
    const next = new Set(picked);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setPicked(next);
  };

  return (
    <Card className="mb-4">
      <CardTitle
        right={
          <span className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t("Annuler")}
            </Button>
            <Button size="sm" variant="primary" disabled={picked.size === 0} busy={run.isPending} onClick={() => run.mutate()}>
              Import {picked.size || ""}
            </Button>
          </span>
        }
      >
        {scan.data ? `PDFs in ${tildify(scan.data.dir, home)}` : "Downloads"}
      </CardTitle>
      {scan.isLoading ? (
        <p className="flex items-center gap-2 px-4 py-5 text-[13px] text-muted">
          <Spinner /> {t("Lecture de tes téléchargements…")}
        </p>
      ) : scan.error ? (
        <div className="p-3">
          <ErrorNote>{asAppError(scan.error).message}</ErrorNote>
        </div>
      ) : files.length === 0 ? (
        <p className="px-4 py-5 text-[13px] text-muted">{already > 0 ? "Every PDF in this folder is already in the library." : "No PDF in this folder."}</p>
      ) : (
        <>
          <p className="border-b border-white/6 px-4 py-2 text-xs text-faint">
            Files are copied, never moved. Ticked ones matched a project by name — check the suggestion before importing.
            {already > 0 && ` ${already} already in the library ${already === 1 ? "is" : "are"} hidden.`}
          </p>
          <ul className="max-h-[340px] overflow-y-auto py-1">
            {files.map((f) => (
              <li key={f.path} className="flex h-10 items-center gap-3 px-4 row-hover">
                <input type="checkbox" className="accent-(--color-accent)" aria-label={`Import ${f.name}`} checked={picked.has(f.path)} onChange={() => toggle(f.path)} />
                <span className="selectable min-w-0 flex-[2] truncate text-[13px]">{f.name}</span>
                {f.suggestedRepo && links[f.path] === f.suggestedRepo && <Badge tone="accent">suggested</Badge>}
                <ProjectSelect className="w-52 shrink-0" value={links[f.path] ?? null} repos={repos} onChange={(p) => setLinks({ ...links, [f.path]: p })} />
                <span className="hidden w-16 shrink-0 text-right text-xs text-faint md:block">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {run.error && (
        <div className="p-3">
          <ErrorNote>{asAppError(run.error).message}</ErrorNote>
        </div>
      )}
    </Card>
  );
}
