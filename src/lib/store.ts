import { create } from "zustand";
import type { PlanEvent, PlanTask } from "./api";

export type Page = "overview" | "projects" | "git" | "library" | "testing" | "subjects" | "analytics" | "templates" | "myepitech" | "logtime" | "cozy" | "settings" | "prompts" | "agenda" | "skilltree" | "playground" | "arena" | "boards" | "connect" | "live" | "space";

/** Sidebar order. Ctrl+1 to Ctrl+9 open the first nine. */
export const PAGES: Page[] = ["overview", "projects", "agenda", "git", "testing", "library", "templates", "myepitech", "skilltree", "logtime", "subjects", "analytics", "cozy", "settings", "prompts", "playground", "arena", "boards", "connect", "live", "space"];

export interface Toast {
  id: number;
  kind: "ok" | "error" | "info";
  title: string;
  detail?: string;
  /** One button in the toast (e.g. "Voir"). */
  action?: { label: string; run: () => void };
  /** Stays longer than usual (ms). */
  duration?: number;
}

/** What the launcher dialog starts from. */
export type LaunchRequest =
  | { mode: "new"; url?: string }
  | { mode: "existing"; path: string; templateId?: string };

interface UiState {
  page: Page;
  setPage: (page: Page) => void;
  /** Repository selected on the Git screen. */
  gitRepo: string | null;
  openGit: (path: string) => void;
  /** Project the Library screen installs into. */
  libraryRepo: string | null;
  openLibrary: (path: string | null) => void;
  /** Project selected on the Testing screen. */
  testingRepo: string | null;
  /** Project chosen for a TekLive session (from the project menu). */
  liveRepo: string | null;
  /** The whiteboard open on the Tableaux page. */
  board: string | null;
  openBoard: (id: string | null) => void;
  openLive: (path: string) => void;
  openTesting: (path: string | null) => void;
  /** Task whose progress the Testing screen shows. */
  jobId: number | null;
  /** Finished report opened from the history. */
  runId: number | null;
  showJob: (id: number, repo: string | null) => void;
  /** Project tool open as a dialog over any screen. */
  tool: { kind: "package" | "readme"; repo: string } | null;
  openTool: (kind: "package" | "readme", repo: string) => void;
  closeTool: () => void;
  /** Files to tick on the Library screen at startup (`--pick`). */
  libraryPick: string[];
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** Repository whose sheet (notes, deadline, build) is open. */
  sheetPath: string | null;
  openSheet: (path: string) => void;
  closeSheet: () => void;
  launch: LaunchRequest | null;
  openLauncher: (req: LaunchRequest) => void;
  closeLauncher: () => void;
  /** Run the Claude Code test prompt as soon as its card is ready (`--run claude-check`). */
  claudeAutoCheck: boolean;
  /** Settings tab to open once (a toast's "Voir"). */
  settingsTab: string | null;
  /** `tekboard --run update`: check, then install what is found. */
  updateAuto: boolean;
  /** Design forced for this run by `--theme` (preview). */
  themeOverride: string | null;
  /** Planning assistant panel, over any screen. `ask` is a request to send as soon as it opens. */
  assistantOpen: boolean;
  assistantAsk: { text: string; project?: string | null } | null;
  openAssistant: (ask?: { text: string; project?: string | null }) => void;
  /** A resource being shared with TekShare (the share dialog is open while set). */
  share: import("./api").ShareResource | null;
  /** People preselected in the share dialog (a TekSpace table). */
  shareTo: string[];
  openShare: (r: import("./api").ShareResource | null, to?: string[]) => void;
  closeAssistant: () => void;
  /** Conversation shown in Artix's panel, and the turn being answered. */
  artixThread: number | null;
  artixJob: number | null;
  setArtix: (t: { thread?: number | null; job?: number | null }) => void;
  /** Calendar entry being created or edited (`id` absent = new). */
  eventEdit: Partial<PlanEvent> | null;
  editEvent: (e: Partial<PlanEvent> | null) => void;
  taskEdit: Partial<PlanTask> | null;
  editTask: (t: Partial<PlanTask> | null) => void;
  captureOpen: boolean;
  setCaptureOpen: (open: boolean) => void;
  /** Day the Planning screen should show next time it opens (ms). */
  planDate: number | null;
  openPlanning: (date?: number) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
}

let nextToast = 1;

export const useUi = create<UiState>((set, get) => ({
  page: "overview",
  setPage: (page) => set({ page }),
  gitRepo: null,
  openGit: (gitRepo) => set({ gitRepo, page: "git", sheetPath: null, paletteOpen: false }),
  libraryRepo: null,
  openLibrary: (libraryRepo) => set({ libraryRepo, page: "library", sheetPath: null, paletteOpen: false }),
  testingRepo: null,
  liveRepo: null,
  board: null,
  openBoard: (board) => set({ board, page: "boards", sheetPath: null, paletteOpen: false }),
  openLive: (liveRepo) => set({ liveRepo, page: "live", sheetPath: null, paletteOpen: false }),
  openTesting: (testingRepo) => set({ testingRepo, page: "testing", sheetPath: null, paletteOpen: false }),
  jobId: null,
  runId: null,
  showJob: (jobId, repo) => set((s) => ({ jobId, runId: null, page: "testing", testingRepo: repo ?? s.testingRepo, sheetPath: null, paletteOpen: false, tool: null })),
  tool: null,
  openTool: (kind, repo) => set({ tool: { kind, repo }, paletteOpen: false, sheetPath: null }),
  closeTool: () => set({ tool: null }),
  libraryPick: [],
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  sheetPath: null,
  openSheet: (sheetPath) => set({ sheetPath, paletteOpen: false }),
  closeSheet: () => set({ sheetPath: null }),
  launch: null,
  openLauncher: (launch) => set({ launch, paletteOpen: false, sheetPath: null }),
  closeLauncher: () => set({ launch: null }),
  claudeAutoCheck: false,
  settingsTab: null,
  updateAuto: false,
  themeOverride: null,
  assistantOpen: false,
  assistantAsk: null,
  openAssistant: (ask) => set({ assistantOpen: true, assistantAsk: ask ?? null, paletteOpen: false }),
  share: null,
  shareTo: [],
  openShare: (share, to) => set({ share, shareTo: to ?? [], paletteOpen: false }),
  closeAssistant: () => set({ assistantOpen: false, assistantAsk: null }),
  artixThread: (() => {
    // `tekboard.tikaThread`: the same conversation, saved before the assistant was renamed.
    const v = Number(localStorage.getItem("tekboard.artixThread") ?? localStorage.getItem("tekboard.tikaThread"));
    return Number.isFinite(v) && v > 0 ? v : null;
  })(),
  artixJob: null,
  setArtix: (t) =>
    set((s) => {
      const thread = t.thread !== undefined ? t.thread : s.artixThread;
      try {
        if (thread) localStorage.setItem("tekboard.artixThread", String(thread));
        else localStorage.removeItem("tekboard.artixThread");
      } catch {
        /* kept for this window */
      }
      return { artixThread: thread, artixJob: t.job !== undefined ? t.job : s.artixJob };
    }),
  eventEdit: null,
  editEvent: (eventEdit) => set({ eventEdit }),
  taskEdit: null,
  editTask: (taskEdit) => set({ taskEdit }),
  captureOpen: false,
  setCaptureOpen: (captureOpen) => set({ captureOpen, paletteOpen: false }),
  planDate: null,
  openPlanning: (date) => set({ page: "agenda", planDate: date ?? null, sheetPath: null, paletteOpen: false }),
  toasts: [],
  toast: (t) => {
    const id = nextToast++;
    set({ toasts: [...get().toasts, { ...t, id }] });
    window.setTimeout(() => get().dismissToast(id), t.duration ?? (t.kind === "error" ? 9000 : 4000));
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
