import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "../components/Toaster";
import { LauncherDialog } from "../features/launcher/LauncherDialog";
import { OverviewPage } from "../features/overview/OverviewPage";
import { CommandPalette } from "../features/palette/CommandPalette";
import { ProjectSheetDialog } from "../features/projects/ProjectSheet";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { SubjectsPage } from "../features/subjects/SubjectsPage";
import { TemplatesPage } from "../features/templates/TemplatesPage";
import { useSettings } from "../lib/hooks";
import { api, asAppError } from "../lib/api";
import { listenJobs } from "../lib/jobs";
import { invalidate, listenData, setQueryClient } from "../lib/sync";
import { PAGES, useUi, type Page } from "../lib/store";
import { AnalyticsPage } from "../features/analytics/AnalyticsPage";
import { CozyPage } from "../features/cozy/CozyPage";
import { GitPage } from "../features/git/GitPage";
import { LibraryPage } from "../features/library/LibraryPage";
import { MyEpitechPage } from "../features/myepitech/MyEpitechPage";
import { PlanningPage } from "../features/planning/PlanningPage";
import { EventDialog, QuickCapture, TaskDialog, useCaptureShortcut } from "../features/planning/Dialogs";
import { FocusBar } from "../features/planning/Focus";
import { AssistantPanel } from "../features/assistant/AssistantPanel";
import { PromptsPage } from "../features/prompts/PromptsPage";
import { TestingPage } from "../features/testing/TestingPage";
import { PackageDialog } from "../features/tools/PackageDialog";
import { ReadmeDialog } from "../features/tools/ReadmeDialog";
import { Sidebar } from "./Sidebar";


/** `tekboard --repo <path> --run banana` starts that check and shows it. */
async function startFromCli(repo: string, what: string) {
  const ui = useUi.getState();
  try {
    const info = await api.testingInfo(repo);
    const tests = info.detection.suites.find((x) => x.trusted)?.command ?? info.config.testCmd;
    let id: number | null = null;
    if (what === "banana") id = await api.bananaRun(repo);
    else if (what === "tests" && tests) id = await api.testsRun(repo, tests, false);
    else if (what === "testrepo" || what === "testrepo-remote") id = await api.testrepoStart(repo, { mode: what === "testrepo" ? "snapshot" : "remote", rev: null, build: info.defaultBuild, tests: tests ?? null, isolation: "none", image: null });
    else if (what === "moulinette") id = await api.moulinetteStart(repo, { build: info.defaultBuild, tests: tests ?? null, memoryRun: info.config.runCmd, subjectAi: false });
    else if (what === "analysis") id = await api.analysisStart(repo);
    if (id !== null) ui.showJob(id, repo);
    else ui.toast({ kind: "error", title: `Nothing to run for “${what}”` });
  } catch (e) {
    ui.toast({ kind: "error", title: "Could not start", detail: asAppError(e).message });
  }
}

export function App() {
  const page = useUi((s) => s.page);
  const setPage = useUi((s) => s.setPage);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const openLauncher = useUi((s) => s.openLauncher);
  const launch = useUi((s) => s.launch);
  const sheetPath = useUi((s) => s.sheetPath);
  const tool = useUi((s) => s.tool);
  const settings = useSettings();
  const qc = useQueryClient();
  useCaptureShortcut();

  // Glass only when the user keeps it on and the system does not ask for less transparency.
  const themeOverride = useUi((s) => s.themeOverride);
  useEffect(() => {
    document.documentElement.dataset.theme = themeOverride ?? settings.data?.theme ?? "aurora";
  }, [themeOverride, settings.data?.theme]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
    const on = (settings.data?.glassEffects ?? false) && !reduce;
    document.documentElement.dataset.glass = on ? "on" : "off";
  }, [settings.data?.glassEffects]);

  // `tekboard --page git` / `--sheet <path>` open the app directly there.
  useEffect(() => {
    api.startup().then(
      (s) => {
        if (s.page && (PAGES as string[]).includes(s.page)) setPage(s.page as Page);
        if (s.sheet) useUi.getState().openSheet(s.sheet);
        if (s.theme) useUi.setState({ themeOverride: s.theme });
        if (s.repo) useUi.setState({ libraryRepo: s.repo, testingRepo: s.repo, gitRepo: s.repo });
        if (s.pick) useUi.setState({ libraryPick: s.pick.split(",").filter(Boolean) });
        if (s.repo && (s.tool === "package" || s.tool === "readme")) useUi.getState().openTool(s.tool, s.repo);
        if (s.report !== null) useUi.setState({ runId: s.report, page: "testing" });
        if (s.anchor) {
          // The section may appear once its data is loaded: try for a few seconds.
          let tries = 0;
          const id = window.setInterval(() => {
            const el = document.getElementById(s.anchor!);
            if (el) el.scrollIntoView({ block: "start" });
            if (el || ++tries > 20) window.clearInterval(id);
          }, 400);
        }
        if (s.run === "claude-check") {
          // `tekboard --run claude-check`: opens Settings → Tools and sends the test prompt.
          useUi.setState({ claudeAutoCheck: true });
          setPage("settings");
        } else if (s.run === "plan-week" || s.run === "plan-day") {
          // `tekboard --run plan-week`: opens the assistant with the local plan for the week (nothing is applied).
          useUi.getState().openAssistant({ text: s.run === "plan-week" ? "#week" : "#day" });
        } else if (s.run === "capture") {
          useUi.getState().setCaptureOpen(true);
        } else if (s.run === "new-task") {
          useUi.getState().editTask({});
        } else if (s.run === "my-connect") {
          setPage("myepitech");
          void api.myConnect().catch(() => undefined);
        } else if (s.repo && s.run) void startFromCli(s.repo, s.run);
      },
      () => undefined,
    );
  }, [setPage]);

  // Jobs report their progress as events (see lib/jobs.ts).
  useEffect(() => {
    const off = listenJobs(qc);
    return () => void off.then((f) => f());
  }, [qc]);
  // Backend changes (jobs, syncs, Tika's actions, timers) and writes made here refresh
  // every screen that shows them (see lib/sync.ts).
  useEffect(() => {
    setQueryClient(qc);
    const off = listenData(qc);
    const unauth = listen<{ unauthorized: boolean }>("my-synced", (e) => {
      if (e.payload.unauthorized) useUi.getState().toast({ kind: "error", title: "MY Epitech a refusé la session", detail: "La synchronisation automatique est arrêtée. Ouvre École → MY Epitech et reconnecte-toi." });
    });
    return () => {
      void off.then((f) => f());
      void unauth.then((f) => f());
    };
  }, [qc]);
  // The day changed while the window stayed open: hand-in states are recomputed.
  useEffect(() => {
    let day = new Date().toDateString();
    const id = window.setInterval(() => {
      const d = new Date().toDateString();
      if (d !== day) {
        day = d;
        // Hand-in states, "today" and the planning's current day are recomputed.
        invalidate(qc, ["repos", "plan"]);
        window.dispatchEvent(new CustomEvent("tekboard:day-changed"));
      }
    }, 60_000);
    return () => window.clearInterval(id);
  }, [qc]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        setPaletteOpen(!useUi.getState().paletteOpen);
      } else if (key === "n" && !e.shiftKey) {
        e.preventDefault();
        openLauncher({ mode: "new" });
      } else if (/^[1-9]$/.test(key)) {
        e.preventDefault();
        setPage(PAGES[Number(key) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPage, setPaletteOpen, openLauncher]);

  return (
    <div className="flex h-full">
      <div className="app-bg" aria-hidden />
      <Sidebar />
      <main className="relative z-[1] min-w-0 flex-1 overflow-y-auto">
        {page === "agenda" ? (
          <div key={page} className="anim-rise h-full">
            <PlanningPage />
          </div>
        ) : (
        <div key={page} className="anim-rise mx-auto max-w-[1440px] px-8 pt-7 pb-10">
          {page === "overview" && <OverviewPage />}
          {page === "projects" && <ProjectsPage />}
          {page === "git" && <GitPage />}
          {page === "library" && <LibraryPage />}
          {page === "testing" && <TestingPage />}
          {page === "subjects" && <SubjectsPage />}
          {page === "analytics" && <AnalyticsPage />}
          {page === "myepitech" && <MyEpitechPage />}
          {page === "cozy" && <CozyPage />}
          {page === "templates" && <TemplatesPage />}
          {page === "settings" && <SettingsPage />}
          {page === "prompts" && <PromptsPage />}
        </div>
        )}
      </main>
      <CommandPalette />
      {sheetPath && <ProjectSheetDialog key={sheetPath} path={sheetPath} />}
      {launch && <LauncherDialog key={JSON.stringify(launch)} request={launch} />}
      {tool?.kind === "package" && <PackageDialog key={tool.repo} repo={tool.repo} />}
      {tool?.kind === "readme" && <ReadmeDialog key={tool.repo} repo={tool.repo} />}
      <EventDialog />
      <TaskDialog />
      <QuickCapture />
      <AssistantPanel />
      <FocusBar />
      <Toaster />
    </div>
  );
}
