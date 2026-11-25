import { Inbox, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type RepoInfo } from "../lib/api";
import { cn, Kbd } from "../components/ui";
import { Artix } from "../features/artix/Artix";
import { useEnv, usePref, useRepos } from "../lib/hooks";
import { displayName } from "../lib/repos";
import { useUi, type Page } from "../lib/store";
import { PAGE_ICON } from "./pageIcons";
import { entryOf, pageLabel, SECTIONS, sectionOf } from "./sections";
import { t } from "../lib/i18n";

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


/** Ctrl+N of the section a screen opens with, when it is the section's entry. */
function shortcutOf(page: Page): string | undefined {
  const i = SECTIONS.findIndex((s) => s.pages[0].page === page);
  return i >= 0 && i < 9 ? `Ctrl+${i + 1}` : undefined;
}

export function Sidebar() {
  const page = useUi((s) => s.page);
  const setPage = useUi((s) => s.setPage);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const artixOpen = useUi((s) => s.assistantOpen);
  const inboxOpen = useUi((s) => s.inbox !== null);
  const [rail, setRail] = usePref("sidebarRail", false);
  const inbox = useQuery({ queryKey: ["brain-count"], queryFn: api.brainCount, staleTime: 60_000 });
  const repos = useRepos();
  const pinned = (repos.data ?? []).filter((r) => r.meta.favorite && r.meta.visibility === null).slice(0, 5);
  const current = sectionOf(page);
  useEffect(() => {
    const on = () => setRail(!rail);
    window.addEventListener("tekboard:toggle-rail", on);
    return () => window.removeEventListener("tekboard:toggle-rail", on);
  }, [rail, setRail]);

  /** A screen of a tabbed section (Projects, Settings) lights its section's entry. */
  const isOn = (p: Page) => (sectionOf(p).tabs ? current.id === sectionOf(p).id : page === p);
  const go = (p: Page) => setPage(sectionOf(p).tabs ? entryOf(sectionOf(p)) : p);

  const item = (p: Page, extra?: ReactNode) => (
    <NavItem key={p} rail={rail} on={isOn(p)} icon={PAGE_ICON[p]} label={sectionOf(p).tabs ? sectionOf(p).label : pageLabel(p)} hint={shortcutOf(p)} onClick={() => go(p)}>
      {extra}
    </NavItem>
  );

  return (
    <aside className={cn("sidebar group/side flex shrink-0 flex-col transition-[width] duration-(--dur-base) ease-(--ease)", rail ? "w-[52px]" : "w-56")} aria-label="Navigation">
      <div className={cn("flex h-13 shrink-0 items-center gap-2", rail ? "justify-center px-0" : "px-4")}>
        {!rail && (
          <>
            <Logo className="logo-glow size-[22px] shrink-0" />
            <span className="display flex-1 truncate text-md font-bold tracking-[-0.01em]">TekBoard</span>
          </>
        )}
        <button
          type="button"
          onClick={() => setRail(!rail)}
          title={rail ? t("Déplier la barre latérale (Ctrl+B)") : t("Replier la barre latérale (Ctrl+B)")}
          className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-faint transition-[color,background-color,opacity] duration-(--dur-fast) hover:bg-ink/6 hover:text-fg", !rail && "opacity-0 group-hover/side:opacity-100 focus-visible:opacity-100")}
        >
          {rail ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      <div className={cn("shrink-0", rail ? "px-2" : "px-3")}>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          title={rail ? t("Rechercher (Ctrl+K)") : undefined}
          className={cn("flex h-8 w-full items-center gap-2.5 rounded-(--btn-radius) border border-line bg-ink/3 text-faint transition-colors duration-(--dur-fast) hover:border-line-strong hover:text-muted", rail ? "justify-center" : "px-2.5")}
        >
          <Search className="size-4 shrink-0" />
          {!rail && (
            <>
              <span className="flex-1 text-left">{t("Rechercher")}</span>
              <Kbd>Ctrl K</Kbd>
            </>
          )}
        </button>
      </div>

      <nav className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto pt-3 pb-3", rail ? "px-2" : "px-3")}>
        <div className="flex flex-col gap-px">
          {item("overview")}
          {item("projects")}
          {item("agenda")}
          <NavItem rail={rail} on={inboxOpen} icon={<Inbox className="size-4" />} label={t("Inbox")} hint={t("Captures à ranger · Ctrl+I pour noter")} onClick={() => useUi.getState().openInbox()}>
            {(inbox.data ?? 0) > 0 && <Count rail={rail} n={inbox.data ?? 0} />}
          </NavItem>
        </div>

        {/* The other sections, one entry each: their screens are tabs in the page bar. */}
        <div className={cn("flex flex-col gap-px", rail ? "mt-2 border-t border-line pt-2" : "mt-3")}>
          {item("myepitech")}
          {item("analytics")}
          {item("playground")}
          {item("connect")}
        </div>

        {pinned.length > 0 && <Pinned rail={rail} repos={pinned} />}
      </nav>

      <div className={cn("flex shrink-0 flex-col gap-px border-t border-line py-2", rail ? "px-2" : "px-3")}>
        <NavItem rail={rail} on={artixOpen} icon={<Artix size={18} />} label="Artix" hint="Ctrl+J" onClick={() => (artixOpen ? useUi.getState().closeAssistant() : useUi.getState().openAssistant())} />
        {item("templates")}
        {item("settings")}
        <Health rail={rail} />
      </div>
    </aside>
  );
}

function NavItem({ rail, on, icon, label, hint, onClick, children }: { rail: boolean; on: boolean; icon: ReactNode; label: string; hint?: string; onClick: () => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      aria-current={on ? "page" : undefined}
      onClick={onClick}
      title={rail ? (hint ? `${label} · ${hint}` : label) : hint}
      className={cn("nav-item relative flex h-7 shrink-0 items-center gap-2.5 text-sm", rail ? "justify-center" : "px-2.5", on ? "font-medium text-fg" : "text-muted hover:bg-ink/5 hover:text-fg")}
    >
      <span className={cn("flex w-4 shrink-0 justify-center", on ? "text-accent" : "text-faint")}>{icon}</span>
      {!rail && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {children}
    </button>
  );
}

function Count({ n, rail }: { n: number; rail: boolean }) {
  if (rail) return <span aria-hidden className="absolute top-1 right-1.5 size-1.5 rounded-full bg-accent" />;
  return <span className="text-2xs text-faint tabular-nums">{n}</span>;
}

/** Days until a hand-in, as the dot size: the closer, the bigger (three steps). */
function urgency(r: RepoInfo): 0 | 1 | 2 {
  if (r.deadlineState === "overdue" || r.deadlineState === "today") return 2;
  const at = r.meta.deadlineAt ?? r.meta.deadline;
  if (!at || r.progress === "done") return 0;
  const days = (new Date(at).getTime() - Date.now()) / 86_400_000;
  return days <= 3 ? 1 : 0;
}

function Pinned({ repos, rail }: { repos: RepoInfo[]; rail: boolean }) {
  const openSheet = useUi((s) => s.openSheet);
  const sheet = useUi((s) => s.sheetPath);
  return (
    <div className={cn("flex flex-col gap-px", rail ? "mt-2 border-t border-line pt-2" : "mt-3")}>
      {!rail && <p className="flex h-6 items-center px-2.5 text-xs text-faint">{t("Épinglés")}</p>}
      {repos.map((r) => {
        const u = urgency(r);
        const name = displayName(r);
        return (
          <button
            key={r.path}
            type="button"
            onClick={() => openSheet(r.path)}
            aria-current={sheet === r.path ? "true" : undefined}
            title={rail ? name : r.epitech ? `${name} · ${r.epitech.module}` : undefined}
            className={cn("nav-item flex h-7 shrink-0 items-center gap-2.5 text-sm", rail ? "justify-center" : "px-2.5", sheet === r.path ? "text-fg" : "text-muted hover:bg-ink/5 hover:text-fg")}
          >
            <span className="flex w-4 shrink-0 items-center justify-center">
              <span aria-hidden className={cn("rounded-full", u === 2 ? "size-2 bg-accent-2" : u === 1 ? "size-1.5 bg-accent-2" : "size-1.5 bg-faint")} />
            </span>
            {!rail && <span className="min-w-0 flex-1 truncate text-left">{name}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Tools and GitHub in one line: quiet when all is well, the first problem otherwise. */
function Health({ rail }: { rail: boolean }) {
  const env = useEnv();
  const missing = env.data?.tools.filter((x) => x.required && !x.path).length ?? 0;
  const gh = env.data?.github.state;
  const toolsLine = env.data ? (missing === 0 ? t("Outils prêts") : t("{n} outil(s) manquant(s)", { n: missing })) : t("Vérification des outils…");
  const ghLine = gh === undefined ? t("Vérification de GitHub…") : gh === "ready" ? t("GitHub connecté") : gh === "missing" ? t("gh non installé") : gh === "loggedOut" ? t("gh non connecté") : t("GitHub injoignable");
  const ok = env.data ? missing === 0 && gh === "ready" : null;
  const label = ok === null ? t("Vérification…") : ok ? t("Tout est prêt") : missing > 0 ? toolsLine : ghLine;
  return (
    <button
      type="button"
      onClick={() => useUi.setState({ page: "settings", settingsTab: "doctor", sheetPath: null })}
      title={`${toolsLine} · ${ghLine} — ${t("Ouvrir le Doctor")}`}
      className={cn("mt-1 flex h-7 items-center gap-2.5 rounded-(--btn-radius) text-xs transition-colors duration-(--dur-fast) hover:bg-ink/5", rail ? "justify-center" : "px-2.5", ok === false ? "text-warn" : "text-faint hover:text-muted")}
    >
      <span className="flex w-4 shrink-0 justify-center">
        <span aria-hidden className={cn("size-1.5 rounded-full", ok === null ? "bg-faint" : ok ? "bg-ok" : "bg-warn")} />
      </span>
      {!rail && <span className="truncate">{label}</span>}
    </button>
  );
}

/** Tabs of a tabbed section (Projects, Settings), in the page bar. */
export function SectionTabs() {
  const page = useUi((s) => s.page);
  const setPage = useUi((s) => s.setPage);
  const s = sectionOf(page);
  if (!s.tabs) return null;
  return (
    <div className="flex items-center gap-0.5" role="tablist" aria-label={s.label}>
      {s.pages.map((p) => (
        <button
          key={p.page}
          type="button"
          role="tab"
          aria-selected={p.page === page}
          onClick={() => setPage(p.page)}
          className={cn("h-7 rounded-(--btn-radius) px-2.5 text-sm transition-colors duration-(--dur-fast)", p.page === page ? "bg-ink/7 font-medium text-fg" : "text-muted hover:bg-ink/4 hover:text-fg")}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
