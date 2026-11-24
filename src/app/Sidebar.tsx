import { CalendarDays, ChartNoAxesColumn, FolderGit2, GraduationCap, LayoutTemplate, Search, Settings, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { cn, Kbd } from "../components/ui";
import { Artix } from "../features/artix/Artix";
import { useEnv } from "../lib/hooks";
import { useUi } from "../lib/store";
import { entryOf, SECTIONS, sectionOf, type Section } from "./sections";
import { t } from "../lib/i18n";

const icon = "size-4";
const ICONS: Record<Section["id"], ReactNode> = {
  today: <Sun className={icon} />,
  projects: <FolderGit2 className={icon} />,
  planning: <CalendarDays className={icon} />,
  school: <GraduationCap className={icon} />,
  stats: <ChartNoAxesColumn className={icon} />,
  resources: <LayoutTemplate className={icon} />,
  settings: <Settings className={icon} />,
};
const MAIN = SECTIONS.slice(0, 5);
const FOOT = SECTIONS.slice(5);

export function Logo({ className }: { className?: string }) {
  // Same drawing as public/tekboard.svg: a T inside a progress ring.
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <defs>
        <linearGradient id="tb-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#25222f" />
          <stop offset="1" stopColor="#121117" />
        </linearGradient>
        <linearGradient id="tb-logo-ink" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c3b9ff" />
          <stop offset="1" stopColor="#7c68f2" />
        </linearGradient>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#tb-logo-bg)" />
      <rect x="21" y="21" width="470" height="470" rx="107" fill="none" stroke="#fff" strokeOpacity=".09" strokeWidth="10" />
      <circle cx="256" cy="256" r="150" fill="none" stroke="#9486ff" strokeOpacity=".16" strokeWidth="34" />
      <circle cx="256" cy="256" r="150" fill="none" stroke="url(#tb-logo-ink)" strokeWidth="34" strokeLinecap="round" strokeDasharray="700 243" transform="rotate(-90 256 256)" />
      <path d="M194 202H318M256 202V318" fill="none" stroke="url(#tb-logo-ink)" strokeWidth="50" strokeLinecap="round" />
    </svg>
  );
}

export function Sidebar() {
  const page = useUi((s) => s.page);
  const setPage = useUi((s) => s.setPage);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const artixOpen = useUi((s) => s.assistantOpen);
  const env = useEnv();
  const current = sectionOf(page).id;
  const missing = env.data?.tools.filter((t) => t.required && !t.path).length ?? 0;
  const gh = env.data?.github.state;

  const row = (s: Section) => {
    const n = SECTIONS.indexOf(s) + 1;
    const on = current === s.id;
    return (
      <button key={s.id} type="button" aria-current={on ? "page" : undefined} onClick={() => setPage(entryOf(s))} title={`Ctrl+${n}`} className={cn("nav-item flex h-8 shrink-0 items-center gap-2.5 px-2.5 text-[13px]", on ? "font-medium" : "text-muted hover:bg-white/4 hover:text-fg")}>
        <span className={cn("flex w-4 shrink-0 justify-center", on ? "text-accent" : "text-faint")}>{ICONS[s.id]}</span>
        {s.label}
      </button>
    );
  };

  return (
    <aside className="sidebar flex w-56 shrink-0 flex-col">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <Logo className="logo-glow size-6" />
        <span className="display text-[15px] font-medium">TekBoard</span>
      </div>
      <button type="button" onClick={() => setPaletteOpen(true)} className="mx-3 flex h-8 items-center gap-2.5 rounded-(--btn-radius) border border-white/7 bg-white/3 px-2.5 text-faint transition-colors duration-150 hover:border-white/12 hover:text-muted">
        <Search className="size-4" />
        <span className="flex-1 text-left text-[13px]">{t("Rechercher")}</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pt-5 pb-3" aria-label="Navigation">
        {MAIN.map(row)}
        <button type="button" onClick={() => (artixOpen ? useUi.getState().closeAssistant() : useUi.getState().openAssistant())} title="Ctrl+J" className={cn("nav-item mt-4 flex h-9 shrink-0 items-center gap-2.5 px-2 text-[13px]", artixOpen ? "font-medium" : "text-muted hover:bg-white/4 hover:text-fg")}>
          <Artix size={20} />
          Artix
          <Kbd>Ctrl J</Kbd>
        </button>
      </nav>
      <div className="flex flex-col gap-0.5 border-t border-white/6 px-3 py-3">
        {FOOT.map(row)}
        <button type="button" onClick={() => setPage("settings")} title={t("Ouvrir les réglages")} className="mt-2 flex w-full flex-col gap-1 px-2.5 text-left text-xs text-faint transition-colors duration-150 hover:text-muted">
          <Status ok={env.data ? missing === 0 : null} label={env.data ? (missing === 0 ? t("Outils prêts") : `${missing} outil${missing > 1 ? "s" : ""} manquant${missing > 1 ? "s" : ""}`) : t("Vérification des outils…")} />
          <Status ok={gh === undefined ? null : gh === "ready"} label={gh === undefined ? t("Vérification de GitHub…") : gh === "ready" ? t("GitHub connecté") : gh === "missing" ? t("gh non installé") : gh === "loggedOut" ? t("gh non connecté") : t("GitHub injoignable")} />
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

/** Tabs of the current section, above its screen. */
export function SectionTabs() {
  const page = useUi((s) => s.page);
  const setPage = useUi((s) => s.setPage);
  const s = sectionOf(page);
  if (s.pages.length < 2) return null;
  return (
    <div className="mb-5 flex items-center gap-1 border-b border-white/6" role="tablist" aria-label={s.label}>
      {s.pages.map((p) => (
        <button key={p.page} type="button" role="tab" aria-selected={p.page === page} onClick={() => setPage(p.page)} className={cn("-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors duration-150", p.page === page ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg")}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
