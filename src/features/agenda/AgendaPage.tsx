// Agenda: hand-ins, sessions and holidays on one timeline, day by day.
// Hand-ins come from the same list as the dashboard; sessions and holidays from the last MY Epitech sync.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Flag, GraduationCap, PartyPopper, RefreshCw, Rocket, Search, Users } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Card, cn, Dot, EmptyState, ErrorNote, Input, PageHeader, Spinner, Tag } from "../../components/ui";
import { Countdown } from "../projects/RepoBits";
import { api, asAppError, type AgendaItem } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useNow, usePref } from "../../lib/hooks";
import { daysLeft, due } from "../../lib/repos";
import { useUi } from "../../lib/store";

type Scope = "mine" | "all";

const ICON: Record<AgendaItem["kind"], ReactNode> = {
  deadline: <Flag className="size-4" />,
  start: <Rocket className="size-4" />,
  activity: <GraduationCap className="size-4" />,
  event: <Users className="size-4" />,
  holiday: <PartyPopper className="size-4" />,
};
const KIND: Record<AgendaItem["kind"], string> = { deadline: "Hand-in", start: "Project start", activity: "Your session", event: "Session", holiday: "Holiday" };

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }) : null);
const dayDate = (day: string) => new Date(`${day}T12:00:00`);
const dayTitle = (day: string) => dayDate(day).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
const relative = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n > 0 ? `in ${n} days` : `${-n} days ago`);

export function AgendaPage() {
  const qc = useQueryClient();
  const now = useNow();
  const openSheet = useUi((s) => s.openSheet);
  const setPage = useUi((s) => s.setPage);
  const q = useQuery({ queryKey: ["repos", "agenda"], queryFn: api.myAgenda });
  const [scope, setScope] = usePref<Scope>("agenda.scope", "mine");
  const [past, setPast] = useState(false);
  const [query, setQuery] = useState("");
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const items = q.data?.items ?? [];
  const days = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const kept = items.filter((i) => {
      if (scope === "mine" && !i.mine) return false;
      // A period still running today stays visible.
      const last = i.until ?? i.day;
      if (past ? last >= today : last < today) return false;
      const hay = `${i.title} ${i.module ?? ""} ${i.detail ?? ""} ${KIND[i.kind]}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const map = new Map<string, AgendaItem[]>();
    for (const i of kept) map.set(i.day, [...(map.get(i.day) ?? []), i]);
    const list = [...map.entries()];
    return past ? list.reverse() : list;
  }, [items, scope, past, query, today]);
  const counts = { mine: items.filter((i) => i.mine).length, all: items.length };
  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle={q.data?.syncedAt ? `Hand-ins, sessions and holidays · MY Epitech synced ${timeAgo(q.data.syncedAt)}` : "Hand-ins from your projects. Sync MY Epitech to add sessions and holidays."}
        actions={
          <Button variant="ghost" icon={<RefreshCw className="size-3.5" />} busy={q.isFetching} onClick={() => void qc.invalidateQueries({ queryKey: ["repos"] })}>
            Refresh
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <Input className="pl-8" aria-label="Search by title, module or room" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex items-center gap-0.5" role="tablist" aria-label="What to show">
          {([["mine", "Mine", "Your hand-ins, your projects' sessions, and sessions of the modules you are registered in"], ["all", "Whole campus", "Every session MY Epitech lists for the synced window"]] as const).map(([id, label, title]) => (
            <button key={id} type="button" role="tab" aria-selected={scope === id} title={title} onClick={() => setScope(id)} className={cn("flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors duration-150", scope === id ? "bg-raised text-fg" : "text-muted hover:text-fg")}>
              {label} <span className="font-mono text-[11px] text-faint">{counts[id]}</span>
            </button>
          ))}
        </div>
        <button type="button" role="switch" aria-checked={past} onClick={() => setPast(!past)} className={cn("ml-auto flex h-7 items-center rounded-md border px-2.5 text-xs transition-colors duration-150", past ? "border-transparent bg-accent-soft text-accent-strong" : "border-white/8 text-muted hover:text-fg")}>
          Past
        </button>
      </div>
      {q.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted">
          <Spinner /> Reading dates…
        </p>
      ) : q.error ? (
        <ErrorNote title="The agenda could not be read">{asAppError(q.error).message}</ErrorNote>
      ) : days.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarDays className="size-6" />} title={items.length === 0 ? "Nothing dated yet" : past ? "Nothing in the past matches" : "Nothing ahead matches"} action={items.length === 0 ? <Button onClick={() => setPage("myepitech")}>Open MY Epitech</Button> : undefined}>
            {items.length === 0 ? "No hand-in date is set and nothing was synced from MY Epitech. TekBoard never invents a date." : "Try “Whole campus”, another search, or the other time direction."}
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {days.map(([day, list]) => {
            const n = daysLeft(day, now) ?? 0;
            return (
              <section key={day} className="grid grid-cols-[160px_minmax(0,1fr)] gap-4">
                <header className="pt-3">
                  <p className={cn("text-[13px] capitalize", n === 0 ? "font-medium text-accent-strong" : "text-fg")}>{dayTitle(day)}</p>
                  <p className="text-xs text-faint">{relative(n)}</p>
                </header>
                <Card>
                  <ul>
                    {list.map((i, k) => {
                      const d = i.kind === "deadline" ? due(i.day, i.start, now) : null;
                      const span = i.until ? `until ${dayDate(i.until).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : [time(i.start), time(i.end)].filter(Boolean).join(" – ");
                      const body = (
                        <>
                          <span className={cn("flex w-4 shrink-0 justify-center", i.kind === "deadline" ? "text-accent-strong" : "text-faint")} title={KIND[i.kind]}>
                            {ICON[i.kind]}
                          </span>
                          <span className="w-[104px] shrink-0 font-mono text-xs whitespace-nowrap text-muted">{span || "all day"}</span>
                          <span className="min-w-0 flex-1">
                            <span className={cn("block truncate text-[13px]", i.kind === "deadline" && "font-medium")}>{i.title}</span>
                            {i.detail && <span className="block truncate text-xs text-faint">{i.detail}</span>}
                          </span>
                          {i.exam && <Dot tone="warn">exam</Dot>}
                          {i.mandatory && i.kind === "activity" && <Dot tone="warn">mandatory</Dot>}
                          {d && d.state !== "unknown" && <Countdown tone={d.tone}>{d.label}</Countdown>}
                          <span className="flex w-20 shrink-0 justify-end">{i.module && <Tag>{i.module}</Tag>}</span>
                        </>
                      );
                      return (
                        <li key={`${i.kind}-${i.title}-${i.start ?? ""}-${k}`} className="border-b border-white/6 last:border-b-0">
                          {i.repoPath ? (
                            <button type="button" onClick={() => openSheet(i.repoPath!)} className="row-hover flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left">
                              {body}
                            </button>
                          ) : (
                            <div className="flex min-h-11 items-center gap-3 px-4 py-2">{body}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </section>
            );
          })}
        </div>
      )}
      {(q.data?.notes.length ?? 0) > 0 && <p className="selectable mt-3 text-xs text-faint">Not shown: {q.data!.notes.join(" ")}</p>}
    </>
  );
}
