// The Brain Dump inbox: what was captured on the fly, sorted later. A dialog, no page of its
// own. Every action changes the same row (a capture turned into a task is that task), and
// suggestions (local rules, or Artix when asked) are applied only when clicked.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Bookmark, Check, Code2, FolderGit2, ListTodo, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Send, Sparkles, SquareTerminal, StickyNote, Trash2, ExternalLink, Inbox as InboxIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, asAppError, type Capture, type CaptureKind, type CaptureSuggestion, type CaptureView } from "../../lib/api";
import { codeOf, CTYPE_LABEL, isC, KIND_LABEL, linksOf, shareOf, suggestProject } from "../../lib/brain";
import { useRepos } from "../../lib/hooks";
import { useJob } from "../../lib/jobs";
import { displayName } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { locale, t } from "../../lib/i18n";
import { Modal } from "../../components/Modal";
import { Menu, MenuItem, MenuSeparator } from "../../components/Menu";
import { ProjectPicker } from "../../components/ProjectPicker";
import { Badge, Button, cn, EmptyState, IconButton, Input, Spinner } from "../../components/ui";
import { usePlayground } from "../playground/store";
import { CaptureEditor } from "./CaptureEditor";
import { CaptureText } from "./CaptureText";

const VIEWS: Array<{ id: CaptureView; label: string }> = [
  { id: "inbox", label: t("Inbox") },
  { id: "pinned", label: t("Épinglées") },
  { id: "notes", label: t("Notes") },
  { id: "snippets", label: t("Snippets") },
  { id: "archived", label: t("Archivées") },
  { id: "all", label: t("Tout") },
];

export function InboxDialog() {
  const inbox = useUi((s) => s.inbox);
  return inbox ? <Inbox initial={inbox} /> : null;
}

function when(at: number): string {
  const d = new Date(at * 1000);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same ? d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(locale(), { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function Inbox({ initial }: { initial: { view: CaptureView; query: string; focus: number | null } }) {
  const close = () => useUi.getState().closeInbox();
  const [view, setView] = useState<CaptureView>(initial.view);
  const [query, setQuery] = useState(initial.query);
  const [q, setQ] = useState(initial.query);
  const [selected, setSelected] = useState<number | null>(initial.focus);
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setQ(query), 150);
    return () => window.clearTimeout(id);
  }, [query]);
  const list = useQuery({ queryKey: ["brain", "list", view, q], queryFn: () => api.brainList({ view: q.trim() && view === "inbox" ? "kept" : view, query: q }), placeholderData: (p) => p });
  const count = useQuery({ queryKey: ["brain-count"], queryFn: api.brainCount });
  const items = list.data ?? [];
  const current = items.find((c) => c.id === selected) ?? items[0] ?? null;

  return (
    <Modal open onClose={close} title={t("Inbox")} description={t("Tes captures, à ranger quand tu as le temps. Recherche : mots, #tag, projet:nom, type:bug, hier.")} width="w-[960px]">
      <div className="flex h-[66vh] min-h-[420px] gap-4">
        <div className="flex w-[340px] shrink-0 flex-col gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input autoFocus={!initial.focus} className="h-8 pl-8 text-sm" placeholder={t("Rechercher une idée…")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" onClick={() => setView(v.id)} className={cn("h-6 rounded-md px-2 text-2xs transition-colors duration-150", view === v.id ? "bg-accent-soft text-accent-strong" : "text-faint hover:bg-ink/5 hover:text-fg")}>
                {v.label}
                {v.id === "inbox" && (count.data ?? 0) > 0 && <span className="ml-1 tabular-nums opacity-70">{count.data}</span>}
              </button>
            ))}
          </div>
          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            {list.isLoading && <Spinner />}
            {list.error && <p className="text-xs text-danger">{asAppError(list.error).message}</p>}
            {!list.isLoading && items.length === 0 && (
              <EmptyState icon={<InboxIcon className="size-5" />} title={q ? t("Rien ne correspond") : view === "inbox" ? t("Inbox vide") : t("Rien ici")}>
                {!q && view === "inbox" && t("Ctrl+I depuis TekBoard, ou ton raccourci global, pour noter une idée en deux secondes.")}
              </EmptyState>
            )}
            <ul className="flex flex-col gap-1">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(c.id);
                      setWriting(false);
                    }}
                    className={cn("flex w-full flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors duration-150", current?.id === c.id ? "border-accent/35 bg-accent-soft/40" : "border-transparent hover:bg-ink/4")}
                  >
                    <span className="flex items-center gap-1.5">
                      {c.pinned && <Pin className="size-3 shrink-0 text-accent-strong" />}
                      <span className="truncate text-sm text-fg">{c.title}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-2xs text-faint">
                      <span>{c.kind === "idea" ? CTYPE_LABEL[c.ctype || "idea"] : KIND_LABEL[c.kind]}</span>
                      <span>·</span>
                      <span>{when(c.createdAt)}</span>
                      {c.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-accent-strong/80">
                          #{tag}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setWriting(true)}>
            {t("Nouvelle capture")}
          </Button>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto border-l border-ink/6 pl-4">
          {writing ? (
            <div className="flex h-full flex-col gap-2">
              <p className="text-sm font-medium text-fg">{t("Nouvelle capture")}</p>
              <CaptureEditor
                onClose={() => setWriting(false)}
                onSaved={(c, keep) => {
                  setSelected(c.id);
                  if (!keep) setWriting(false);
                }}
              />
            </div>
          ) : current ? (
            <Detail key={current.id} c={current} onGone={() => setSelected(null)} />
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function Detail({ c, onGone }: { c: Capture; onGone: () => void }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const repos = useRepos(true, { all: true });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.text);
  const [linking, setLinking] = useState(false);
  const [tagInput, setTagInput] = useState<string | null>(null);
  const [artixJob, setArtixJob] = useState<number | null>(null);
  const similar = useQuery({ queryKey: ["brain", "similar", c.id], queryFn: () => api.brainSimilar(c.id), enabled: c.kind !== "task" });
  const provider = useQuery({ queryKey: ["ai-provider-status"], queryFn: api.aiProviderStatus, staleTime: 60_000 });
  const repoList = repos.data ?? [];
  const projectName = (path: string | null) => {
    const r = path ? repoList.find((x) => x.path === path) : null;
    return r ? displayName(r) : path?.split("/").pop() ?? null;
  };
  const suggested = useMemo(() => (c.project ? null : suggestProject(c.text, repoList)), [c.project, c.text, repoList]);
  const code = codeOf(c);
  const links = linksOf(c.text);

  const run = async (what: Promise<Capture>, done?: string) => {
    try {
      await what;
      if (done) toast({ kind: "ok", title: done });
    } catch (e) {
      toast({ kind: "error", title: t("Impossible"), detail: asAppError(e).message });
    }
  };
  const convert = (kind: CaptureKind) => run(api.brainConvert(c.id, kind), kind === "task" ? t("Transformée en tâche : elle est dans le Planning") : kind === "note" ? t("Gardée comme note") : kind === "snippet" ? t("Gardée comme snippet") : t("Remise dans l'Inbox"));
  const remove = async () => {
    try {
      const gone = await api.brainDelete(c.id);
      onGone();
      toast({ kind: "info", title: t("Capture supprimée"), detail: gone.title, action: { label: t("Annuler"), run: () => void api.brainRestore(gone) } });
    } catch (e) {
      toast({ kind: "error", title: t("Impossible"), detail: asAppError(e).message });
    }
  };
  const toPlayground = async () => {
    if (!code) return;
    try {
      const d = await api.playgroundCreate(c.title.slice(0, 80), [{ name: "main.c", content: code.code, library: null }], null);
      usePlayground.getState().setActive(d.id);
      void qc.invalidateQueries({ queryKey: ["playground"] });
      useUi.getState().closeInbox();
      useUi.getState().setPage("playground");
    } catch (e) {
      toast({ kind: "error", title: t("Impossible"), detail: asAppError(e).message });
    }
  };
  const askArtix = async () => {
    try {
      setArtixJob(await api.brainArtix(c.id, repoList.map((r) => [r.path, displayName(r)] as [string, string])));
    } catch (e) {
      toast({ kind: "error", title: t("Artix n'est pas disponible"), detail: asAppError(e).message });
    }
  };
  const aiReady = provider.data ? provider.data.provider !== "none" && provider.data.configured : false;

  return (
    <div className="flex flex-col gap-3 pb-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={c.kind === "task" ? "accent" : "neutral"}>{c.kind === "idea" ? CTYPE_LABEL[c.ctype || "idea"] : KIND_LABEL[c.kind]}</Badge>
            {c.archivedAt && <Badge>{t("Archivée")}</Badge>}
            {c.project && (
              <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => useUi.getState().openSheet(c.project!)}>
                <FolderGit2 className="mr-1 inline size-3.5" />
                {projectName(c.project)}
              </button>
            )}
            <span className="text-2xs text-faint">{new Date(c.createdAt * 1000).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
        </div>
        <IconButton label={c.pinned ? t("Désépingler") : t("Épingler")} active={c.pinned} onClick={() => void run(api.brainPin(c.id, !c.pinned))}>
          {c.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </IconButton>
        <IconButton label={t("Modifier")} onClick={() => setEditing(!editing)}>
          <Pencil className="size-4" />
        </IconButton>
        <Menu trigger={<MoreHorizontal className="size-4" />} label={t("Actions")}>
          <MenuItem icon={<FolderGit2 className="size-3.5" />} onSelect={() => setLinking(true)}>
            {c.project ? t("Changer de projet") : t("Associer à un projet")}
          </MenuItem>
          {c.kind !== "task" && (
            <MenuItem icon={<ListTodo className="size-3.5" />} onSelect={() => void convert("task")}>
              {t("Transformer en tâche")}
            </MenuItem>
          )}
          {c.kind !== "note" && c.kind !== "task" && (
            <MenuItem icon={<StickyNote className="size-3.5" />} onSelect={() => void convert("note")}>
              {t("Garder comme note")}
            </MenuItem>
          )}
          {c.kind !== "snippet" && c.kind !== "task" && (
            <MenuItem icon={<Code2 className="size-3.5" />} onSelect={() => void convert("snippet")}>
              {t("Garder comme snippet")}
            </MenuItem>
          )}
          {(c.kind === "note" || c.kind === "snippet") && (
            <MenuItem icon={<InboxIcon className="size-3.5" />} onSelect={() => void convert("idea")}>
              {t("Remettre dans l'Inbox")}
            </MenuItem>
          )}
          <MenuItem icon={<Bookmark className="size-3.5" />} onSelect={() => setTagInput(c.tags.join(" "))}>
            {t("Tags…")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Send className="size-3.5" />} onSelect={() => useUi.getState().openShare(shareOf(c))}>
            {t("Partager avec TekShare…")}
          </MenuItem>
          {code && isC(code.lang) && (
            <MenuItem icon={<SquareTerminal className="size-3.5" />} onSelect={() => void toPlayground()}>
              {t("Ouvrir dans Code Playground")}
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem icon={c.archivedAt ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />} onSelect={() => void run(api.brainArchive(c.id, !c.archivedAt), c.archivedAt ? t("Désarchivée") : t("Archivée"))}>
            {c.archivedAt ? t("Désarchiver") : t("Archiver")}
          </MenuItem>
          <MenuItem danger icon={<Trash2 className="size-3.5" />} onSelect={() => void remove()}>
            {t("Supprimer")}
          </MenuItem>
        </Menu>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            className="selectable w-full resize-y rounded-lg border border-ink/8 bg-well px-3 py-2.5 font-[inherit] text-sm leading-relaxed text-fg focus:border-accent/50 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void run(api.brainEdit(c.id, text)).then(() => setEditing(false));
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t("Annuler")}
            </Button>
            <Button size="sm" variant="primary" onClick={() => void run(api.brainEdit(c.id, text)).then(() => setEditing(false))}>
              {t("Enregistrer")}
            </Button>
          </div>
        </div>
      ) : (
        <CaptureText text={c.text || c.title} className="text-fg/90" />
      )}

      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {links.slice(0, 5).map((u) => (
            <Button key={u} size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => void api.brainOpenLink(c.id, u).catch((e) => toast({ kind: "error", title: t("Impossible"), detail: asAppError(e).message }))}>
              <span className="max-w-[260px] truncate">{u.replace(/^https?:\/\//, "")}</span>
            </Button>
          ))}
        </div>
      )}

      {linking && (
        <div className="flex items-end gap-2">
          <ProjectPicker
            size="sm"
            className="w-72"
            value={c.project}
            includeNone
            onChange={(p) => {
              setLinking(false);
              void run(api.brainSetProject(c.id, p));
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => setLinking(false)}>
            {t("Fermer")}
          </Button>
        </div>
      )}
      {tagInput !== null && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(api.brainTags(c.id, tagInput.split(/[\s,]+/).filter(Boolean)));
            setTagInput(null);
          }}
        >
          <Input autoFocus className="h-8 flex-1 text-sm" placeholder={t("tags séparés par des espaces")} value={tagInput} onChange={(e) => setTagInput(e.target.value)} />
          <Button size="sm" type="submit" icon={<Check className="size-3.5" />}>
            {t("Enregistrer")}
          </Button>
        </form>
      )}

      {c.kind !== "task" && !c.archivedAt && (
        <Suggestions
          c={c}
          suggested={suggested}
          projectName={projectName}
          similar={similar.data ?? []}
          onConvert={convert}
          onLink={(p) => void run(api.brainSetProject(c.id, p), t("Associée au projet"))}
        />
      )}

      {c.kind !== "task" && !c.archivedAt && (
        <div className="border-t border-ink/6 pt-3">
          {artixJob === null ? (
            <Button size="sm" variant="ghost" icon={<Sparkles className="size-3.5" />} disabled={!aiReady} disabledReason={t("Choisis un fournisseur d'IA dans Réglages → Artix")} onClick={() => void askArtix()}>
              {t("Demander à Artix de ranger cette capture")}
            </Button>
          ) : (
            <ArtixSuggestion job={artixJob} c={c} projectName={projectName} onDone={() => setArtixJob(null)} />
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ icon, children, onClick }: { icon?: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-7 items-center gap-1.5 rounded-md border border-dashed border-accent/35 px-2.5 text-xs text-accent-strong transition-colors duration-150 hover:bg-accent-soft/50">
      {icon}
      {children}
    </button>
  );
}

/** Found locally, never applied by themselves. */
function Suggestions({ c, suggested, projectName, similar, onConvert, onLink }: { c: Capture; suggested: string | null; projectName: (p: string | null) => string | null; similar: Capture[]; onConvert: (k: CaptureKind) => void; onLink: (p: string) => void }) {
  const chips: React.ReactNode[] = [];
  if (suggested && c.ctype === "task") chips.push(<Chip key="tp" icon={<ListTodo className="size-3.5" />} onClick={() => void api.brainSetProject(c.id, suggested).then(() => onConvert("task"))}>{t("Tâche du projet {p}", { p: projectName(suggested) ?? "" })}</Chip>);
  else if (suggested) chips.push(<Chip key="p" icon={<FolderGit2 className="size-3.5" />} onClick={() => onLink(suggested)}>{t("Lier à {p}", { p: projectName(suggested) ?? "" })}</Chip>);
  if (c.ctype === "task" && !(suggested && c.ctype === "task")) chips.push(<Chip key="t" icon={<ListTodo className="size-3.5" />} onClick={() => onConvert("task")}>{t("Transformer en tâche")}</Chip>);
  if ((c.ctype === "code" || c.ctype === "command") && c.kind === "idea") chips.push(<Chip key="s" icon={<Code2 className="size-3.5" />} onClick={() => onConvert("snippet")}>{t("Garder comme snippet")}</Chip>);
  if ((c.ctype === "info" || c.ctype === "link") && c.kind === "idea") chips.push(<Chip key="n" icon={<StickyNote className="size-3.5" />} onClick={() => onConvert("note")}>{t("Garder comme note")}</Chip>);
  if (!chips.length && !similar.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {chips.length > 0 && <div className="flex flex-wrap gap-1.5">{chips}</div>}
      {similar.length > 0 && (
        <div className="text-xs text-faint">
          {t("Proche de :")}{" "}
          {similar.map((s, i) => (
            <button key={s.id} type="button" className="text-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => useUi.getState().openInbox({ view: "all", focus: s.id })}>
              {i > 0 && ", "}
              {s.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ArtixSuggestion({ job, c, projectName, onDone }: { job: number; c: Capture; projectName: (p: string | null) => string | null; onDone: () => void }) {
  const j = useJob(job);
  const toast = useUi((s) => s.toast);
  if (!j.data || j.data.status === "running") return <p className="flex items-center gap-2 text-xs text-faint"><Spinner className="size-3.5" /> {t("Artix lit la capture…")}</p>;
  const s = j.data.summary.suggestion as CaptureSuggestion | undefined;
  if (!s) return <p className="text-xs text-danger">{String(j.data.summary.error ?? t("Artix n'a pas pu répondre."))}</p>;
  const project = s.project && projectName(s.project) ? s.project : null;
  const apply = async (what: () => Promise<unknown>) => {
    try {
      await what();
    } catch (e) {
      toast({ kind: "error", title: t("Impossible"), detail: asAppError(e).message });
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-ink/8 bg-ink/3 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
        <Sparkles className="size-3.5 text-accent-strong" /> {t("Suggestions d'Artix")} <span className="font-normal text-faint">· {CTYPE_LABEL[s.ctype] ?? s.ctype}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {s.rewrite && s.rewrite.trim() !== c.text.trim() && <Chip icon={<Pencil className="size-3.5" />} onClick={() => void apply(() => api.brainEdit(c.id, `${s.title}\n\n${s.rewrite}`))}>{t("Reformuler : « {t} »", { t: s.title })}</Chip>}
        {project && project !== c.project && <Chip icon={<FolderGit2 className="size-3.5" />} onClick={() => void apply(() => api.brainSetProject(c.id, project))}>{t("Lier à {p}", { p: projectName(project) ?? "" })}</Chip>}
        {s.tags.length > 0 && <Chip icon={<Bookmark className="size-3.5" />} onClick={() => void apply(() => api.brainTags(c.id, [...new Set([...c.tags, ...s.tags])]))}>{s.tags.map((x) => `#${x}`).join(" ")}</Chip>}
        {s.asTask && <Chip icon={<ListTodo className="size-3.5" />} onClick={() => void apply(() => api.brainConvert(c.id, "task"))}>{t("Transformer en tâche")}</Chip>}
        {s.similarId && <Chip icon={<InboxIcon className="size-3.5" />} onClick={() => useUi.getState().openInbox({ view: "all", focus: s.similarId! })}>{t("Voir l'idée proche")}</Chip>}
      </div>
      <button type="button" className="self-start text-2xs text-faint hover:text-fg" onClick={onDone}>
        {t("Ignorer")}
      </button>
    </div>
  );
}
