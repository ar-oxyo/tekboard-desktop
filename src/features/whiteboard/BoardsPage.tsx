// Labo → Tableaux: every whiteboard (search, sort, pin, create, import), and the editor for
// the open one. Excalidraw itself is only loaded when a board is opened.
import { lazy, Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Copy, FileUp, MoreHorizontal, PenTool, Pin, PinOff, Plus, Search, Trash2, Users } from "lucide-react";
import { api, asAppError, type BoardMeta } from "../../lib/api";
import { useUi } from "../../lib/store";
import { useRepos } from "../../lib/hooks";
import { Menu, MenuItem, MenuSeparator } from "../../components/Menu";
import { Select } from "../../components/Select";
import { Badge, Button, cn, EmptyState, ErrorNote, Input, PageHeader, Spinner } from "../../components/ui";
import { timeAgo } from "../../lib/format";
import { t } from "../../lib/i18n";
import { useConnect } from "../connect/ConnectPage";
import { joinBoard, useBoardBus } from "./bus";
import type { BoardSource } from "./BoardEditor";

const BoardEditor = lazy(() => import("./BoardEditor"));

type Sort = "recent" | "name" | "created";

export function useBoards(project: string | null, query: string) {
  return useQuery({ queryKey: ["boards", project, query], queryFn: () => api.boardList(project, query.trim() || null), placeholderData: (p) => p });
}

export function sortBoards(list: BoardMeta[], sort: Sort): BoardMeta[] {
  const by = (a: BoardMeta, b: BoardMeta) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
  return [...list].sort((a, b) => b.position - a.position || by(a, b));
}

export default function BoardsPage() {
  const board = useUi((s) => s.board);
  const openBoard = useUi((s) => s.openBoard);
  const remote = useBoardBus((s) => s.open);
  const connect = useConnect().data;
  const source: BoardSource | null = remote ? { kind: "remote", invite: remote } : board ? { kind: "local", id: board } : null;
  if (source)
    return (
      <Suspense fallback={<Spinner />}>
        <BoardEditor
          key={source.kind === "local" ? source.id : source.invite.session}
          source={source}
          connect={connect}
          onClose={() => {
            useBoardBus.setState({ open: null });
            openBoard(null);
          }}
        />
      </Suspense>
    );
  return <BoardList />;
}

function BoardList() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const openBoard = useUi((s) => s.openBoard);
  const invites = useBoardBus((s) => s.invites);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("recent");
  const boards = useBoards(project, query);
  const repos = useRepos(true, { all: true });
  const repoName = (p: string | null) => (p ? (repos.data?.find((r) => r.path === p)?.name ?? p.split("/").pop()) : null);

  const create = async () => {
    try {
      const b = await api.boardCreate(t("Nouveau tableau"), project);
      openBoard(b.id);
    } catch (e) {
      toast({ kind: "error", title: t("Création impossible"), detail: asAppError(e).message });
    }
  };
  const importFile = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "TekBoard / Excalidraw", extensions: ["tekboard-board", "excalidraw", "json"] }] });
    if (typeof path !== "string") return;
    try {
      const b = await api.boardImport(path, project);
      openBoard(b.id);
    } catch (e) {
      toast({ kind: "error", title: t("Import impossible"), detail: asAppError(e).message });
    }
  };
  const act = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["boards"] });
    } catch (e) {
      toast({ kind: "error", title: t("Impossible"), detail: asAppError(e).message });
    }
  };

  const list = sortBoards(boards.data ?? [], sort);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Tableaux blancs")}
        subtitle={t("Algorithmes, structures de données, architecture. Rangés dans TekBoard, pas dans Git.")}
        actions={
          <>
            <Button icon={<FileUp className="size-3.5" />} onClick={() => void importFile()}>
              {t("Importer")}
            </Button>
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => void create()}>
              {t("Nouveau tableau")}
            </Button>
          </>
        }
      />
      {invites.length > 0 && (
        <div className="space-y-1.5">
          {invites.map((i) => (
            <div key={i.session} className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent-soft/40 px-3 py-2 text-[13px]">
              <Users className="size-4 text-accent" />
              <span className="flex-1 text-fg">{t("{n} t'invite sur son tableau « {b} »", { n: i.hostNick, b: i.name })}</span>
              <Button size="sm" variant="primary" onClick={() => joinBoard(i)}>
                {t("Rejoindre")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => useBoardBus.setState((s) => ({ invites: s.invites.filter((x) => x.session !== i.session) }))}>
                {t("Ignorer")}
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <Input className="pl-8" placeholder={t("Chercher un nom ou un texte du tableau")} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("Chercher")} />
        </div>
        <Select<string>
          className="w-56"
          label={t("Projet")}
          value={project ?? ""}
          onChange={(v) => setProject(v || null)}
          options={[{ value: "", label: t("Tous les tableaux") }, ...(repos.data ?? []).filter((r) => (boards.data ?? []).some((b) => b.project === r.path) || r.path === project).map((r) => ({ value: r.path, label: r.name }))]}
        />
        <Select<Sort> className="w-48" label={t("Trier par")} value={sort} onChange={setSort} options={[{ value: "recent", label: t("Modifiés récemment") }, { value: "name", label: t("Nom") }, { value: "created", label: t("Date de création") }]} />
      </div>
      {boards.error && <ErrorNote>{asAppError(boards.error).message}</ErrorNote>}
      {!boards.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState icon={<PenTool className="size-5" />} title={query ? t("Aucun tableau ne correspond") : t("Pas encore de tableau")} action={!query && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => void create()}>{t("Nouveau tableau")}</Button>}>
          {!query && t("Dessine à la main, ajoute des listes chaînées, des arbres ou du code, seul ou avec tes contacts TekBoard.")}
        </EmptyState>
      ) : (
        <BoardGrid
          boards={list}
          projectName={repoName}
          onOpen={openBoard}
          menu={(b) => (
            <>
              <MenuItem icon={b.position > 0 ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />} onSelect={act(() => api.boardSetPosition(b.id, b.position > 0 ? 0 : Math.floor(Date.now() / 1000)))}>
                {b.position > 0 ? t("Désépingler") : t("Épingler en haut")}
              </MenuItem>
              <MenuItem icon={<Copy className="size-3.5" />} onSelect={act(() => api.boardDuplicate(b.id))}>
                {t("Dupliquer")}
              </MenuItem>
              <MenuItem onSelect={() => useUi.getState().openShare({ kind: "board", id: b.id })}>{t("Partager (TekShare)…")}</MenuItem>
              <MenuSeparator />
              <MenuItem
                icon={<Trash2 className="size-3.5" />}
                danger
                onSelect={act(async () => {
                  if (window.confirm(t("Supprimer « {n} » et son historique ?", { n: b.name }))) await api.boardDelete(b.id);
                })}
              >
                {t("Supprimer")}
              </MenuItem>
            </>
          )}
        />
      )}
    </div>
  );
}

export function BoardGrid({ boards, onOpen, menu, projectName, compact }: { boards: BoardMeta[]; onOpen: (id: string) => void; menu?: (b: BoardMeta) => React.ReactNode; projectName?: (p: string | null) => string | null | undefined; compact?: boolean }) {
  return (
    <ul className={cn("grid gap-3", compact ? "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(230px,1fr))]")}>
      {boards.map((b) => (
        <li key={b.id} className="card group relative overflow-hidden">
          <button type="button" className="block w-full text-left" onClick={() => onOpen(b.id)}>
            <div className={cn("flex items-center justify-center bg-white/[0.03]", compact ? "h-24" : "h-36")}>
              {b.thumb ? <img src={b.thumb} alt="" className="max-h-full max-w-full object-contain p-2" /> : <PenTool className="size-6 text-faint" />}
            </div>
            <div className="space-y-0.5 px-3 py-2">
              <div className="flex items-center gap-1.5">
                {b.position > 0 && <Pin className="size-3 shrink-0 text-accent" />}
                <span className="truncate text-[13px] font-medium text-fg">{b.name}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-faint">
                <span>{timeAgo(b.updatedAt)}</span>
                <span>·</span>
                <span>{t("{n} éléments", { n: b.elements })}</span>
                {projectName?.(b.project) && <Badge>{projectName(b.project)}</Badge>}
              </div>
            </div>
          </button>
          {menu && (
            <div className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <Menu trigger={<button type="button" aria-label={t("Actions")} className="rounded-md bg-bg/80 p-1 text-muted hover:text-fg"><MoreHorizontal className="size-4" /></button>}>{menu(b)}</Menu>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The project sheet's "Tableaux" tab: that project's boards, and a new one tied to it. */
export function ProjectBoards({ repo }: { repo: string }) {
  const boards = useBoards(repo, "");
  const openBoard = useUi((s) => s.openBoard);
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const b = await api.boardCreate(t("Tableau de {p}", { p: repo.split("/").pop() ?? "" }), repo);
      openBoard(b.id);
    } catch (e) {
      toast({ kind: "error", title: t("Création impossible"), detail: asAppError(e).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted">{t("Schémas de ce projet. Ils restent dans TekBoard ; « Exporter → Dans un projet » en copie un dans docs/boards/.")}</p>
        <Button size="sm" icon={<Plus className="size-3.5" />} busy={busy} onClick={() => void create()}>
          {t("Nouveau tableau")}
        </Button>
      </div>
      {!boards.data ? <Spinner /> : boards.data.length === 0 ? <p className="text-[13px] text-faint">{t("Aucun tableau pour ce projet.")}</p> : <BoardGrid compact boards={sortBoards(boards.data, "recent")} onOpen={openBoard} />}
    </div>
  );
}
