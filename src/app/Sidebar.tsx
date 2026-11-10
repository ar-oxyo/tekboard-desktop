import { ChartNoAxesColumn, FileText, FolderGit2, GitBranch, LayoutDashboard, LayoutTemplate, PawPrint, Search, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { cn, Kbd } from "../components/ui";
import { useEnv } from "../lib/hooks";
import { useUi, type Page } from "../lib/store";

const NAV: Array<{ page: Page; label: string; icon: ReactNode; key: string }> = [
  { page: "overview", label: "Overview", icon: <LayoutDashboard className="size-4" />, key: "1" },
  { page: "projects", label: "Projects", icon: <FolderGit2 className="size-4" />, key: "2" },
  { page: "git", label: "Git", icon: <GitBranch className="size-4" />, key: "3" },
  { page: "subjects", label: "Subjects", icon: <FileText className="size-4" />, key: "4" },
  { page: "templates", label: "Templates", icon: <LayoutTemplate className="size-4" />, key: "5" },
  { page: "analytics", label: "Analytics", icon: <ChartNoAxesColumn className="size-4" />, key: "6" },
  { page: "cozy", label: "Cozy Fox", icon: <PawPrint className="size-4" />, key: "7" },
  { page: "settings", label: "Settings", icon: <Settings className="size-4" />, key: "8" },
];

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <rect width="512" height="512" rx="116" fill="#15181e" />
      <rect x="6" y="6" width="500" height="500" rx="110" fill="none" stroke="#343b49" strokeWidth="12" />
      <rect x="112" y="124" width="84" height="84" rx="20" fill="#8f83f7" />
      <rect x="214" y="124" width="84" height="84" rx="20" fill="#8f83f7" />
      <rect x="316" y="124" width="84" height="84" rx="20" fill="#8f83f7" />
      <rect x="214" y="226" width="84" height="84" rx="20" fill="#a69cfb" />
      <rect x="214" y="328" width="84" height="60" rx="20" fill="#a69cfb" />
      <rect x="316" y="352" width="84" height="36" rx="14" fill="#e8eaf0" />
    </svg>
  );
}

export function Sidebar() {
  const page = useUi((s) => s.page);
  const setPage = useUi((s) => s.setPage);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const env = useEnv();

  const missing = env.data?.tools.filter((t) => t.required && !t.path).length ?? 0;
  const gh = env.data?.github.state;

  return (
    <aside className="flex w-[208px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
        <Logo className="size-7" />
        <span className="text-[15px] font-semibold tracking-tight">TekBoard</span>
      </div>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="mx-3 mb-3 flex h-8 items-center gap-2 rounded-md border border-line bg-bg px-2.5 text-faint transition-colors hover:border-line-strong hover:text-muted"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left text-[13px]">Search</span>
        <Kbd>Ctrl K</Kbd>
      </button>

      <nav className="flex flex-col gap-0.5 px-2" aria-label="Main">
        {NAV.map((item) => (
          <button
            key={item.page}
            type="button"
            aria-current={page === item.page ? "page" : undefined}
            onClick={() => setPage(item.page)}
            title={`Ctrl+${item.key}`}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors duration-100",
              page === item.page ? "bg-raised font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg",
            )}
          >
            <span className={page === item.page ? "text-accent" : ""}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto border-t border-line px-4 py-3">
        <button type="button" onClick={() => setPage("settings")} className="flex w-full flex-col gap-1.5 text-left text-xs text-faint hover:text-muted">
          <Status ok={env.data ? missing === 0 : null} label={env.data ? (missing === 0 ? "Tools ready" : `${missing} tool${missing > 1 ? "s" : ""} missing`) : "Checking tools…"} />
          <Status
            ok={gh === undefined ? null : gh === "ready"}
            label={gh === undefined ? "Checking GitHub…" : gh === "ready" ? "GitHub connected" : gh === "missing" ? "gh not installed" : gh === "loggedOut" ? "gh not logged in" : "GitHub unreachable"}
          />
        </button>
      </div>
    </aside>
  );
}

function Status({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn("size-1.5 rounded-full", ok === null ? "bg-faint" : ok ? "bg-ok" : "bg-warn")} />
      {label}
    </span>
  );
}
