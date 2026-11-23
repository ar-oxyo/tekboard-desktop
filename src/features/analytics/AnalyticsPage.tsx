// Developer analytics from local git history. Commits and lines are counted;
// neither is a measure of time spent or of quality, and the page says so.
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Card, CardTitle, EmptyState, ErrorNote, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type Analytics, type DayCount, type RepoStat } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useSettings } from "../../lib/hooks";
import { AcademicSection } from "./Academic";

// Chart colours, validated for the dark surface (lightness band, CVD separation, contrast).
const YOU = "#7c6ef2";
const OTHERS = "#2fa594";
// One hue, more = brighter on a dark surface. Step 0 is "no commit".
const HEAT = ["#1d212a", "#3a3373", "#5549b3", "#7c6ef2", "#b6adff"];

export function AnalyticsPage() {
  const settings = useSettings();
  const hasRoots = (settings.data?.roots.length ?? 0) > 0;
  const q = useQuery({ queryKey: ["analytics"], queryFn: api.analytics, enabled: hasRoots, staleTime: 5 * 60_000 });

  return (
    <>
      <PageHeader title="Stats" subtitle="Calculé à partir de l'historique git de tes dépôts locaux." />
      {!hasRoots ? (
        <Card>
          <EmptyState title="Pas encore de dossier de projets">Ajoutes-en un dans Réglages pour voir ton activité.</EmptyState>
        </Card>
      ) : q.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted">
          <Spinner /> Lecture de l'historique git…
        </p>
      ) : q.error || !q.data ? (
        <ErrorNote>{asAppError(q.error).message}</ErrorNote>
      ) : q.data.totalCommits === 0 ? (
        <Card>
          <EmptyState title="Aucun commit trouvé">Tes dépôts n'ont pas encore d'historique.</EmptyState>
        </Card>
      ) : (
        <Body a={q.data} />
      )}
    </>
  );
}

function Body({ a }: { a: Analytics }) {
  const topRepo = a.repos.find((r) => r.mine > 0);
  const topLang = a.languages[0];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Tes commits" value={a.myCommits.toLocaleString()} note={`${a.repos.filter((r) => r.mine > 0).length} repositories`} />
        <Stat label="Jours actifs" value={String(a.activeDays)} note="in the last 53 weeks" />
        <Stat label="Série en cours" value={`${a.currentStreak} day${a.currentStreak === 1 ? "" : "s"}`} note={`longest: ${a.longestStreak}`} />
        <Stat label="Dernier commit" value={a.lastCommit ? timeAgo(a.lastCommit) : "—"} note={topRepo ? `most active: ${topRepo.name}` : undefined} />
      </div>

      <Card>
        <CardTitle right={<HeatLegend />}>Tes commits par jour</CardTitle>
        <div className="overflow-x-auto px-4 py-4">
          <Heatmap days={a.days} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Tes commits par mois</CardTitle>
          <div className="px-4 pt-4 pb-3">
            <Columns data={a.monthly.map((m) => ({ key: m.date, label: monthLabel(m.date), value: m.count, tip: `${monthLabel(m.date, true)}: ${m.count} commit${m.count === 1 ? "" : "s"}` }))} everyLabel={1} />
          </div>
        </Card>
        <Card>
          <CardTitle>Quand tu commites</CardTitle>
          <div className="px-4 pt-4 pb-3">
            <Columns data={a.byHour.map((v, h) => ({ key: String(h), label: `${h}h`, value: v, tip: `${h}:00–${h}:59: ${v} commit${v === 1 ? "" : "s"}` }))} everyLabel={3} />
            <p className="mt-2 text-xs text-faint">Heure de chaque commit. Dit quand tu commites, pas combien de temps tu as travaillé.</p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle
            right={
              <span className="flex items-center gap-3 text-xs text-muted">
                <Key color={YOU} label="Toi" />
                <Key color={OTHERS} label="Les autres" />
              </span>
            }
          >
            Commits par projet
          </CardTitle>
          <RepoBars repos={a.repos} />
          <p className="border-t border-white/6 px-4 py-2.5 text-xs text-faint">
            {a.soloRepos} solo · {a.sharedRepos} shared. A commit count compares volume, not the value of each contribution.
          </p>
        </Card>
        <Card className="self-start">
          <CardTitle>Langages</CardTitle>
          <Languages a={a} />
          <p className="border-t border-white/6 px-4 py-2.5 text-xs text-faint">
            Lines in tracked files of repositories you committed to{topLang ? "" : " (none found)"}. A line of code is not a unit of productivity.
          </p>
        </Card>
      </div>

      <AcademicSection />

      <p className="selectable text-xs text-faint">
        “You” = commits authored as {a.myEmails.length > 0 ? a.myEmails.join(", ") : "nobody: git user.email is not set"}. {a.totalCommits.toLocaleString()} commits read in total, merges excluded, each commit counted once even when cloned twice.
      </p>
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="px-4 py-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="display number-gradient mt-1 text-[30px] leading-tight font-medium">{value}</p>
      {note && <p className="mt-0.5 truncate text-xs text-faint">{note}</p>}
    </Card>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function monthLabel(ym: string, long = false): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", long ? { month: "long", year: "numeric" } : { month: "short" });
}

/** Tooltip that follows the hovered mark. Shared by every chart on the page. */
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const show = (e: React.MouseEvent, text: string) => {
    const host = (e.currentTarget as Element).closest("[data-chart]")?.getBoundingClientRect();
    const r = (e.currentTarget as Element).getBoundingClientRect();
    if (host) setTip({ x: r.left + r.width / 2 - host.left, y: r.top - host.top, text });
  };
  const node: ReactNode = tip && (
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line-strong bg-raised px-2 py-1 text-xs whitespace-nowrap text-fg shadow-(--shadow-pop)" style={{ left: tip.x, top: tip.y - 6 }}>
      {tip.text}
    </div>
  );
  return { show, hide: () => setTip(null), node };
}

function heatStep(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 4) return Math.min(4, count);
  return Math.min(4, 1 + Math.floor(((count - 1) / max) * 4));
}

function HeatLegend() {
  return (
    <span className="flex items-center gap-1 text-[11px] text-faint">
      fewer
      {HEAT.map((c) => (
        <span key={c} className="size-2.5 rounded-[3px]" style={{ background: c }} />
      ))}
      more
    </span>
  );
}

function Heatmap({ days }: { days: DayCount[] }) {
  const tip = useTip();
  const { weeks, max, months } = useMemo(() => {
    const max = Math.max(1, ...days.map((d) => d.count));
    // Columns are weeks starting on Monday; the first column is padded.
    const first = new Date(days[0].date + "T00:00:00");
    const pad = (first.getDay() + 6) % 7;
    const cells: Array<DayCount | null> = [...Array<null>(pad).fill(null), ...days];
    const weeks: Array<Array<DayCount | null>> = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    const months: Array<{ col: number; label: string }> = [];
    let last = -1;
    weeks.forEach((w, col) => {
      const d = w.find((x) => x !== null);
      if (!d) return;
      const m = Number(d.date.slice(5, 7));
      if (m !== last && Number(w.find((x) => x !== null && Number(x.date.slice(8, 10)) <= 7)?.date.slice(5, 7) ?? -1) === m) {
        months.push({ col, label: monthLabel(d.date.slice(0, 7)) });
        last = m;
      }
    });
    return { weeks, max, months };
  }, [days]);

  const size = 12;
  const gap = 3;
  const left = 26;
  const top = 16;
  const width = left + weeks.length * (size + gap);
  const height = top + 7 * (size + gap);
  return (
    <div data-chart className="relative" style={{ width }}>
      <svg width={width} height={height} role="img" aria-label="Commits par jour sur les 53 dernières semaines">
        {months.map((m) => (
          <text key={m.col} x={left + m.col * (size + gap)} y={10} className="fill-(--color-faint) text-[10px]">
            {m.label}
          </text>
        ))}
        {["Mon", "Wed", "Fri"].map((d, i) => (
          <text key={d} x={0} y={top + (i * 2) * (size + gap) + 10} className="fill-(--color-faint) text-[10px]">
            {d}
          </text>
        ))}
        {weeks.map((week, col) =>
          week.map((d, row) =>
            d === null ? null : (
              <rect
                key={d.date}
                x={left + col * (size + gap)}
                y={top + row * (size + gap)}
                width={size}
                height={size}
                rx={3}
                fill={HEAT[heatStep(d.count, max)]}
                onMouseEnter={(e) => tip.show(e, `${new Date(d.date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}: ${d.count} commit${d.count === 1 ? "" : "s"}`)}
                onMouseLeave={tip.hide}
              />
            ),
          ),
        )}
      </svg>
      {tip.node}
    </div>
  );
}

export function Columns({ data, everyLabel }: { data: Array<{ key: string; label: string; value: number; tip: string }>; everyLabel: number }) {
  const tip = useTip();
  const max = Math.max(1, ...data.map((d) => d.value));
  const H = 120;
  return (
    <div data-chart className="relative">
      <div className="flex items-end gap-[2px]" style={{ height: H }} role="img" aria-label={data.map((d) => d.tip).join("; ")}>
        {data.map((d) => (
          // The whole column is the hover target, not just the bar.
          <div key={d.key} className="group flex h-full min-w-0 flex-1 items-end" onMouseEnter={(e) => tip.show(e, d.tip)} onMouseLeave={tip.hide}>
            <div className="w-full rounded-t-[4px] transition-opacity group-hover:opacity-80" style={{ height: d.value === 0 ? 1 : Math.max(3, (d.value / max) * H), background: d.value === 0 ? "var(--color-line)" : YOU }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px] border-t border-white/6 pt-1">
        {data.map((d, i) => (
          <span key={d.key} className="min-w-0 flex-1 text-center text-[10px] text-faint">
            {i % everyLabel === 0 ? d.label : ""}
          </span>
        ))}
      </div>
      <span className="absolute top-0 right-0 text-[10px] text-faint">max {max}</span>
      {tip.node}
    </div>
  );
}

function RepoBars({ repos }: { repos: RepoStat[] }) {
  const tip = useTip();
  const shown = repos.slice(0, 12);
  const max = Math.max(1, ...shown.map((r) => r.mine + r.others));
  return (
    <div data-chart className="relative">
      <ul className="py-2">
        {shown.map((r) => {
          const people = r.contributors.slice(0, 5).map((c) => `${c.name}${c.me ? " (you)" : ""}: ${c.commits}`).join(" · ");
          return (
            <li key={r.path} className="flex h-8 items-center gap-3 px-4" onMouseEnter={(e) => tip.show(e, people)} onMouseLeave={tip.hide}>
              <span className="w-36 shrink-0 truncate text-[13px]">{r.name}</span>
              <span className="flex h-3 min-w-0 flex-1 items-center gap-[2px]">
                {r.mine > 0 && <span className="h-full rounded-[4px]" style={{ width: `${(r.mine / max) * 100}%`, background: YOU, minWidth: 3 }} />}
                {r.others > 0 && <span className="h-full rounded-[4px]" style={{ width: `${(r.others / max) * 100}%`, background: OTHERS, minWidth: 3 }} />}
              </span>
              <span className="w-20 shrink-0 text-right text-xs text-muted">
                {r.mine}
                {r.others > 0 && <span className="text-faint"> + {r.others}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {repos.length > shown.length && <p className="px-4 pb-2 text-xs text-faint">{repos.length - shown.length} more repositories not shown.</p>}
      {tip.node}
    </div>
  );
}

function Languages({ a }: { a: Analytics }) {
  const total = a.languages.reduce((n, l) => n + l.lines, 0);
  const shown = a.languages.slice(0, 8);
  const max = Math.max(1, ...shown.map((l) => l.lines));
  if (shown.length === 0) return <p className="px-4 py-4 text-[13px] text-muted">Aucun fichier source reconnu.</p>;
  return (
    <ul className="py-2">
      {shown.map((l) => (
        <li key={l.name} className="flex h-8 items-center gap-3 px-4" title={`${l.files} file${l.files === 1 ? "" : "s"}`}>
          <span className="w-24 shrink-0 truncate text-[13px]">{l.name}</span>
          <span className="flex h-3 min-w-0 flex-1 items-center">
            <span className="h-full rounded-[4px]" style={{ width: `${(l.lines / max) * 100}%`, background: YOU, minWidth: 3 }} />
          </span>
          <span className="w-28 shrink-0 text-right text-xs text-muted">
            {l.lines.toLocaleString()} <span className="text-faint">· {Math.round((l.lines / total) * 100)}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
