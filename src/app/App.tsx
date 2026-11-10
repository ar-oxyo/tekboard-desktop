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
import { api } from "../lib/api";
import { PAGES, useUi, type Page } from "../lib/store";
import { AnalyticsPage } from "../features/analytics/AnalyticsPage";
import { CozyPage } from "../features/cozy/CozyPage";
import { GitPage } from "../features/git/GitPage";
import { Sidebar } from "./Sidebar";


export function App() {
  const page = useUi((s) => s.page);
  const setPage = useUi((s) => s.setPage);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const openLauncher = useUi((s) => s.openLauncher);
  const launch = useUi((s) => s.launch);
  const sheetPath = useUi((s) => s.sheetPath);
  const settings = useSettings();

  // Glass only when the user keeps it on and the system does not ask for less transparency.
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
      },
      () => undefined,
    );
  }, [setPage]);

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
      } else if (/^[1-8]$/.test(key)) {
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
        <div key={page} className="anim-rise mx-auto max-w-[1180px] px-7 py-6">
          {page === "overview" && <OverviewPage />}
          {page === "projects" && <ProjectsPage />}
          {page === "git" && <GitPage />}
          {page === "subjects" && <SubjectsPage />}
          {page === "analytics" && <AnalyticsPage />}
          {page === "cozy" && <CozyPage />}
          {page === "templates" && <TemplatesPage />}
          {page === "settings" && <SettingsPage />}
        </div>
      </main>
      <CommandPalette />
      {sheetPath && <ProjectSheetDialog key={sheetPath} path={sheetPath} />}
      {launch && <LauncherDialog key={JSON.stringify(launch)} request={launch} />}
      <Toaster />
    </div>
  );
}
