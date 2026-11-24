// What the synced MY Epitech data says: projects and hand-in dates, the local repository
// each one matches, the latest automated test results, credits and validations.
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FolderGit2 } from "lucide-react";
import { useState } from "react";
import { Button, cn, Dot, ErrorNote, Spinner, Tag } from "../../components/ui";
import { Countdown } from "../projects/RepoBits";
import { api, asAppError, type MyProject } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { daysLeft, deadlineLabel } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { locale, t as tr } from "../../lib/i18n";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export function MyProjects() {
  const o = useQuery({ queryKey: ["my-overview"], queryFn: api.myOverview, staleTime: 0 });
  const [showPast, setShowPast] = useState(false);
  if (o.isLoading) return <p className="flex items-center gap-2 px-4 py-8 text-[13px] text-muted"><Spinner /> {tr("Lecture des données synchronisées…")}</p>;
  if (o.error || !o.data) return <div className="p-4"><ErrorNote>{asAppError(o.error).message}</ErrorNote></div>;
  const all = o.data.projects;
  const ongoing = all.filter((p) => p.ongoing || p.upcoming);
  const past = all.filter((p) => !p.ongoing && !p.upcoming);
  // Dates reach the repositories by themselves; what is left here are the ones you typed differently.
  const typed = all.filter((p) => p.repoPath && p.deadline && p.repoDeadlineSource === "manual" && p.repoDeadline !== p.deadline);
  if (all.length === 0) return <p className="px-4 py-6 text-[13px] text-muted">{tr("Aucun projet dans les données synchronisées. Connecte-toi puis clique sur « Synchroniser ».")}</p>;
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-2.5 text-xs text-muted">
        <span className="mr-auto">{all.filter((p) => p.ongoing).length} ongoing · {all.filter((p) => p.upcoming).length} to come · {past.length} finished{o.data.syncedAt ? ` · synced ${timeAgo(o.data.syncedAt)}` : ""}</span>
        {typed.length > 0 && <span className="text-warn" title={typed.map((p) => `${p.name}: you typed ${p.repoDeadline}, MY Epitech says ${p.deadline}`).join("\n")}>{typed.length} date{typed.length > 1 ? "s" : ""} typed by you differ{typed.length > 1 ? "" : "s"}</span>}
      </div>
      <ul>{ongoing.map((p) => <ProjectRow key={p.id} p={p} />)}</ul>
      {past.length > 0 && (
        <>
          <button type="button" onClick={() => setShowPast(!showPast)} className="flex h-9 w-full items-center gap-2 border-t border-white/6 px-4 text-left text-xs text-muted hover:text-fg">
            {showPast ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} {past.length} finished project{past.length > 1 ? "s" : ""}
          </button>
          {showPast && <ul>{past.map((p) => <ProjectRow key={p.id} p={p} />)}</ul>}
        </>
      )}
    </div>
  );
}

function ProjectRow({ p }: { p: MyProject }) {
  const [open, setOpen] = useState(false);
  const openSheet = useUi((s) => s.openSheet);
  const left = p.deadline ? daysLeft(p.deadline) : null;
  const t = p.lastTest;
  const upcoming = p.activities.filter((a) => a.end && new Date(a.end).getTime() > Date.now());
  return (
    <li className="border-b border-white/6 last:border-b-0">
      <div className="flex min-h-12 items-center gap-4 px-4 py-2">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          {open ? <ChevronDown className="size-3.5 shrink-0 text-faint" /> : <ChevronRight className="size-3.5 shrink-0 text-faint" />}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium">{p.name}</span>
              <Tag>{p.unitCode}</Tag>
            </span>
            <span className="block truncate text-xs text-muted">Hand-in {day(p.end)}</span>
          </span>
        </button>
        {t && t.total !== null && (
          <Dot mono tone={t.passed === t.total ? "ok" : (t.passed ?? 0) === 0 ? "danger" : "warn"} title={`Latest automated test run${t.date ? `, ${new Date(t.date).toLocaleString()}` : ""}`}>
            {t.passed}/{t.total} tests
          </Dot>
        )}
        <span className="flex w-24 shrink-0 justify-end">{p.ongoing && left !== null && <Countdown tone={left < 0 ? "danger" : left <= 2 ? "warn" : "neutral"}>{deadlineLabel(left)}</Countdown>}</span>
        {p.repoPath ? (
          <span className="flex w-32 shrink-0 justify-end">
            <Button size="sm" variant="ghost" icon={<FolderGit2 className="size-3.5" />} title={`Matched by ${p.matchedBy}: ${p.repoPath}`} onClick={() => openSheet(p.repoPath!)}>{tr("Fiche du projet")}</Button>
          </span>
        ) : (
          <span className="w-32 shrink-0 text-right text-xs text-faint" title={tr("Aucun dépôt local ne correspond à coup sûr à ce projet (aucun clone, ou plusieurs copies).")}>{tr("pas de dépôt local")}</span>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-2 px-4 pb-3 pl-[42px] text-xs">
          {p.unitName && <p className="text-muted">{p.unitName}{p.groupMax !== null && ` · ${p.groupMax === 1 ? "solo" : `groups of up to ${p.groupMax}`}`}{p.url && <span className="selectable ml-2 font-mono text-[11px] text-faint">{p.url}</span>}</p>}
          {p.repoPath && <p className="text-muted">{tr("Rendu dans TekBoard :")} <span className={p.repoDeadline === p.deadline ? "text-ok" : "text-warn"}>{p.repoDeadline ?? "none"}</span>{p.repoDeadlineSource === "manual" ? " (typed by you" : p.repoDeadlineSource === "my" ? " (from MY Epitech" : " ("}{p.repoDeadline !== p.deadline && p.deadline ? `${p.repoDeadlineSource ? ", " : ""}MY Epitech says ${p.deadline})` : ")"}</p>}
          {p.group.length > 1 && <p className="selectable text-muted">Group{p.groupName ? ` “${p.groupName}”` : ""}: {p.group.join(", ")}</p>}
          {t && (
            <div className="rounded-lg border border-line bg-bg px-3 py-2">
              <p className="text-fg">Latest automated tests: {t.passed ?? "?"}/{t.total ?? "?"} passed <span className="text-muted">· {t.runs} run{t.runs > 1 ? "s" : ""}{t.date && ` · ${timeAgo(t.date)}`}{t.commit && <> · commit <span className="selectable font-mono">{t.commit.slice(0, 7)}</span></>}</span></p>
              <p className="text-muted">Coding style: {t.styleFatal} fatal, {t.styleMajor} major, {t.styleMinor} minor, {t.styleInfo} info{t.flags.length > 0 && <span className="text-danger"> · {t.flags.join(", ")}</span>}</p>
              {t.failingSkills.length > 0 && <p className="selectable mt-1 leading-relaxed text-muted">Not fully passed: {t.failingSkills.map(([n, a, b]) => `${n} (${a}/${b})`).join(" · ")}</p>}
            </div>
          )}
          {p.activities.length > 0 && (
            <ul>
              {(upcoming.length > 0 ? upcoming : p.activities).map((a) => (
                <li key={`${a.name}${a.start}`} className="flex items-baseline gap-2 py-0.5">
                  <span className="w-40 shrink-0 text-muted">{day(a.start)}</span>
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  {a.mandatory && <Dot tone="warn">mandatory</Dot>}
                  {a.status && <span className="text-faint">{a.status}</span>}
                </li>
              ))}
            </ul>
          )}
          {!t && p.activities.length === 0 && <p className="text-faint">{tr("Les détails ne sont synchronisés que pour les projets en cours.")}</p>}
        </div>
      )}
    </li>
  );
}

export function MyProgress() {
  const o = useQuery({ queryKey: ["my-overview"], queryFn: api.myOverview, staleTime: 0 });
  if (!o.data) return o.isLoading ? <p className="px-4 py-6 text-muted"><Spinner /></p> : null;
  const d = o.data;
  if (d.creditsAcquired === null && d.blocks.length === 0 && d.exams.length === 0) return <p className="px-4 py-6 text-[13px] text-muted">{tr("Aucune donnée de validation dans les réponses synchronisées.")}</p>;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-2">
        {d.creditsAcquired !== null && <Tile label={tr("Crédits acquis")} value={d.creditsAcquired} />}
        {d.creditsTotal !== null && d.creditsTotal !== d.creditsAcquired && <Tile label={tr("Avec les crédits antérieurs")} value={d.creditsTotal} />}
        {d.exams.map((e) => <Tile key={e.label} label={e.label} value={e.best ?? "—"} hint={e.required !== null ? `required ${e.required}${e.max !== null ? ` / ${e.max}` : ""}` : undefined} tone={e.best !== null && e.required !== null ? (e.best >= e.required ? "ok" : "warn") : undefined} />)}
      </div>
      {d.blocks.length > 0 && (
        <ul className="rounded-lg border border-line bg-bg py-1">
          {d.blocks.map((b) => (
            <li key={b.title} className="flex min-h-8 items-center gap-2.5 px-3 text-[13px]">
              <span className="min-w-0 flex-1 truncate">{b.title}</span>
              <span className="text-xs text-muted">{b.validated}/{b.total} outcomes</span>
              {b.credits !== null && <span className="w-16 text-right text-xs text-faint">{b.credits} credit{b.credits === 1 ? "" : "s"}</span>}
              {b.grade && <span className={cn("w-20 shrink-0 text-right text-xs", b.grade === "in progress" ? "text-faint" : "text-fg")}>{b.grade}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-faint">{tr("D'après MY Epitech à la dernière synchronisation, pour le semestre en cours.")}</p>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: "ok" | "warn" }) {
  return (
    <div className="min-w-28 rounded-lg border border-line bg-bg px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("display mt-1 text-xl font-medium", tone === "ok" && "text-ok", tone === "warn" && "text-warn")}>{value}</p>
      {hint && <p className="text-[11px] text-faint">{hint}</p>}
    </div>
  );
}
