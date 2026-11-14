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

const icon = "size-4";
const GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Work",
    items: [
      { page: "overview", label: "Overview", icon: <LayoutDashboard className={icon} /> },
      { page: "projects", label: "Projects", icon: <FolderGit2 className={icon} /> },
      { page: "agenda", label: "Planning", icon: <CalendarDays className={icon} /> },
    ],
  },
  {
    title: "Code",
    items: [
      { page: "git", label: "Git", icon: <GitBranch className={icon} /> },
      { page: "testing", label: "Testing", icon: <FlaskConical className={icon} /> },
      { page: "library", label: "Library", icon: <LibraryBig className={icon} /> },
      { page: "templates", label: "Templates", icon: <LayoutTemplate className={icon} /> },
    ],
  },
  {
    title: "School",
    items: [
      { page: "myepitech", label: "MY Epitech", icon: <GraduationCap className={icon} /> },
      { page: "subjects", label: "Subjects", icon: <FileText className={icon} /> },
      { page: "analytics", label: "Analytics", icon: <ChartNoAxesColumn className={icon} /> },
    ],
  },
];
/** Pinned under the groups: the companion and the settings are not part of the daily work. */
const FOOT: NavItem[] = [
  { page: "cozy", label: "Cozy Fox", icon: <PawPrint className={icon} /> },
  { page: "settings", label: "Settings", icon: <Settings className={icon} /> },
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

  const row = (item: NavItem) => {
    const n = PAGES.indexOf(item.page) + 1;
    const current = page === item.page;
    return (
      <button
        key={item.page}
        type="button"
        aria-current={current ? "page" : undefined}
        onClick={() => setPage(item.page)}
        title={n >= 1 && n <= 9 ? `Ctrl+${n}` : undefined}
        className={cn("nav-item flex h-8 shrink-0 items-center gap-2.5 px-2.5 text-[13px]", current ? "font-medium" : "text-muted hover:bg-white/4 hover:text-fg")}
      >
        <span className={cn("flex w-4 shrink-0 justify-center", current ? "text-accent" : "text-faint")}>{item.icon}</span>
        {item.label}
      </button>
    );
  };

  return (
    <aside className="sidebar flex w-60 shrink-0 flex-col">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <Logo className="logo-glow size-6" />
        <span className="display text-[15px] font-medium">TekBoard</span>
      </div>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="mx-3 flex h-8 items-center gap-2.5 rounded-(--btn-radius) border border-white/7 bg-white/3 px-2.5 text-faint transition-colors duration-150 hover:border-white/12 hover:text-muted"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left text-[13px]">Search</span>
        <Kbd>Ctrl K</Kbd>
      </button>

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3" aria-label="Main">
        {GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-0.5">
            <p className="px-2.5 pt-6 pb-2 text-xs text-faint">{group.title}</p>
            {group.items.map(row)}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-white/6 px-3 py-3">
        {FOOT.map(row)}
        <button type="button" onClick={() => setPage("settings")} title="Open Settings" className="mt-2 flex w-full flex-col gap-1 px-2.5 text-left text-xs text-faint transition-colors duration-150 hover:text-muted">
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
    <span className="flex h-5 items-center gap-2.5">
      <span className="flex w-4 shrink-0 justify-center">
        <span className={cn("size-1.5 rounded-full", ok === null ? "bg-faint" : ok ? "bg-ok" : "bg-warn")} />
      </span>
      {label}
    </span>
  );
}
