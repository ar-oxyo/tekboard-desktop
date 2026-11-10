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
    <aside className="sidebar flex w-[212px] shrink-0 flex-col">
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
        <Logo className="logo-glow size-8" />
        <span className="display text-[17px] font-semibold">TekBoard</span>
      </div>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="mx-3 mb-4 flex h-9 items-center gap-2 rounded-lg border border-white/8 bg-black/30 px-2.5 text-faint shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)] transition-colors hover:border-white/16 hover:text-muted"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left text-[13px]">Search</span>
        <Kbd>Ctrl K</Kbd>
      </button>

      <nav className="flex flex-col gap-1 px-2.5" aria-label="Main">
        {NAV.map((item) => (
          <button
            key={item.page}
            type="button"
            aria-current={page === item.page ? "page" : undefined}
            onClick={() => setPage(item.page)}
            title={`Ctrl+${item.key}`}
            className={cn("nav-item flex h-[34px] items-center gap-2.5 px-2.5 text-[13px]", page === item.page ? "font-medium" : "text-muted hover:bg-white/5 hover:text-fg")}
          >
            <span className={page === item.page ? "text-accent" : ""}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto border-t border-white/6 px-4 py-3">
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
