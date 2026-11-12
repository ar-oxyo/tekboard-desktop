import { CalendarDays, ChartNoAxesColumn, FileText, FlaskConical, FolderGit2, GitBranch, GraduationCap, LayoutDashboard, LayoutTemplate, LibraryBig, PawPrint, Search, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { cn, Kbd } from "../components/ui";
import { useEnv } from "../lib/hooks";
import { PAGES, useUi, type Page } from "../lib/store";

interface NavItem {
  page: Page;
  label: string;
  icon: ReactNode;
}

const GROUPS: Array<{ title: string | null; items: NavItem[] }> = [
  {
    title: null,
    items: [
      { page: "overview", label: "Overview", icon: <LayoutDashboard className="size-4" /> },
      { page: "projects", label: "Projects", icon: <FolderGit2 className="size-4" /> },
      { page: "agenda", label: "Agenda", icon: <CalendarDays className="size-4" /> },
      { page: "git", label: "Git", icon: <GitBranch className="size-4" /> },
      { page: "library", label: "Library", icon: <LibraryBig className="size-4" /> },
      { page: "testing", label: "Testing", icon: <FlaskConical className="size-4" /> },
      { page: "subjects", label: "Subjects", icon: <FileText className="size-4" /> },
      { page: "analytics", label: "Analytics", icon: <ChartNoAxesColumn className="size-4" /> },
    ],
  },
  {
    title: "Workspace",
    items: [
      { page: "templates", label: "Templates", icon: <LayoutTemplate className="size-4" /> },
      { page: "myepitech", label: "MY Epitech", icon: <GraduationCap className="size-4" /> },
      { page: "cozy", label: "Cozy Fox", icon: <PawPrint className="size-4" /> },
    ],
  },
  { title: "System", items: [{ page: "settings", label: "Settings", icon: <Settings className="size-4" /> }] },
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

      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 pb-2" aria-label="Main">
        {GROUPS.map((group) => (
          <div key={group.title ?? "main"} className="flex flex-col gap-1">
            {group.title && <p className="px-2.5 pt-3 pb-0.5 text-[10px] font-semibold tracking-[0.14em] text-faint uppercase">{group.title}</p>}
            {group.items.map((item) => {
              const n = PAGES.indexOf(item.page) + 1;
              return (
                <button
                  key={item.page}
                  type="button"
                  aria-current={page === item.page ? "page" : undefined}
                  onClick={() => setPage(item.page)}
                  title={n >= 1 && n <= 9 ? `Ctrl+${n}` : undefined}
                  className={cn("nav-item flex h-[34px] shrink-0 items-center gap-2.5 px-2.5 text-[13px]", page === item.page ? "font-medium" : "text-muted hover:bg-white/5 hover:text-fg")}
                >
                  <span className={page === item.page ? "text-accent" : ""}>{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-white/6 px-4 py-3">
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
