// Ctrl+K: navigate, open any project, start an action. Everything listed here does something real.
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Command } from "cmdk";
import { ChartNoAxesColumn, FileText, FlaskConical, FolderGit2, GitBranch, LayoutDashboard, LayoutTemplate, LibraryBig, NotebookPen, PackageOpen, PawPrint, Plus, RefreshCw, ScrollText, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../../components/ui";
import { api } from "../../lib/api";
import { keys, useProjectActions, useRepos, useSettings, useSubjects, useTemplates } from "../../lib/hooks";
import { displayName } from "../../lib/repos";
import { useUi, type Page } from "../../lib/store";

const itemClass =
  "flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted data-[selected=true]:bg-accent-soft data-[selected=true]:text-fg";
const groupClass = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase";

const ic = "size-4";
const GO: Array<[Page, string, ReactNode]> = [
  ["overview", "Overview", <LayoutDashboard className={ic} />],
  ["projects", "Projects", <FolderGit2 className={ic} />],
  ["git", "Git", <GitBranch className={ic} />],
  ["library", "Library", <LibraryBig className={ic} />],
  ["testing", "Testing", <FlaskConical className={ic} />],
  ["subjects", "Subjects", <FileText className={ic} />],
  ["analytics", "Analytics", <ChartNoAxesColumn className={ic} />],
  ["templates", "Templates", <LayoutTemplate className={ic} />],
  ["cozy", "Cozy Fox", <PawPrint className={ic} />],
  ["settings", "Settings", <Settings className={ic} />],
];
type ToolId = "testing" | "library" | "package" | "readme";
const TOOLS: Array<[ToolId, string, ReactNode]> = [
  ["testing", "Test, TestRepo, Banana", <FlaskConical className={ic} />],
  ["library", "Library functions", <LibraryBig className={ic} />],
  ["package", "Package for AI", <PackageOpen className={ic} />],
  ["readme", "Generate README", <ScrollText className={ic} />],
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
          className="glass anim-pop fixed top-[42%] left-1/2 z-50 w-[600px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden border border-white/10 focus:outline-none"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command loop label="Command palette">
            <Command.Input autoFocus placeholder="Search projects, templates, actions…" className="h-12 w-full border-b border-white/6 bg-transparent px-4 text-sm text-fg placeholder:text-faint focus:outline-none" />
            <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-[13px] text-muted">Nothing matches.</Command.Empty>

              <Command.Group heading="Actions" className={groupClass}>
                <Item icon={<Plus className="size-4" />} onSelect={run(() => openLauncher({ mode: "new" }))} hint="Ctrl N">
                  New project — clone and initialize
                </Item>
                <Item
                  icon={<RefreshCw className="size-4" />}
                  onSelect={run(() => {
                    void qc.invalidateQueries({ queryKey: keys.repos });
                    void qc.invalidateQueries({ queryKey: keys.candidates });
                    void qc.invalidateQueries({ queryKey: keys.env });
                  })}
                >
                  Refresh repositories and environment
                </Item>
              </Command.Group>

              <Command.Group heading="Go to" className={groupClass}>
                {GO.map(([page, label, icon], n) => (
                  <Item key={page} icon={icon} onSelect={go(page)} hint={n < 9 ? `Ctrl ${n + 1}` : undefined}>
                    {label}
                  </Item>
                ))}
              </Command.Group>
              {(repos.data ?? []).length > 0 && (
                <Command.Group heading="Project tools" className={groupClass}>
                  {(repos.data ?? []).filter((r) => !r.meta.archived).slice(0, 40).flatMap((repo) =>
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
                <Command.Group heading="Open workspace" className={groupClass}>
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
                <Command.Group heading="Notes & deadline" className={groupClass}>
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
                <Command.Group heading="Subjects" className={groupClass}>
                  {subjects.data!.map((s) => (
                    <Command.Item
                      key={s.id}
                      value={`subject pdf ${s.name} ${s.id}`}
                      onSelect={run(() => {
                        api.subjectOpen(s.id).catch((e) => toast({ kind: "error", title: "Could not open the document", detail: String((e as { message?: string }).message ?? e) }));
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
                <Command.Group heading="Templates" className={groupClass}>
                  {templates.data!.map((t) => (
                    <Command.Item key={t.id} value={`template ${t.name} ${t.id}`} onSelect={go("templates")} className={itemClass}>
                      <LayoutTemplate className="size-4 shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                      <span className="text-xs text-faint">{t.fileCount} files</span>
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
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </Command.Item>
  );
}
