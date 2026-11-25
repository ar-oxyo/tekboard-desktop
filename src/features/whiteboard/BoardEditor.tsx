// The whiteboard editor (Excalidraw), loaded only when a board is opened. Saves as you draw,
// keeps versions and a thumbnail, exports (PNG, SVG, PDF, .tekboard-board, into a project),
// adds programming shapes and code blocks, lets Artix propose a diagram or annotations as a
// preview you accept or cancel, and lets several people draw together over Connect.
import { ensureFonts } from "./assetPath";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, exportToBlob, exportToSvg, MainMenu, newElementWith, reconcileElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI, BinaryFileData, AppState, Collaborator, SocketId } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, Check, Code2, Download, Eye, History, Pencil, Presentation, Share2, Shapes, Sparkles, UserPlus, Users, X } from "lucide-react";
import { api, asAppError, type BoardData, type BoardFile, type ConnectState } from "../../lib/api";
import { useUi } from "../../lib/store";
import { aiGate } from "../../lib/ai";
import { useAiStatus } from "../settings/AiProvider";
import { useJob } from "../../lib/jobs";
import { extractAnnotations, extractMermaid, generate, placeAt, SHAPES, summary, annotationShapes, type ShapeKind, type Skeleton } from "../../lib/boards";
import { recipients } from "../../lib/share";
import { Modal } from "../../components/Modal";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../../components/Menu";
import { ProjectPicker } from "../../components/ProjectPicker";
import { Badge, Button, cn, ErrorNote, IconButton, Input, Spinner } from "../../components/ui";
import { renderCode } from "./codeBlock";
import { BoardSession, type SceneAdapter, type SessionState } from "./collab";
import { useBoardBus, type BoardInvite } from "./bus";
import { timeAgo } from "../../lib/format";
import { t, locale } from "../../lib/i18n";

const CodeEditor = lazy(() => import("../../components/CodeEditor"));

export type BoardSource = { kind: "local"; id: string } | { kind: "remote"; invite: BoardInvite };

type Api = ExcalidrawImperativeAPI;

function blobToDataURL(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

function filesOf(api: Api): Record<string, BoardFile> {
  const out: Record<string, BoardFile> = {};
  for (const [id, f] of Object.entries(api.getFiles())) out[id] = { id, mimeType: f.mimeType, dataURL: f.dataURL, created: f.created };
  return out;
}

export default function BoardEditor({ source, onClose, connect }: { source: BoardSource; onClose: () => void; connect: ConnectState | undefined }) {
  const toast = useUi((s) => s.toast);
  const [api_, setApi] = useState<Api | null>(null);
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<null | "shapes" | "code" | "history" | "export" | "ai" | "people">(null);
  const [codeEdit, setCodeEdit] = useState<{ id: string | null; code: string }>({ id: null, code: "" });
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const sessionRef = useRef<BoardSession | null>(null);
  const centered = useRef(source.kind === "local");
  const saveTimer = useRef<number>(0);
  const lastThumb = useRef(0);
  const savedFiles = useRef(new Set<string>());
  const lastVersionSig = useRef("");
  const local = source.kind === "local" ? source.id : null;
  const me = connect ? { fp: connect.fp, nick: connect.profile.nick } : null;

  // Load the board (or wait for the host's scene).
  useEffect(() => {
    if (source.kind !== "local") return;
    let alive = true;
    api.boardGet(source.id).then(
      (b) => {
        if (!alive) return;
        setData(b);
        setName(b.meta.name);
        Object.keys(b.files).forEach((id) => savedFiles.current.add(id));
      },
      (e) => setError(asAppError(e).message),
    );
    return () => {
      alive = false;
    };
  }, [source]);

  const save = useCallback(async (force = false) => {
    if (!api_ || !local) return;
    // An Artix proposal not kept yet is not part of the board.
    const elements = api_.getSceneElementsIncludingDeleted().filter((e) => !e.customData?.tekPreview);
    const files = filesOf(api_);
    const fresh: Record<string, BoardFile> = {};
    for (const [id, f] of Object.entries(files)) if (!savedFiles.current.has(id)) fresh[id] = f;
    let thumb: string | null = null;
    const now = Date.now();
    if (force || now - lastThumb.current > 30_000) {
      lastThumb.current = now;
      const live = elements.filter((e) => !e.isDeleted);
      if (live.length) {
        try {
          thumb = await blobToDataURL(await exportToBlob({ elements: live, appState: { ...api_.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff" }, files: api_.getFiles(), maxWidthOrHeight: 320, mimeType: "image/png" }));
        } catch {
          thumb = null;
        }
      }
    }
    try {
      await api.boardSave(local, elements as unknown[], api_.getAppState() as unknown as Record<string, unknown>, fresh, thumb);
      Object.keys(fresh).forEach((id) => savedFiles.current.add(id));
      setDirty(false);
    } catch (e) {
      toast({ kind: "error", title: t("Enregistrement du tableau impossible"), detail: asAppError(e).message });
    }
  }, [api_, local, toast]);

  useEffect(() => {
    if (api_) void ensureFonts();
  }, [api_]);

  // Save on the way out.
  useEffect(() => () => {
    window.clearTimeout(saveTimer.current);
  }, []);

  const onChange = useCallback((elements: readonly OrderedExcalidrawElement[], appState: AppState) => {
    const sig = elements.map((e) => `${e.id}:${e.version}`).join(",");
    if (sig === lastVersionSig.current) {
      sessionRef.current?.view({ scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom.value });
      return;
    }
    lastVersionSig.current = sig;
    const sel = Object.keys(appState.selectedElementIds ?? {});
    const one = sel.length === 1 ? elements.find((e) => e.id === sel[0]) : undefined;
    setSelectedCode(one && typeof one.customData?.code === "string" ? one.id : null);
    sessionRef.current?.localChanged();
    if (!local) return;
    setDirty(true);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(), 1500);
  }, [local, save]);

  // ── collaboration: the scene as the session sees it.
  const adapter = useMemo((): SceneAdapter | null => {
    if (!api_) return null;
    return {
      elements: () => api_.getSceneElementsIncludingDeleted(),
      apply: (remote: Array<Record<string, unknown>>) => {
        const merged = reconcileElements(api_.getSceneElementsIncludingDeleted(), remote as never, api_.getAppState());
        api_.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
        void ensureFonts();
        // Joining: show the host's drawing, wherever it is.
        if (!centered.current && remote.length) {
          centered.current = true;
          requestAnimationFrame(() => api_.scrollToContent(undefined, { fitToContent: true, maxZoom: 1, animate: false }));
        }
      },
      files: () => filesOf(api_),
      addFiles: (fs: BoardFile[]) => api_.addFiles(fs.map((f) => ({ id: f.id, mimeType: f.mimeType, dataURL: f.dataURL, created: f.created ?? Date.now() }) as BinaryFileData)),
      setView: (v: { scrollX: number; scrollY: number; zoom: number }) => api_.updateScene({ appState: { scrollX: v.scrollX, scrollY: v.scrollY, zoom: { value: Math.max(0.1, Math.min(30, v.zoom)) as never } }, captureUpdate: CaptureUpdateAction.NEVER }),
    };
  }, [api_]);

  // Joining someone's board: start the session as soon as the editor is ready.
  useEffect(() => {
    if (source.kind !== "remote" || !adapter || !me || sessionRef.current) return;
    setName(source.invite.name);
    sessionRef.current = BoardSession.join(source.invite, me, adapter, setSession);
    setSession(sessionRef.current.state);
    return () => {
      sessionRef.current?.leave();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  const tableStop = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      sessionRef.current?.leave();
      tableStop.current?.();
    },
    [],
  );

  const startHosting = (mayJoin?: (fp: string) => boolean) => {
    if (!adapter || !me || !local) return null;
    sessionRef.current = BoardSession.host(local, name, me, adapter, setSession, mayJoin);
    setSession(sessionRef.current.state);
    return sessionRef.current;
  };

  // A TekSpace table's board: shared with the people seated there as soon as it opens.
  useEffect(() => {
    const auto = useBoardBus.getState().autoHost;
    if (!auto || auto.board !== local || !adapter || !me || sessionRef.current || !data) return;
    useBoardBus.setState({ autoHost: null });
    const s = startHosting(auto.mayJoin);
    if (s) {
      auto.started(s.state.session, data.meta.name);
      tableStop.current = auto.stopped;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, data]);

  // Others' cursors, coloured and named.
  useEffect(() => {
    if (!api_ || !session) return;
    const map = new Map<SocketId, Collaborator>();
    for (const p of session.pointers) {
      const who = session.participants.find((x) => x.fp === p.fp);
      if (!who || Date.now() - p.at > 30_000) continue;
      map.set(p.fp as SocketId, { pointer: { x: p.x, y: p.y, tool: p.tool }, username: who.nick, color: { background: who.color, stroke: who.color }, selectedElementIds: Object.fromEntries(p.selected.map((s) => [s, true])) } as Collaborator);
    }
    api_.updateScene({ collaborators: map, captureUpdate: CaptureUpdateAction.NEVER });
  }, [api_, session]);

  const readOnly = session?.role === "guest" && session.mode !== "edit";

  // ── inserting shapes (library, code, Artix previews)
  /** `center`: in the middle of the view; `free`: right of the drawing, then shown; `keep`: where the shapes say. */
  const insert = (skeletons: Skeleton[], files: BoardFile[] = [], place: "center" | "free" | "keep" = "center", asPreview = false) => {
    if (!api_) return [];
    if (files.length) api_.addFiles(files.map((f) => ({ id: f.id, mimeType: f.mimeType, dataURL: f.dataURL, created: Date.now() }) as BinaryFileData));
    const st = api_.getAppState();
    let placed = skeletons;
    if (place === "center") placed = placeAt(skeletons, -st.scrollX + st.width / st.zoom.value / 2 - 150, -st.scrollY + st.height / st.zoom.value / 2 - 100);
    else if (place === "free") {
      const live = api_.getSceneElements();
      const right = live.length ? Math.max(...live.map((e) => e.x + e.width)) + 120 : 0;
      const top = live.length ? Math.min(...live.map((e) => e.y)) : 0;
      placed = placeAt(skeletons, right, top);
    }
    const els = convertToExcalidrawElements(placed as never, { regenerateIds: false }).map((e) => (asPreview ? { ...e, customData: { ...(e.customData ?? {}), tekPreview: true } } : e)) as ExcalidrawElement[];
    api_.updateScene({ elements: [...api_.getSceneElementsIncludingDeleted(), ...els], captureUpdate: asPreview ? CaptureUpdateAction.NEVER : CaptureUpdateAction.IMMEDIATELY, appState: { selectedElementIds: Object.fromEntries(els.map((e) => [e.id, true])) as never } });
    if (place !== "center") api_.scrollToContent(els, { fitToContent: true, maxZoom: 1, animate: true });
    void ensureFonts();
    return els.map((e) => e.id);
  };

  const acceptPreview = (keep: boolean) => {
    if (!api_ || !preview) return;
    const ids = new Set(preview);
    const all = api_.getSceneElementsIncludingDeleted();
    const rest = all.filter((e) => !ids.has(e.id));
    api_.updateScene({ elements: rest, captureUpdate: CaptureUpdateAction.NEVER });
    if (keep) {
      // A new version of each element (sent to the others now that it is kept), in one step of
      // the undo history: Ctrl+Z removes the whole proposal.
      const added = all.filter((e) => ids.has(e.id)).map((e) => newElementWith(e, { customData: Object.fromEntries(Object.entries(e.customData ?? {}).filter(([k]) => k !== "tekPreview")) }));
      api_.updateScene({ elements: [...rest, ...added], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    }
    setPreview(null);
  };

  const insertCode = (code: string) => {
    if (!api_ || !code.trim()) return;
    const img = renderCode(code);
    const fileId = `code-${Date.now().toString(36)}`;
    const file: BoardFile = { id: fileId, mimeType: "image/png", dataURL: img.dataURL };
    if (codeEdit.id) {
      api_.addFiles([{ ...file, created: Date.now() } as BinaryFileData]);
      const els = api_.getSceneElementsIncludingDeleted().map((e) => (e.id === codeEdit.id ? { ...e, fileId, width: img.width, height: img.height, customData: { ...(e.customData ?? {}), code }, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } : e));
      api_.updateScene({ elements: els as never, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    } else {
      insert([{ type: "image", x: 0, y: 0, fileId, width: img.width, height: img.height, customData: { code, lang: "c" } } as Skeleton], [file]);
    }
    setDialog(null);
  };

  // ── exports
  const exportAs = async (kind: "png" | "svg" | "pdf" | "board") => {
    if (!api_) return;
    const base = (name || "tableau").replace(/[^\w\- ]+/g, "").trim() || "tableau";
    const ext = kind === "board" ? "tekboard-board" : kind;
    const path = await saveDialog({ defaultPath: `${base}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return;
    const elements = api_.getSceneElements();
    const appState = { ...api_.getAppState(), exportBackground: true, exportScale: 2 };
    try {
      if (kind === "png") await api.boardWriteFile(path, await blobToDataURL(await exportToBlob({ elements, appState, files: api_.getFiles(), mimeType: "image/png", exportPadding: 24 })), null);
      else if (kind === "svg") await api.boardWriteFile(path, null, (await exportToSvg({ elements, appState, files: api_.getFiles(), exportPadding: 24 })).outerHTML);
      else if (kind === "pdf") {
        const blob = await exportToBlob({ elements, appState: { ...appState, viewBackgroundColor: appState.viewBackgroundColor || "#ffffff" }, files: api_.getFiles(), mimeType: "image/jpeg", quality: 0.92, exportPadding: 24 });
        const bmp = await createImageBitmap(blob);
        await api.boardWritePdf(path, await blobToDataURL(blob), bmp.width, bmp.height);
      } else if (local) {
        await save(true);
        await api.boardWriteFile(path, null, await api.boardExportJson(local));
      }
      toast({ kind: "ok", title: t("Exporté"), detail: path });
    } catch (e) {
      toast({ kind: "error", title: t("Export impossible"), detail: asAppError(e).message });
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (source.kind === "local" && !data) return <Spinner />;

  const people = connect ? recipients(connect.peers) : [];
  return (
    <div className="flex h-[calc(100vh-7.5rem)] min-h-[520px] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label={t("Retour aux tableaux")} onClick={async () => { if (local) await save(true); sessionRef.current?.leave(); sessionRef.current = null; onClose(); }}>
          <ArrowLeft className="size-4" />
        </IconButton>
        {local ? (
          <Input className="h-8 w-48 text-sm font-medium" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => local && name.trim() && void api.boardRename(local, name)} aria-label={t("Nom du tableau")} />
        ) : (
          <span className="text-sm font-medium text-fg">{name}</span>
        )}
        {local && <span className="w-20 text-xs text-faint">{dirty ? t("enregistrement…") : t("enregistré")}</span>}
        {session && (
          <Badge tone={session.lost ? "danger" : session.waiting || (session.role === "guest" && session.mode !== "edit") ? "neutral" : "ok"}>
            {session.lost ? t("déconnecté") : session.waiting ? t("connexion…") : session.role === "host" ? t("{n} participant(s)", { n: session.participants.length }) : session.mode === "edit" ? t("en édition") : t("en lecture seule")}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={<Shapes className="size-3.5" />} disabled={readOnly} onClick={() => setDialog("shapes")}>
            {t("Formes")}
          </Button>
          <Button size="sm" variant="ghost" icon={<Code2 className="size-3.5" />} disabled={readOnly} onClick={() => { setCodeEdit({ id: null, code: "" }); setDialog("code"); }}>
            {t("Code")}
          </Button>
          {selectedCode && !readOnly && (
            <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => { const el = api_?.getSceneElements().find((e) => e.id === selectedCode); setCodeEdit({ id: selectedCode, code: String(el?.customData?.code ?? "") }); setDialog("code"); }}>
              {t("Modifier le code")}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Sparkles className="size-3.5" />} disabled={readOnly} onClick={() => setDialog("ai")}>
            Artix
          </Button>
          {local ? (
            session ? (
              <Button size="sm" icon={<Users className="size-3.5" />} onClick={() => setDialog("people")}>
                {t("Participants")}
              </Button>
            ) : (
              <Button size="sm" icon={<UserPlus className="size-3.5" />} disabled={!connect?.running} disabledReason={t("Active TekBoard Connect pour dessiner à plusieurs")} onClick={() => startHosting() && setDialog("people")}>
                {t("Inviter")}
              </Button>
            )
          ) : null}
          {session && session.participants.length > 1 && (
            <Menu trigger={<Button size="sm" variant="ghost" icon={<Presentation className="size-3.5" />}>{t("Présentation")}</Button>}>
              <MenuItem onSelect={() => sessionRef.current?.present(session.presenter !== me?.fp)}>{session.presenter === me?.fp ? t("Arrêter de présenter") : t("Présenter ma vue")}</MenuItem>
              <MenuSeparator />
              <MenuLabel>{t("Suivre la vue de…")}</MenuLabel>
              {session.participants.filter((p) => p.fp !== me?.fp).map((p) => (
                <MenuItem key={p.fp} onSelect={() => sessionRef.current?.follow(session.following === p.fp ? null : p.fp)} hint={session.following === p.fp ? "✓" : session.presenter === p.fp ? t("présente") : undefined}>
                  {p.nick}
                </MenuItem>
              ))}
            </Menu>
          )}
          <Menu trigger={<Button size="sm" variant="ghost" icon={<Download className="size-3.5" />}>{t("Exporter")}</Button>}>
            <MenuItem onSelect={() => void exportAs("png")}>PNG</MenuItem>
            <MenuItem onSelect={() => void exportAs("svg")}>SVG</MenuItem>
            <MenuItem onSelect={() => void exportAs("pdf")}>PDF</MenuItem>
            {local && <MenuItem onSelect={() => void exportAs("board")}>{t("Fichier TekBoard (.tekboard-board)")}</MenuItem>}
            {local && <MenuItem onSelect={() => setDialog("export")}>{t("Dans un projet…")}</MenuItem>}
          </Menu>
          {local && (
            <>
              <IconButton label={t("Historique des versions")} onClick={() => setDialog("history")}>
                <History className="size-4" />
              </IconButton>
              <IconButton label={t("Partager (TekShare)")} onClick={async () => { await save(true); useUi.getState().openShare({ kind: "board", id: local }); }}>
                <Share2 className="size-4" />
              </IconButton>
            </>
          )}
        </div>
      </div>
      {session?.lost && (
        <ErrorNote title={t("Connexion avec l'hôte perdue")}>
          {session.error || t("Le tableau reste affiché ; tes changements ne sont plus envoyés.")}{" "}
          <button type="button" className="underline" onClick={() => sessionRef.current?.rejoin()}>
            {t("Se reconnecter")}
          </button>
        </ErrorNote>
      )}
      {preview && (
        <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent-soft/40 px-3 py-2 text-sm">
          <Sparkles className="size-4 text-accent" />
          <span className="flex-1 text-fg">{t("Proposition d'Artix ({n} éléments, sélectionnés) : garde-la ou annule-la.", { n: preview.length })}</span>
          <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => acceptPreview(true)}>
            {t("Garder")}
          </Button>
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => acceptPreview(false)}>
            {t("Annuler")}
          </Button>
        </div>
      )}
      <div className="card min-h-0 flex-1 overflow-hidden">
        <Excalidraw
          excalidrawAPI={setApi}
          initialData={data ? { elements: data.elements as never, appState: { ...(data.appState as object), collaborators: new Map() }, files: data.files as never, scrollToContent: true } : undefined}
          onChange={onChange}
          onPointerUpdate={(p) => {
            const st = api_?.getAppState();
            sessionRef.current?.pointer(p.pointer.x, p.pointer.y, p.pointer.tool, Object.keys(st?.selectedElementIds ?? {}));
          }}
          isCollaborating={!!session}
          viewModeEnabled={readOnly}
          theme="dark"
          langCode={locale().startsWith("en") ? "en" : "fr-FR"}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false } }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        </Excalidraw>
      </div>
      {dialog === "shapes" && <ShapesDialog onClose={() => setDialog(null)} onInsert={(s) => { insert(s); setDialog(null); }} />}
      {dialog === "code" && (
        <Modal open onClose={() => setDialog(null)} title={codeEdit.id ? t("Modifier le bloc de code") : t("Bloc de code")} description={t("Coloré comme dans l'éditeur ; le code reste modifiable sur le tableau.")} width="w-[760px]" footer={<Button variant="primary" onClick={() => insertCode(codeEdit.code)}>{codeEdit.id ? t("Mettre à jour") : t("Ajouter au tableau")}</Button>}>
          <div className="h-80 overflow-hidden rounded-md border border-ink/8">
            <Suspense fallback={<Spinner />}>
              <CodeEditor value={codeEdit.code} onChange={(code) => setCodeEdit((c) => ({ ...c, code }))} className="h-full" label={t("Code")} />
            </Suspense>
          </div>
        </Modal>
      )}
      {dialog === "history" && local && <HistoryDialog id={local} onClose={() => setDialog(null)} onRestored={(b) => { api_?.updateScene({ elements: b.elements as never, captureUpdate: CaptureUpdateAction.IMMEDIATELY }); setDialog(null); }} />}
      {dialog === "export" && local && <ProjectExportDialog id={local} onClose={() => setDialog(null)} beforeExport={() => save(true)} />}
      {dialog === "ai" && api_ && <AiDialog api={api_} onClose={() => setDialog(null)} onPreview={(skeletons, files, place) => { const ids = insert(skeletons, files, place, true); setPreview(ids); setDialog(null); }} />}
      {dialog === "people" && session && sessionRef.current && (
        <Modal open onClose={() => setDialog(null)} title={t("Dessiner à plusieurs")} description={t("Invite des contacts TekBoard : ils voient le tableau en direct. Toi seul gardes le tableau ; chacun annule ses propres changements.")} width="w-[560px]">
          <div className="space-y-4">
            <ul className="space-y-1">
              {session.participants.map((p) => (
                <li key={p.fp} className="flex items-center gap-2 text-sm">
                  <span className="size-2.5 rounded-full" style={{ background: p.color }} />
                  <span className="flex-1 text-fg">{p.nick}</span>
                  {p.fp === me?.fp ? (
                    <Badge>{t("toi")}</Badge>
                  ) : (
                    <>
                      <Button size="sm" variant={p.mode === "edit" ? "secondary" : "ghost"} icon={p.mode === "edit" ? <Pencil className="size-3" /> : <Eye className="size-3" />} onClick={() => sessionRef.current?.setMode(p.fp, p.mode === "edit" ? "view" : "edit")}>
                        {p.mode === "edit" ? t("peut dessiner") : t("lecture seule")}
                      </Button>
                      <IconButton label={t("Retirer")} onClick={() => sessionRef.current?.remove(p.fp)}>
                        <X className="size-3.5" />
                      </IconButton>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <section>
              <h3 className="mb-1.5 text-xs text-faint">{t("Inviter")}</h3>
              {people.length === 0 ? (
                <p className="text-sm text-muted">{t("Aucun contact connecté.")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {people.filter((p) => !session.participants.some((x) => x.fp === p.fp)).map((p) => (
                    <Button key={p.fp} size="sm" icon={<UserPlus className="size-3" />} onClick={() => { sessionRef.current?.invite(p.fp, me?.nick ?? ""); toast({ kind: "ok", title: t("{n} est invité(e)", { n: p.profile.nick }) }); }}>
                      {p.profile.nick}
                    </Button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ShapesDialog({ onClose, onInsert }: { onClose: () => void; onInsert: (s: Skeleton[]) => void }) {
  const [kind, setKind] = useState<ShapeKind>("linkedList");
  const def = SHAPES.find((s) => s.kind === kind)!;
  const [input, setInput] = useState(def.example);
  return (
    <Modal open onClose={onClose} title={t("Formes pour expliquer du code")} description={t("Les flèches restent attachées aux formes quand tu les déplaces.")} width="w-[680px]" footer={<Button variant="primary" onClick={() => onInsert(generate(kind, input))}>{t("Ajouter au tableau")}</Button>}>
      <div className="grid grid-cols-[180px_1fr] gap-4">
        <ul className="space-y-0.5">
          {SHAPES.map((s) => (
            <li key={s.kind}>
              <button type="button" onClick={() => { setKind(s.kind); setInput(s.example); }} className={cn("w-full rounded-md px-2 py-1.5 text-left text-sm", kind === s.kind ? "bg-accent-soft text-fg" : "text-muted hover:bg-hover hover:text-fg")}>
                {t(s.label)}
              </button>
            </li>
          ))}
        </ul>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t(def.input)}</span>
          {def.multiline ? <textarea className="field h-48 w-full border border-ink/8 p-2 font-mono text-xs text-fg" value={input} onChange={(e) => setInput(e.target.value)} /> : <Input className="font-mono text-xs" value={input} onChange={(e) => setInput(e.target.value)} />}
        </label>
      </div>
    </Modal>
  );
}

function HistoryDialog({ id, onClose, onRestored }: { id: string; onClose: () => void; onRestored: (b: BoardData) => void }) {
  const [list, setList] = useState<Array<{ at: number; elements: number }> | null>(null);
  useEffect(() => void api.boardVersions(id).then(setList), [id]);
  return (
    <Modal open onClose={onClose} title={t("Historique du tableau")} description={t("Une version est gardée toutes les 5 minutes de travail (les 30 dernières). Restaurer garde d'abord la version actuelle.")} width="w-[480px]">
      {!list ? (
        <Spinner />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted">{t("Pas encore de version enregistrée.")}</p>
      ) : (
        <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
          {list.map((v) => (
            <li key={v.at} className="row-hover flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
              <span className="flex-1 text-fg">{new Date(v.at * 1000).toLocaleString(locale())}</span>
              <span className="text-xs text-faint">{t("{n} éléments", { n: v.elements })} · {timeAgo(v.at)}</span>
              <Button size="sm" onClick={() => void api.boardRestore(id, v.at).then(onRestored)}>
                {t("Restaurer")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function ProjectExportDialog({ id, onClose, beforeExport }: { id: string; onClose: () => void; beforeExport: () => Promise<void> }) {
  const toast = useUi((s) => s.toast);
  const [repo, setRepo] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={t("Exporter dans un projet")} description={t("Copie le tableau dans docs/boards/ du projet (fichier .tekboard-board, réimportable). Le tableau reste aussi dans TekBoard.")} width="w-[480px]" footer={<Button variant="primary" disabled={!repo} onClick={async () => { await beforeExport(); try { const p = await api.boardExportToProject(id, repo!); toast({ kind: "ok", title: t("Exporté dans le projet"), detail: p }); onClose(); } catch (e) { toast({ kind: "error", title: t("Export impossible"), detail: asAppError(e).message }); } }}>{t("Exporter")}</Button>}>
      <ProjectPicker value={repo} onChange={setRepo} />
    </Modal>
  );
}

function AiDialog({ api: ex, onClose, onPreview }: { api: Api; onClose: () => void; onPreview: (s: Skeleton[], files: BoardFile[], place: "free" | "keep") => void }) {
  const ai = aiGate(useAiStatus().data);
  const toast = useUi((s) => s.toast);
  const [request, setRequest] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [kind, setKind] = useState<"diagram" | "annotate">("diagram");
  const job = useJob(jobId);
  const context = summary(ex.getSceneElements() as never);
  // The answer becomes a preview on the board (never added for good without "Garder").
  const handle = async (answer: string) => {
    try {
      if (kind === "diagram") {
        const mermaid = extractMermaid(answer);
        if (!mermaid) throw new Error(t("Artix n'a pas répondu par un diagramme"));
        const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
        const res = await parseMermaidToExcalidraw(mermaid, { themeVariables: { fontSize: "16px" } });
        const files = Object.values(res.files ?? {}).map((f) => ({ id: String(f.id), mimeType: f.mimeType, dataURL: f.dataURL }));
        onPreview(res.elements as unknown as Skeleton[], files, "free");
      } else {
        const shapes = annotationShapes(extractAnnotations(answer), ex.getSceneElements() as never);
        if (!shapes.length) throw new Error(t("Aucune annotation ne correspond aux éléments du tableau"));
        onPreview(shapes, [], "keep");
      }
    } catch (e) {
      toast({ kind: "error", title: "Artix", detail: asAppError(e).message });
      setJobId(null);
    }
  };
  useEffect(() => {
    const j = job.data;
    if (!j || j.status === "running") return;
    if (j.status !== "success") {
      toast({ kind: "error", title: "Artix", detail: String((j.summary as { error?: string }).error ?? t("Pas de réponse")) });
      setJobId(null);
      return;
    }
    void handle(String((j.summary as { answer?: string }).answer ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.data?.status]);
  const explain = () => {
    useUi.getState().openAssistant({ text: t("Explique-moi ce schéma de tableau blanc, simplement, et dis-moi s'il contient une erreur :\n{s}", { s: context.slice(0, 12000) }) });
    onClose();
  };
  const run = async () => {
    try {
      setJobId(await api.boardAi(kind, request, context));
    } catch (e) {
      toast({ kind: "error", title: "Artix", detail: asAppError(e).message });
    }
  };
  const busy = job.data?.status === "running";
  return (
    <Modal open onClose={onClose} title={t("Artix et ce tableau")} description={t("Ce qu'Artix propose arrive en aperçu, sélectionné : tu le gardes ou l'annules, et Ctrl+Z l'enlève d'un coup.")} width="w-[560px]">
      {!ai.text ? (
        <ErrorNote>{ai.why}</ErrorNote>
      ) : (
        <div className="space-y-4">
          <Button variant="secondary" onClick={explain}>
            {t("Expliquer ce tableau")}
          </Button>
          <div className="space-y-2">
            <div className="flex gap-1">
              <Button size="sm" variant={kind === "diagram" ? "primary" : "ghost"} onClick={() => setKind("diagram")}>
                {t("Générer un diagramme")}
              </Button>
              <Button size="sm" variant={kind === "annotate" ? "primary" : "ghost"} onClick={() => setKind("annotate")}>
                {t("Annoter le tableau")}
              </Button>
            </div>
            <textarea
              className="field h-28 w-full border border-ink/8 p-2 text-sm text-fg"
              placeholder={kind === "diagram" ? t("Ex. : l'organigramme de mon get_next_line, l'architecture client-serveur de mon projet, une liste doublement chaînée…") : t("Facultatif : ce sur quoi insister")}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
            />
            <Button variant="primary" icon={<Sparkles className="size-3.5" />} busy={busy} disabled={kind === "diagram" && !request.trim()} disabledReason={t("Décris le diagramme voulu")} onClick={() => void run()}>
              {kind === "diagram" ? t("Proposer le diagramme") : t("Proposer des annotations")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
