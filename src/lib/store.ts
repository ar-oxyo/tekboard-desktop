import { create } from "zustand";

export type Page = "overview" | "projects" | "git" | "library" | "testing" | "subjects" | "analytics" | "templates" | "myepitech" | "cozy" | "settings";

export const PAGES: Page[] = ["overview", "projects", "git", "library", "testing", "subjects", "analytics", "templates", "myepitech", "cozy", "settings"];

export interface Toast {
  id: number;
  kind: "ok" | "error" | "info";
  title: string;
  detail?: string;
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
  /** Design forced for this run by `--theme` (preview). */
  themeOverride: string | null;
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
  themeOverride: null,
  toasts: [],
  toast: (t) => {
    const id = nextToast++;
    set({ toasts: [...get().toasts, { ...t, id }] });
    window.setTimeout(() => get().dismissToast(id), t.kind === "error" ? 9000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
