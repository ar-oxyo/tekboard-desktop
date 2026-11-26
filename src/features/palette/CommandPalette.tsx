// Ctrl+K: go anywhere, open any project, start an action, or ask Artix anything. Everything listed here does something real.
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Command } from "cmdk";
import { CalendarCheck, Code2, GitBranch, SquareTerminal, Inbox, Lightbulb, PenLine, Sparkles, FileText, FlaskConical, FolderGit2, LayoutTemplate, LibraryBig, NotebookPen, PackageOpen, Plus, RefreshCw, ScrollText, Timer, FileCode2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { isDevPage, SECTIONS } from "../../app/sections";
import { PAGE_ICON } from "../../app/pageIcons";
import { startFocus } from "../planning/Focus";
import { suggestPlan } from "../artix/suggest";
import { Badge } from "../../components/ui";
import { api } from "../../lib/api";
import { keys, useDevMode, useProjectActions, useRepos, useSettings, useSubjects, useTemplates } from "../../lib/hooks";
import { displayName } from "../../lib/repos";
import { useUi, type Page } from "../../lib/store";
import { usePlayground } from "../playground/store";
import { t } from "../../lib/i18n";
import { CTYPE_LABEL, KIND_LABEL } from "../../lib/brain";

const itemClass =
  "flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm text-muted data-[selected=true]:bg-accent-soft data-[selected=true]:text-fg";
const groupClass = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-normal [&_[cmdk-group-heading]]:text-faint ";

const ic = "size-4";
/** Every screen, with the shortcut of its section (Ctrl+1 to Ctrl+7 open the sections). */
const GO: Array<[Page, string, ReactNode, string | undefined]> = SECTIONS.flatMap((sec, i) => sec.pages.map((p, j) => [p.page, sec.pages.length > 1 ? `${sec.label} · ${p.label}` : sec.label, PAGE_ICON[p.page], j === 0 ? `Ctrl ${i + 1}` : undefined] as [Page, string, ReactNode, string | undefined]));
type ToolId = "testing" | "library" | "package" | "readme";
const TOOLS: Array<[ToolId, string, ReactNode]> = [
  ["testing", t("Tests (moulinette, zone de test)"), <FlaskConical className={ic} />],
  ["library", t("Bibliothèques"), <LibraryBig className={ic} />],
  ["package", t("Paquet pour une IA"), <PackageOpen className={ic} />],
  ["readme", t("Générer le README"), <ScrollText className={ic} />],
];

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const setPage = useUi((s) => s.setPage);
  const openLauncher = useUi((s) => s.openLauncher);
  const qc = useQueryClient();
  const settings = useSettings();
  const repos = useRepos((settings.data?.roots.length ?? 0) > 0);
  const templates = useTemplates();
  const subjects = useSubjects();
  const openSheet = useUi((s) => s.openSheet);
  const toast = useUi((s) => s.toast);
  const act = useProjectActions();
  const [search, setSearch] = useState("");
  const [dev] = useDevMode();
  const ask = (text: string) => run(() => useUi.getState().openAssistant({ text }));
  // Captures (and tasks) found by the search index, from two characters on.
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(search.trim()), 150);
    return () => window.clearTimeout(id);
  }, [search]);
  const captures = useQuery({ queryKey: ["brain", "palette", query], queryFn: () => api.brainList({ view: "all", query, limit: 6 }), enabled: open && query.length >= 2, placeholderData: (p) => p });

  const all = repos.data ?? [];
  const recent = [...all].filter((r) => r.meta.lastOpenedAt).sort((a, b) => (b.meta.lastOpenedAt ?? 0) - (a.meta.lastOpenedAt ?? 0)).slice(0, 5);
  const q = search.trim().toLowerCase();
  const focus = q.length >= 2 ? (all.find((r) => r.name.toLowerCase().startsWith(q) || displayName(r).toLowerCase().startsWith(q)) ?? null) : null;

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const go = (page: Page) => run(() => setPage(page));
  const tool = (id: ToolId, path: string) => {
    const ui = useUi.getState();
    if (id === "testing") ui.openTesting(path);
    else if (id === "library") ui.openLibrary(path);
    else ui.openTool(id, path);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim anim-fade fixed inset-0 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="glass anim-pop fixed top-[42%] left-1/2 z-50 w-[600px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden border border-ink/10 focus:outline-none"
        >
          <Dialog.Title className="sr-only">Palette de commandes</Dialog.Title>
          <Command loop label="Palette de commandes">
            <Command.Input autoFocus value={search} onValueChange={setSearch} aria-label={t("Rechercher un projet, un sujet, une action, ou demander à Artix")} placeholder={t("Rechercher, ou demander à Artix…")} className="h-12 w-full border-b border-ink/6 bg-transparent px-4 text-sm text-fg placeholder:text-faint focus:outline-none" />
            <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
              {/* Empty search: the projects opened last, first. */}
              {!search.trim() && recent.length > 0 && (
                <Command.Group heading={t("Récents")} className={groupClass}>
                  {recent.map((repo) => (
                    <Command.Item key={`recent-${repo.path}`} value={`recent ${repo.name} ${repo.path}`} onSelect={run(() => openSheet(repo.path))} className={itemClass}>
                      <FolderGit2 className="size-4 shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate">{displayName(repo)}</span>
                      <span className="text-xs text-faint">{repo.epitech?.module ?? repo.group}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {/* Typing a project's name offers what can be done with it. */}
              {focus && (
                <Command.Group heading={displayName(focus)} className={groupClass}>
                  {(
                    [
                      { label: t("Ouvrir l'espace de travail"), icon: <FolderGit2 className={ic} />, fn: () => act.workspace.mutate(focus) },
                      { label: t("Fiche du projet"), icon: <NotebookPen className={ic} />, fn: () => openSheet(focus.path) },
                      { label: t("Ouvrir dans l'IDE"), icon: <Code2 className={ic} />, fn: () => act.ide.mutate(focus) },
                      { label: t("Ouvrir un terminal ici"), icon: <SquareTerminal className={ic} />, fn: () => act.terminal.mutate(focus) },
                      { label: t("Git : commiter, envoyer"), icon: <GitBranch className={ic} />, fn: () => useUi.getState().openGit(focus.path) },
                      ...TOOLS.map(([id, label, icon]) => ({ label, icon, fn: () => tool(id, focus.path) })),
                    ] as Array<{ label: string; icon: ReactNode; fn: () => void }>
                  ).map((a) => (
                    <Command.Item key={`focus-${a.label}`} forceMount value={`${search} ${a.label}`} onSelect={run(a.fn)} className={itemClass}>
                      <span className="text-faint">{a.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{a.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {search.trim().length > 2 && (
                <Command.Group heading="Artix" className={groupClass}>
                  <Command.Item forceMount value={`artix ${search}`} onSelect={ask(search.trim())} className={itemClass}>
                    <Sparkles className="size-4 shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 truncate">
                      {t("Demander à Artix :")} <span className="text-fg">{search.trim()}</span>
                    </span>
                    <span className="text-2xs text-faint">Entrée</span>
                  </Command.Item>
                </Command.Group>
              )}

              {query.length >= 2 && (captures.data?.length ?? 0) > 0 && (
                <Command.Group heading={t("Captures")} className={groupClass}>
                  {captures.data!.map((c) => (
                    <Command.Item key={c.id} value={`capture-${c.id} ${search}`} onSelect={run(() => useUi.getState().openInbox({ view: c.kind === "task" ? "all" : c.archivedAt ? "archived" : "all", focus: c.id }))} className={itemClass}>
                      <span className="shrink-0 text-faint">
                        <Lightbulb className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      <span className="text-2xs text-faint">{c.kind === "idea" ? CTYPE_LABEL[c.ctype || "idea"] : KIND_LABEL[c.kind]}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading="Actions" className={groupClass}>
                <Item icon={<Plus className="size-4" />} onSelect={run(() => openLauncher({ mode: "new" }))} hint="Ctrl N">
                  {t("Nouveau projet : cloner et initialiser")}
                </Item>
                <Item icon={<PenLine className="size-4" />} onSelect={run(() => useUi.getState().setCaptureOpen(true))} hint="Ctrl I">
                  {t("Capture rapide : une tâche ou une idée")}
                </Item>
                <Item icon={<Inbox className="size-4" />} onSelect={run(() => useUi.getState().openInbox())}>
                  {t("Ouvrir l'Inbox (captures à ranger)")}
                </Item>
                <Item
                  icon={<FileCode2 className="size-4" />}
                  onSelect={run(async () => {
                    try {
                      const d = await api.playgroundCreate(t("Brouillon"), null, null);
                      usePlayground.getState().setActive(d.id);
                      await qc.invalidateQueries({ queryKey: ["playground"] });
                      setPage("playground");
                    } catch (e) {
                      toast({ kind: "error", title: t("Impossible de créer le brouillon"), detail: String((e as { message?: string }).message ?? e) });
                    }
                  })}
                >
                  {t("Nouveau brouillon C (Playground)")}
                </Item>
                <Item icon={<Sparkles className="size-4" />} onSelect={run(() => useUi.getState().openAssistant())} hint="Ctrl J">
                  {t("Ouvrir Artix")}
                </Item>
                <Item icon={<CalendarCheck className="size-4" />} onSelect={run(() => void suggestPlan("day"))}>
                  {t("Planifier ma journée")}
                </Item>
                <Item icon={<CalendarCheck className="size-4" />} onSelect={run(() => void suggestPlan("week"))}>
                  {t("Planifier ma semaine")}
                </Item>
                <Item icon={<Timer className="size-4" />} onSelect={run(() => startFocus({ title: t("Session de travail"), project: null, taskId: null, eventId: null, plannedMin: 45 }, false))}>
                  {t("Démarrer une session de 45 min")}
                </Item>
                <Item
                  icon={<RefreshCw className="size-4" />}
                  onSelect={run(() => {
                    void qc.invalidateQueries({ queryKey: keys.repos });
                    void qc.invalidateQueries({ queryKey: keys.candidates });
                    void qc.invalidateQueries({ queryKey: keys.env });
                  })}
                >
                  {t("Actualiser les dépôts et l'environnement")}
                </Item>
              </Command.Group>

              <Command.Group heading={t("Aller à")} className={groupClass}>
                {GO.filter(([page]) => dev || !isDevPage(page)).map(([page, label, icon, hint]) => (
                  <Item key={page} icon={icon} onSelect={go(page)} hint={hint}>
                    {label}
                  </Item>
                ))}
              </Command.Group>
              {(repos.data ?? []).length > 0 && (
                <Command.Group heading={t("Outils du projet")} className={groupClass}>
                  {(repos.data ?? []).filter((r) => r.progress !== "done").slice(0, 40).flatMap((repo) =>
                    TOOLS.map(([id, label, icon]) => (
                      <Command.Item key={`${id}-${repo.path}`} value={`${label} ${repo.name} ${repo.path}`} onSelect={run(() => tool(id, repo.path))} className={itemClass}>
                        <span className="text-faint">{icon}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {label} <span className="text-muted">— {repo.name}</span>
                        </span>
                      </Command.Item>
                    )),
                  )}
                </Command.Group>
              )}

              {(repos.data?.length ?? 0) > 0 && (
                <Command.Group heading={t("Ouvrir l'espace de travail")} className={groupClass}>
                  {repos.data!.map((repo) => (
                    <Command.Item key={repo.path} value={`${repo.name} ${repo.epitech?.module ?? ""} ${repo.group} ${repo.path}`} onSelect={run(() => act.workspace.mutate(repo))} className={itemClass}>
                      <FolderGit2 className="size-4 shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate">{displayName(repo)}</span>
                      {repo.epitech ? (
                        <Badge tone="accent" mono>
                          {repo.epitech.module}
                        </Badge>
                      ) : (
                        <span className="text-xs text-faint">{repo.group}</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {(repos.data?.length ?? 0) > 0 && (
                <Command.Group heading={t("Fiche du projet")} className={groupClass}>
                  {repos.data!.map((repo) => (
                    <Command.Item key={repo.path} value={`notes sheet deadline ${repo.name} ${repo.path}`} onSelect={run(() => openSheet(repo.path))} className={itemClass}>
                      <NotebookPen className="size-4 shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate">{displayName(repo)}</span>
                      {repo.meta.deadline && <span className="text-xs text-faint">{repo.meta.deadline}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {(subjects.data?.length ?? 0) > 0 && (
                <Command.Group heading={t("Sujets")} className={groupClass}>
                  {subjects.data!.map((s) => (
                    <Command.Item
                      key={s.id}
                      value={`subject pdf ${s.name} ${s.id}`}
                      onSelect={run(() => {
                        api.subjectOpen(s.id).catch((e) => toast({ kind: "error", title: t("Document non ouvert"), detail: String((e as { message?: string }).message ?? e) }));
                      })}
                      className={itemClass}
                    >
                      <FileText className="size-4 shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {(templates.data?.length ?? 0) > 0 && (
                <Command.Group heading={t("Modèles")} className={groupClass}>
                  {templates.data!.map((t) => (
                    <Command.Item key={t.id} value={`template ${t.name} ${t.id}`} onSelect={go("templates")} className={itemClass}>
                      <LayoutTemplate className="size-4 shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                      <span className="text-xs text-faint">{t.fileCount} fichiers</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Item({ icon, children, onSelect, hint }: { icon: ReactNode; children: ReactNode; onSelect: () => void; hint?: string }) {
  return (
    <Command.Item onSelect={onSelect} className={itemClass}>
      <span className="shrink-0 text-faint">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-2xs text-faint">{hint}</span>}
    </Command.Item>
  );
}
