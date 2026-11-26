// Skill Tree: academic progression drawn as a galaxy (blocks are constellations, units stars,
// skills and projects their satellites), navigated level by level: galaxy, constellation, star;
// from MY Epitech's own data (cached at the last sync, so it opens offline). The only thing
// TekBoard deduces, the domain of a unit, is labelled as an estimate everywhere it appears.
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, GraduationCap, Maximize, Minus, Orbit, Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Select } from "../../components/Select";
import { Badge, Button, Card, CardTitle, cn, EmptyState, ErrorNote, IconButton, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type SkillNode, type SkillStatus, type SkillTree } from "../../lib/api";
import { locale, t } from "../../lib/i18n";
import { between, fitBox, galaxy, neighbours, NO_FILTER, starView, systemBox, visible, wheelAction, zoomAt, type Filters, type GalaxyLayout, type View } from "../../lib/skilltree";
import { useUi } from "../../lib/store";
import { Stat } from "../analytics/AnalyticsPage";
import { useMySync } from "../myepitech/useMySync";

const STATUS: Record<SkillStatus, { label: string; color: string }> = {
  acquired: { label: t("Acquis"), color: "var(--color-ok)" },
  in_progress: { label: t("En cours d'acquisition"), color: "var(--color-accent)" },
  available: { label: t("À acquérir"), color: "var(--color-muted)" },
  failed: { label: t("Non validé"), color: "var(--color-danger)" },
  locked: { label: t("Pas encore ouvert"), color: "var(--color-faint)" },
};

/** A thin bar in a data colour; `under` draws a lighter share behind the value (secured credits). */
function Meter({ value, total, under = 0, color = "var(--color-accent)" }: { value: number; total: number; under?: number; color?: string }) {
  const pct = (n: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);
  return (
    <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-ink/8" role="img" aria-label={under > 0 ? `${value} / ${total} · ${under}` : `${value} / ${total}`}>
      {under > 0 && <span className="absolute inset-y-0 left-0 rounded-full opacity-40 transition-[width] duration-700" style={{ width: `${pct(under)}%`, background: color }} />}
      <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700" style={{ width: `${pct(value)}%`, background: color }} />
    </span>
  );
}

const day = (ts: number) => new Date(ts * 1000).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });

export function SkillTreePage() {
  const q = useQuery({ queryKey: ["my", "skill-tree"], queryFn: api.mySkillTree, staleTime: 60_000 });
  const sync = useMySync();
  const setPage = useUi((s) => s.setPage);
  const tree = q.data;
  const syncButton = (
    <Button icon={<RefreshCw className={cn("size-3.5", sync.busy && "anim-spin")} />} disabled={sync.busy} onClick={() => void sync.sync().then(() => q.refetch())}>
      {sync.busy ? sync.label : t("Synchroniser")}
    </Button>
  );
  return (
    <>
      <PageHeader title="Skill Tree" subtitle={tree?.syncedAt ? t("Données MY Epitech du {d} · consultables hors ligne", { d: day(tree.syncedAt) }) : t("Ta progression à Epitech, d'après MY Epitech")} actions={syncButton} />
      {q.isLoading && <p className="flex items-center gap-2 py-12 text-muted"><Spinner /> {t("Chargement…")}</p>}
      {q.error && <ErrorNote>{asAppError(q.error).message}</ErrorNote>}
      {tree && tree.nodes.length === 0 && (
        <EmptyState icon={<GraduationCap className="size-6" />} title={t("Pas encore de données")} action={<Button variant="primary" onClick={() => setPage("myepitech")}>{t("Connecter MY Epitech")}</Button>}>
          {tree.notes[0] ?? t("Synchronise MY Epitech pour voir ton arbre de compétences.")}
        </EmptyState>
      )}
      {tree && tree.nodes.length > 0 && <TreeView tree={tree} />}
    </>
  );
}

type Focus = { level: "galaxy" } | { level: "system"; id: string } | { level: "star"; id: string; system: string };

function TreeView({ tree }: { tree: SkillTree }) {
  // The current semester first: the next one is a filter away.
  const [f, setF] = useState<Filters>({ ...NO_FILTER, semester: tree.semester });
  const [focus, setFocus] = useState<Focus>({ level: "galaxy" });
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const shown = useMemo(() => visible(tree, f), [tree, f]);
  const g = useMemo(() => galaxy(tree, shown), [tree, shown]);
  const byId = useMemo(() => new Map(tree.nodes.map((n) => [n.id, n])), [tree]);
  const lit = useMemo(() => (hover ?? selected ? neighbours(tree, (hover ?? selected)!) : null), [tree, hover, selected]);

  // A filter that hides what is being looked at brings the view back to the whole galaxy.
  useEffect(() => {
    if ((focus.level === "system" && !g.systems.some((s) => s.id === focus.id)) || (focus.level === "star" && !g.stars.has(focus.id))) {
      setFocus({ level: "galaxy" });
      setSelected(null);
    }
  }, [g]); // eslint-disable-line react-hooks/exhaustive-deps

  const toGalaxy = () => {
    setFocus({ level: "galaxy" });
    setSelected(null);
  };
  const toSystem = (id: string) => {
    setFocus({ level: "system", id });
    setSelected(null);
  };
  const toStar = (id: string, pick: string = id) => {
    const s = g.stars.get(id);
    if (!s) return;
    setFocus({ level: "star", id, system: s.system });
    setSelected(pick);
  };
  /** Opens a node from a list: a unit or a skill brings its star close, a project is shown. */
  const open = (id: string) => {
    const n = byId.get(id);
    if (n?.kind === "unit" && g.stars.has(id)) toStar(id);
    else if (n?.kind === "skill" && n.parent && g.stars.has(n.parent)) toStar(n.parent, id);
    else setSelected(id);
  };
  const up = () => (focus.level === "star" ? toSystem(focus.system) : toGalaxy());
  const step = (d: 1 | -1) => {
    if (focus.level === "star") {
      const units = g.systems.find((s) => s.id === focus.system)?.units ?? [];
      const i = units.indexOf(focus.id);
      if (units.length) toStar(units[(i + d + units.length) % units.length]);
    } else if (g.systems.length) {
      const i = focus.level === "system" ? g.systems.findIndex((s) => s.id === focus.id) : d > 0 ? -1 : 0;
      toSystem(g.systems[(i + d + g.systems.length) % g.systems.length].id);
    }
  };
  const deeper = () => {
    if (focus.level === "galaxy" && g.systems[0]) toSystem(g.systems[0].id);
    else if (focus.level === "system") {
      const first = g.systems.find((s) => s.id === focus.id)?.units[0];
      if (first) toStar(first);
    }
  };

  const units = tree.nodes.filter((n) => n.kind === "unit");
  const current = units.filter((u) => !u.upcoming);
  const skills = tree.nodes.filter((n) => n.kind === "skill" && !n.upcoming);
  const projects = tree.nodes.filter((n) => n.kind === "project");
  const years = [...new Set(tree.nodes.map((n) => n.schoolYear).filter((y): y is number => y !== null))].sort();
  const semesters = [...new Set(units.map((u) => u.semester).filter((s): s is number => s !== null))].sort();
  const domains = [...new Set(tree.nodes.map((n) => n.domain).filter((d): d is string => !!d))].sort();
  const c = tree.credits;
  const remaining = current.filter((u) => u.status !== "acquired");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card className="px-4 py-4 md:col-span-2">
          <p className="text-xs text-muted">{t("Crédits")}</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 leading-tight">
            <span className="display text-2xl font-medium tabular-nums">{c.acquired ?? "—"}</span>
            <span className="text-sm text-muted">{t("obtenus")}</span>
            {c.secure !== null && (
              <>
                <span className="text-faint">·</span>
                <span className="display text-2xl font-medium tabular-nums text-ok">{c.secure}</span>
                <span className="text-sm text-muted">{t("assurés")}</span>
              </>
            )}
            {c.threshold !== null && <span className="text-lg text-muted tabular-nums">/ {c.threshold}</span>}
          </p>
          <div className="mt-2"><Meter value={c.acquired ?? 0} under={c.secure ?? 0} total={Math.max(c.threshold ?? 0, c.secure ?? 0)} color="var(--color-ok)" /></div>
          <p className="mt-1.5 text-xs text-faint">
            {t("MY Epitech attribue les crédits en fin de semestre ; « assurés » : déjà garantis par tes validations.")}
            {c.threshold !== null && ` ${t("Seuil : {n}.", { n: c.threshold })}`}
            {c.lost > 0 && <span className="text-danger"> {t("{n} perdus", { n: c.lost })}</span>}
          </p>
        </Card>
        <Stat label={t("Unités acquises (semestre)")} value={`${current.filter((u) => u.status === "acquired").length} / ${current.length}`} note={t("{n} en cours", { n: current.filter((u) => u.status === "in_progress").length })} />
        <Stat label={t("Compétences acquises")} value={skills.length ? `${Math.round((skills.filter((s) => s.status === "acquired").length / skills.length) * 100)} %` : "—"} note={t("{a} sur {n} acquis d'apprentissage", { a: skills.filter((s) => s.status === "acquired").length, n: skills.length })} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <Select size="sm" className="w-36" label={t("Année")} value={f.year === null ? "" : String(f.year)} onChange={(v) => setF({ ...f, year: v ? Number(v) : null })} options={[{ value: "", label: t("Toutes les années") }, ...years.map((y) => ({ value: String(y), label: `${y}–${y + 1}` }))]} />
          <Select size="sm" className="w-44" label={t("Semestre")} value={f.semester === null ? "" : String(f.semester)} onChange={(v) => setF({ ...f, semester: v ? Number(v) : null })} options={[{ value: "", label: t("Tous les semestres") }, ...semesters.map((s) => ({ value: String(s), label: t("Semestre {n}", { n: s }) + (s === tree.semester ? ` · ${t("actuel")}` : "") }))]} />
          <Select size="sm" className="w-48" label={t("Domaine (estimation)")} value={f.domain ?? ""} onChange={(v) => setF({ ...f, domain: v || null })} options={[{ value: "", label: t("Tous les domaines") }, ...domains.map((d) => ({ value: d, label: d, hint: t("estimation") }))]} />
          <Select size="sm" className="w-40" label={t("Statut")} value={f.status ?? ""} onChange={(v) => setF({ ...f, status: (v || null) as Filters["status"] })} options={[{ value: "", label: t("Tous les statuts") }, { value: "todo", label: t("À travailler") }, ...(Object.keys(STATUS) as SkillStatus[]).map((s) => ({ value: s, label: STATUS[s].label }))]} />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" className="accent-(--color-accent)" checked={f.locked} onChange={(e) => setF({ ...f, locked: e.target.checked })} />
            {t("Projets pas encore ouverts")}
          </label>
          {(f.year !== null || f.semester !== tree.semester || f.domain || f.status || f.locked) && <Button size="sm" variant="ghost" onClick={() => setF({ ...NO_FILTER, semester: tree.semester })}>{t("Réinitialiser")}</Button>}
        </div>
        <div className="grid grid-cols-1 @[56rem]:grid-cols-[15rem_minmax(0,1fr)]">
          <Navigator tree={tree} g={g} byId={byId} focus={focus} onGalaxy={toGalaxy} onSystem={toSystem} onStar={toStar} />
          <div className="relative min-w-0">
            <Canvas tree={tree} g={g} shown={shown} byId={byId} focus={focus} selected={selected} lit={lit} sheet={!!(selected && byId.get(selected))} onHover={setHover} onSystem={toSystem} onStar={toStar} onSelect={setSelected} onUp={up} onStep={step} onDeeper={deeper} onGalaxy={toGalaxy} />
            {selected && byId.get(selected) && <Sheet tree={tree} node={byId.get(selected)!} byId={byId} onClose={() => setSelected(null)} onOpen={open} />}
          </div>
        </div>
        <Legend />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle right={<span className="text-xs text-muted">{remaining.length}</span>}>{t("Unités restant à valider")}</CardTitle>
          <ul className="flex max-h-72 flex-col overflow-y-auto p-2">
            {remaining.length === 0 && <li className="p-2 text-sm text-muted">{t("Toutes les unités du semestre sont acquises.")}</li>}
            {remaining.map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => open(u.id)} className="ink-row flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS[u.status].color }} />
                  <span className="min-w-0 flex-1 truncate">{u.label}</span>
                  {u.validated !== null && u.total !== null && <span className="text-xs text-muted tabular-nums">{u.validated}/{u.total}</span>}
                  {u.credits !== null && <Badge>{t("{n} cr.", { n: u.credits })}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>{t("Progression")}</CardTitle>
          <div className="flex flex-col gap-3 p-4 text-sm">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1">
              <dt className="text-muted">{t("Semestres précédents")}</dt><dd className="tabular-nums">{c.prior ?? "—"} cr.</dd>
              <dt className="text-muted">{t("Ce semestre")}</dt><dd className="tabular-nums">{c.thisSemester ?? "—"} cr.</dd>
              <dt className="text-muted">{t("Projets validés")}</dt><dd className="tabular-nums">{projects.filter((p) => p.status === "acquired").length}</dd>
            </dl>
            <p className="text-2xs text-faint">{t("MY Epitech ne détaille pas les crédits de chaque semestre passé : seuls ces deux totaux sont affichés.")}</p>
            {tree.history.length > 0 ? (
              <>
                <p className="text-xs font-medium text-muted">{t("Derniers jalons datés")}</p>
                <ol className="flex flex-col gap-1.5 border-l border-line pl-3">
                  {tree.history.slice(-6).reverse().map((h, i) => (
                    <li key={`${h.at}-${i}`} className="relative text-xs">
                      <span className={cn("absolute top-1 -left-[15.5px] size-2 rounded-full", h.kind === "project" ? "bg-ok" : "bg-accent")} />
                      <span className="text-faint">{day(h.at)}</span> · {h.label}
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="text-xs text-faint">{t("Pas encore d'historique daté.")}</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** The constellations as a list: the same navigation as the map, without aiming. */
function Navigator({ tree, g, byId, focus, onGalaxy, onSystem, onStar }: { tree: SkillTree; g: GalaxyLayout; byId: Map<string, SkillNode>; focus: Focus; onGalaxy: () => void; onSystem: (id: string) => void; onStar: (id: string) => void }) {
  const open = focus.level === "system" ? focus.id : focus.level === "star" ? focus.system : null;
  return (
    <nav aria-label={t("Constellations")} className="flex max-h-64 flex-col gap-0.5 overflow-y-auto border-b border-line p-2 @[56rem]:h-[min(68vh,620px)] @[56rem]:max-h-none @[56rem]:border-r @[56rem]:border-b-0">
      <button type="button" aria-current={focus.level === "galaxy" ? "true" : undefined} onClick={onGalaxy} className={cn("ink-row flex items-center gap-2 px-2 py-1.5 text-left text-sm", focus.level === "galaxy" ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-fg")}>
        <Orbit className="size-3.5" /> {t("Toute la galaxie")}
      </button>
      {g.systems.map((sys) => {
        const b = tree.branches.find((x) => x.id === sys.id);
        const got = sys.units.filter((u) => byId.get(u)?.status === "acquired").length;
        const on = open === sys.id;
        return (
          <div key={sys.id}>
            <button type="button" aria-current={on && focus.level === "system" ? "true" : undefined} aria-expanded={on} onClick={() => onSystem(sys.id)} className={cn("ink-row flex w-full flex-col gap-1 px-2 py-1.5 text-left", on && "bg-accent-soft")}>
              <span className="flex w-full items-center gap-2 text-sm">
                <span className="size-2 shrink-0 rounded-full" style={{ background: sys.color ?? "var(--color-faint)" }} />
                <span className={cn("min-w-0 flex-1 truncate", on && "font-medium text-fg")}>{sys.name}</span>
                <span className="text-2xs text-muted tabular-nums" title={t("Unités acquises")}>{got}/{sys.units.length}</span>
              </span>
              {b && b.threshold !== null && b.threshold > 0 && (
                <span className="flex w-full items-center gap-2 pl-4" title={t("{s} crédits assurés · seuil {t}", { s: b.secure ?? 0, t: b.threshold })}>
                  <Meter value={b.secure ?? 0} total={b.threshold} color={sys.color ?? undefined} />
                  <span className="shrink-0 text-3xs text-faint tabular-nums">{b.secure ?? 0}/{b.threshold}</span>
                </span>
              )}
            </button>
            {on && (
              <ul className="my-1 ml-3 border-l border-line pl-1.5">
                {sys.units.map((u) => {
                  const n = byId.get(u)!;
                  const here = focus.level === "star" && focus.id === u;
                  return (
                    <li key={u}>
                      <button type="button" aria-current={here ? "true" : undefined} onClick={() => onStar(u)} className={cn("ink-row flex w-full items-center gap-2 px-1.5 py-1 text-left text-xs", here ? "font-medium text-accent-strong" : "text-muted hover:text-fg")}>
                        <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS[n.status].color }} />
                        <span className="min-w-0 flex-1 truncate">{n.label}</span>
                        {n.validated !== null && n.total ? <span className="text-3xs text-faint tabular-nums">{n.validated}/{n.total}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Progress ring: an arc of `pct` % around a mark of radius `r`. */
function Ring({ r, pct, color }: { r: number; pct: number; color: string }) {
  const c = 2 * Math.PI * r;
  return <circle r={r} fill="none" stroke={color} strokeWidth={2} strokeDasharray={`${(c * Math.max(0, Math.min(100, pct))) / 100} ${c}`} transform="rotate(-90)" strokeLinecap="round" />;
}

/** Text stays legible over lines and discs: an outline of the card's own paper. */
const HALO = { paintOrder: "stroke", stroke: "var(--color-surface)", strokeWidth: 4, strokeLinejoin: "round" } as const;

/** Where a satellite goes on a ring of radius `r` around (0, 0), and where its label anchors. */
function orbit(i: number, n: number, r: number) {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n);
  const cos = Math.cos(a);
  return { x: cos * r, y: Math.sin(a) * r, anchor: (Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end") as "middle" | "start" | "end", dx: Math.abs(cos) < 0.3 ? 0 : cos > 0 ? 12 : -12, dy: Math.abs(cos) < 0.3 ? (Math.sin(a) > 0 ? 20 : -12) : 4 };
}

/** A node's mark: filled when acquired, ringed with its progress, dashed when not open yet. */
function Mark({ n, r }: { n: SkillNode; r: number }) {
  const s = STATUS[n.status];
  const progress = n.kind === "unit" ? (n.total ? ((n.validated ?? 0) / n.total) * 100 : null) : n.levelPercent;
  if (n.kind === "project")
    return <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={1.5} transform="rotate(45)" fill={n.status === "acquired" ? s.color : "var(--color-surface)"} stroke={s.color} strokeWidth={1.5} strokeDasharray={n.status === "locked" ? "2 2" : undefined} />;
  return (
    <>
      {n.status === "in_progress" && progress !== null && <Ring r={r + 3.5} pct={progress} color={s.color} />}
      <circle r={r} fill={n.status === "acquired" ? s.color : "var(--color-surface)"} stroke={s.color} strokeWidth={n.kind === "unit" ? 2 : 1.5} strokeDasharray={n.status === "locked" ? "3 3" : undefined} />
    </>
  );
}

const SHEET = 340;

function Canvas(p: { tree: SkillTree; g: GalaxyLayout; shown: Set<string>; byId: Map<string, SkillNode>; focus: Focus; selected: string | null; lit: Set<string> | null; sheet: boolean; onHover: (id: string | null) => void; onSystem: (id: string) => void; onStar: (id: string, pick?: string) => void; onSelect: (id: string | null) => void; onUp: () => void; onStep: (d: 1 | -1) => void; onDeeper: () => void; onGalaxy: () => void }) {
  const { tree, g, shown, byId, focus, selected, lit } = p;
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [reframe, setReframe] = useState(0);
  const live = useRef(view);
  live.current = view;
  const anim = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const shownSize = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stop = () => {
    if (anim.current) cancelAnimationFrame(anim.current);
    anim.current = null;
  };
  /** Glides to a view (instant with reduced motion, on first display and on resize). */
  const glide = (to: View, smooth: boolean) => {
    stop();
    const still = document.documentElement.dataset.motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!smooth || still) return setView(to);
    const from = live.current;
    const t0 = performance.now();
    const tick = (now: number) => {
      const q = Math.min(1, (now - t0) / 420);
      setView(between(from, to, 1 - Math.pow(1 - q, 3), size.w, size.h));
      anim.current = q < 1 ? requestAnimationFrame(tick) : null;
    };
    anim.current = requestAnimationFrame(tick);
  };
  // The camera follows the level: the whole galaxy, a constellation, or one star (beside the sheet).
  useEffect(() => {
    if (size.w === 0) return;
    const fresh = shownSize.current.w === 0;
    const resized = !fresh && (shownSize.current.w !== size.w || shownSize.current.h !== size.h);
    shownSize.current = size;
    const side = p.sheet && size.w > SHEET * 2 ? SHEET : 0;
    let to: View;
    if (focus.level === "star") to = starView(g, focus.id, (size.w - side) / 2, size.h / 2);
    else if (focus.level === "system") {
      const sys = g.systems.find((s) => s.id === focus.id);
      to = sys ? fitBox(systemBox(sys), size.w - side, size.h, 40, 3) : fitBox(g.bounds, size.w, size.h);
    } else to = fitBox(g.bounds, size.w, size.h, 36, 1.2);
    glide(to, !fresh && !resized);
  }, [focus, g, size.w, size.h, p.sheet, reframe]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => stop, []);

  // Native, non-passive: a pinch or a sideways swipe stays in the map; a plain wheel scrolls the page.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const on = (e: WheelEvent) => {
      const a = wheelAction(e);
      if (a.kind === "none") return;
      e.preventDefault();
      stop();
      const r = el.getBoundingClientRect();
      setView((v) => (a.kind === "zoom" ? zoomAt(v, a.factor, e.clientX - r.left, e.clientY - r.top) : { ...v, x: v.x + a.dx, y: v.y + a.dy }));
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, []);

  const zoom = (f: number) => {
    stop();
    setView((v) => zoomAt(v, f, size.w / 2, size.h / 2));
  };
  function key(e: React.KeyboardEvent) {
    const k = e.key;
    if (k === "Escape" || k === "ArrowUp" || k === "Backspace") p.onUp();
    else if (k === "ArrowRight") p.onStep(1);
    else if (k === "ArrowLeft") p.onStep(-1);
    else if (k === "Enter" || k === "ArrowDown") p.onDeeper();
    else if (k === "+" || k === "=") zoom(1.25);
    else if (k === "-") zoom(0.8);
    else if (k === "0" || k.toLowerCase() === "f") setReframe((n) => n + 1);
    else return;
    e.preventDefault();
  }
  function down(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    stop();
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  }
  function move(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    // Captured only once it is a drag: capturing on press would steal the click from the stars.
    if (!d.moved) svg.current?.setPointerCapture?.(e.pointerId);
    d.moved = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  }
  /** A click that was not the end of a drag. */
  const click = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!drag.current?.moved) fn();
  };

  const at = (q: { x: number; y: number }) => ({ x: q.x * view.k + view.x, y: q.y * view.k + view.y });
  const sysOf = focus.level === "system" ? focus.id : focus.level === "star" ? focus.system : null;
  const star = focus.level === "star" ? focus.id : null;
  const core = at({ x: 0, y: 0 });
  const c = tree.credits;

  // Close to a star: its skills on an inner ring, the projects that train them on an outer one.
  const near = star ? byId.get(star) : null;
  const sats = near ? tree.nodes.filter((n) => n.kind === "skill" && n.parent === near.id && shown.has(n.id)) : [];
  const satIds = new Set(sats.map((s) => s.id));
  const projectIds = near ? [...new Set(tree.links.filter((l) => l.kind === "project_skill" && satIds.has(l.target) && shown.has(l.source)).map((l) => l.source))] : [];
  const inner = Math.max(92, Math.min(130, sats.length * 14));
  const outer = inner + 78;
  const centre = near && g.stars.get(near.id) ? at(g.stars.get(near.id)!) : null;
  const satAt = new Map(sats.map((s, i) => [s.id, orbit(i, sats.length, inner)]));
  const projAt = new Map(projectIds.map((id, i) => [id, orbit(i, projectIds.length, outer)]));
  const projLabels = projectIds.length <= 10;

  const levelLabel = focus.level === "galaxy" ? t("Galaxie") : focus.level === "system" ? t("Constellation") : t("Unité");

  return (
    <div ref={box} className="relative h-[min(68vh,620px)] min-h-80 overflow-hidden">
      <svg
        ref={svg}
        width={size.w}
        height={size.h}
        tabIndex={0}
        className="block cursor-grab touch-none select-none outline-none active:cursor-grabbing"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
        onClick={() => !drag.current?.moved && focus.level === "star" && p.onUp()}
        onKeyDown={key}
        role="application"
        aria-roledescription={t("carte des compétences")}
        aria-label={t("{l} · Échap pour revenir, flèches pour passer d'un élément à l'autre, Entrée pour entrer", { l: levelLabel })}
      >
        {/* Sky: fixed specks, then the arms from the core to each constellation. */}
        {g.dust.map((d, i) => {
          const q = at(d);
          return q.x < -4 || q.y < -4 || q.x > size.w + 4 || q.y > size.h + 4 ? null : <circle key={i} cx={q.x} cy={q.y} r={0.6 + d.s} fill="var(--color-ink)" fillOpacity={0.08 + d.s * 0.12} />;
        })}
        {g.systems.map((sys) => {
          const q = at(sys);
          return <line key={`arm-${sys.id}`} x1={core.x} y1={core.y} x2={q.x} y2={q.y} stroke="var(--color-ink)" strokeOpacity={0.07} strokeDasharray="2 6" />;
        })}
        <g transform={`translate(${core.x},${core.y})`} opacity={focus.level === "galaxy" ? 1 : 0.5}>
          <circle r={44} fill="var(--color-surface)" stroke="var(--color-accent)" strokeOpacity={0.5} strokeWidth={1.5} />
          <text textAnchor="middle" y={-2} className="fill-fg text-md font-medium tabular-nums">{c.secure ?? c.acquired ?? "—"}{c.threshold !== null ? <tspan className="fill-muted text-xs"> / {c.threshold}</tspan> : null}</text>
          <text textAnchor="middle" y={14} className="fill-muted text-3xs">{c.secure !== null ? t("crédits assurés") : t("crédits")}</text>
        </g>

        {g.systems.map((sys) => {
          const q = at(sys);
          const R = sys.r * view.k;
          const color = sys.color ?? "var(--color-faint)";
          const mine = sysOf === sys.id;
          const opacity = sysOf === null ? 1 : mine ? 1 : 0.28;
          const b = tree.branches.find((x) => x.id === sys.id);
          return (
            <g key={sys.id} opacity={opacity} className="transition-opacity duration-(--dur-base)">
              <circle cx={q.x} cy={q.y} r={R} fill={color} fillOpacity={mine ? 0.035 : 0.05} stroke={color} strokeOpacity={0.4} strokeDasharray="2 5" className={mine ? undefined : "cursor-pointer"} onClick={click(() => p.onSystem(sys.id))} />
              {sys.figure.map(([a, z]) => {
                const A = at(g.stars.get(a)!);
                const Z = at(g.stars.get(z)!);
                return <line key={`${a}-${z}`} x1={A.x} y1={A.y} x2={Z.x} y2={Z.y} stroke={color} strokeOpacity={star ? 0.18 : 0.45} strokeWidth={1.2} pointerEvents="none" />;
              })}
              {!mine && (
                <g pointerEvents="none">
                  <text x={q.x} y={q.y - R - 20} textAnchor="middle" className="fill-fg text-sm font-medium" style={HALO}>{clip(sys.name, 36)}</text>
                  <text x={q.x} y={q.y - R - 6} textAnchor="middle" className="fill-muted text-3xs tabular-nums" style={HALO}>
                    {t("{a}/{n} unités", { a: sys.units.filter((u) => byId.get(u)?.status === "acquired").length, n: sys.units.length })}
                    {b && b.threshold !== null && b.threshold > 0 ? ` · ${t("{s}/{t} cr. assurés", { s: b.secure ?? 0, t: b.threshold })}` : ""}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Stars: small from afar, labelled inside the constellation being looked at. */}
        {g.systems.flatMap((sys) =>
          sys.units.map((id) => {
            const n = byId.get(id)!;
            const s = g.stars.get(id)!;
            const q = at(s);
            if (q.x < -60 || q.y < -60 || q.x > size.w + 60 || q.y > size.h + 60) return null;
            const mine = sysOf === sys.id;
            const here = star === id;
            const hovered = lit?.has(id) && !star;
            const r = focus.level === "galaxy" ? s.r * 0.72 : here ? s.r + 3 : s.r;
            const label = (mine && !star) || here || hovered;
            const kids = mine && !star ? tree.nodes.filter((k) => k.parent === id && shown.has(k.id)) : [];
            return (
              <g
                key={id}
                transform={`translate(${q.x},${q.y})`}
                className="cursor-pointer"
                opacity={sysOf !== null && !mine ? 0.28 : star && !here ? 0.35 : n.status === "locked" ? 0.65 : 1}
                onPointerEnter={() => p.onHover(id)}
                onPointerLeave={() => p.onHover(null)}
                onClick={click(() => p.onStar(id))}
              >
                <circle r={r + 10} fill="transparent" />
                {here && <circle r={r + 8} fill="none" stroke="var(--color-fg)" strokeOpacity={0.5} strokeWidth={1.2} />}
                <Mark n={n} r={r} />
                {kids.map((k, i) => {
                  const o = orbit(i, kids.length, r + 9);
                  return <circle key={k.id} cx={o.x} cy={o.y} r={2} fill={STATUS[k.status].color} pointerEvents="none" />;
                })}
                {label && (
                  <g pointerEvents="none">
                    <text y={r + (kids.length ? 26 : 18)} textAnchor="middle" className={cn("fill-fg font-medium", here ? "text-sm" : "text-xs")} style={HALO}>{clip(n.label, here ? 44 : 28)}</text>
                    {(mine || here) && (
                      <text y={r + (kids.length ? 39 : 31) + (here ? 2 : 0)} textAnchor="middle" className="fill-muted text-3xs tabular-nums" style={HALO}>
                        {[n.validated !== null && n.total ? `${n.validated}/${n.total}` : null, n.credits !== null ? t("{n} cr.", { n: n.credits }) : null, STATUS[n.status].label].filter(Boolean).join(" · ")}
                      </text>
                    )}
                  </g>
                )}
              </g>
            );
          }),
        )}

        {/* Close to one star: its satellites. */}
        {near && centre && (
          <g transform={`translate(${centre.x},${centre.y})`}>
            <circle r={inner} fill="none" stroke="var(--color-ink)" strokeOpacity={0.1} strokeDasharray="2 5" pointerEvents="none" />
            {projectIds.length > 0 && <circle r={outer} fill="none" stroke="var(--color-ink)" strokeOpacity={0.07} strokeDasharray="1 6" pointerEvents="none" />}
            {tree.links
              .filter((l) => l.kind === "project_skill" && projAt.has(l.source) && satAt.has(l.target))
              .map((l) => {
                const on = lit !== null && lit.has(l.source) && lit.has(l.target);
                const a = projAt.get(l.source)!;
                const z = satAt.get(l.target)!;
                return <line key={`${l.source}~${l.target}`} x1={a.x} y1={a.y} x2={z.x} y2={z.y} stroke={on ? STATUS[byId.get(l.source)!.status].color : "var(--color-ink)"} strokeOpacity={on ? 0.8 : 0.08} strokeWidth={on ? 1.4 : 1} strokeDasharray={on ? "4 3" : undefined} pointerEvents="none" />;
              })}
            {sats.map((s) => {
              const o = satAt.get(s.id)!;
              const sel = selected === s.id;
              return (
                <g key={s.id}>
                  <line x1={0} y1={0} x2={o.x} y2={o.y} stroke={STATUS[s.status].color} strokeOpacity={0.25} pointerEvents="none" />
                  <g transform={`translate(${o.x},${o.y})`} className="cursor-pointer" onPointerEnter={() => p.onHover(s.id)} onPointerLeave={() => p.onHover(null)} onClick={click(() => p.onSelect(s.id))}>
                    <circle r={14} fill="transparent" />
                    {sel && <circle r={11} fill="none" stroke="var(--color-fg)" strokeOpacity={0.55} strokeWidth={1.2} />}
                    <Mark n={s} r={5.5} />
                    <text x={o.dx} y={o.dy} textAnchor={o.anchor} className={cn("text-2xs", s.status === "acquired" ? "fill-fg" : "fill-muted", sel && "font-medium")} style={HALO}>{clip(s.label, 30)}</text>
                  </g>
                </g>
              );
            })}
            {projectIds.map((id) => {
              const n = byId.get(id)!;
              const o = projAt.get(id)!;
              const sel = selected === id;
              const show = projLabels || sel || lit?.has(id);
              return (
                <g key={id} transform={`translate(${o.x},${o.y})`} className="cursor-pointer" onPointerEnter={() => p.onHover(id)} onPointerLeave={() => p.onHover(null)} onClick={click(() => p.onSelect(id))}>
                  <circle r={12} fill="transparent" />
                  {sel && <rect x={-9} y={-9} width={18} height={18} rx={3} transform="rotate(45)" fill="none" stroke="var(--color-fg)" strokeOpacity={0.55} strokeWidth={1.2} />}
                  <Mark n={n} r={4.5} />
                  {show && <text x={o.dx} y={o.dy} textAnchor={o.anchor} className="fill-muted text-3xs" style={HALO}>{clip(n.label, 24)}</text>}
                </g>
              );
            })}
          </g>
        )}
      </svg>

      <Crumbs focus={focus} tree={tree} byId={byId} onGalaxy={p.onGalaxy} onSystem={p.onSystem} />
      <p className="pointer-events-none absolute bottom-3 left-3 hidden text-2xs text-faint @[40rem]:block">
        {focus.level === "galaxy" ? t("Clic sur une constellation pour y entrer") : focus.level === "system" ? t("Clic sur une étoile pour la voir de près · Échap pour revenir") : t("Échap pour revenir · ← → étoile voisine")}
        {" · "}{t("Ctrl + molette pour zoomer")}
      </p>
      <div className="absolute right-3 bottom-3 flex gap-1 rounded-lg bg-surface p-0.5 shadow-sm" style={p.sheet && size.w > SHEET * 2 ? { right: SHEET + 12 } : undefined}>
        <IconButton label={t("Zoomer (+)")} onClick={() => zoom(1.25)}><Plus className="size-3.5" /></IconButton>
        <IconButton label={t("Dézoomer (−)")} onClick={() => zoom(0.8)}><Minus className="size-3.5" /></IconButton>
        <IconButton label={t("Recadrer (F)")} onClick={() => setReframe((n) => n + 1)}><Maximize className="size-3.5" /></IconButton>
      </div>
    </div>
  );
}

/** Where you are: Galaxie › block › unit, each step a way back. */
function Crumbs({ focus, tree, byId, onGalaxy, onSystem }: { focus: Focus; tree: SkillTree; byId: Map<string, SkillNode>; onGalaxy: () => void; onSystem: (id: string) => void }) {
  const sys = focus.level === "galaxy" ? null : tree.branches.find((b) => b.id === (focus.level === "system" ? focus.id : focus.system));
  const unit = focus.level === "star" ? byId.get(focus.id) : null;
  const step = "rounded px-1.5 py-0.5 hover:bg-ink/5 hover:text-fg";
  return (
    <nav aria-label={t("Position dans la galaxie")} className="absolute top-2.5 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-0.5 rounded-lg bg-surface/90 px-1 py-0.5 text-xs text-muted">
      {focus.level === "galaxy" ? <span className="px-1.5 py-0.5 font-medium text-fg">{t("Galaxie")}</span> : <button type="button" className={step} onClick={onGalaxy}>{t("Galaxie")}</button>}
      {sys && (
        <>
          <ChevronRight className="size-3 shrink-0 text-faint" />
          {unit ? <button type="button" className={cn(step, "truncate")} onClick={() => onSystem(sys.id)}>{sys.name}</button> : <span className="truncate px-1.5 py-0.5 font-medium text-fg">{sys.name}</span>}
        </>
      )}
      {unit && (
        <>
          <ChevronRight className="size-3 shrink-0 text-faint" />
          <span className="truncate px-1.5 py-0.5 font-medium text-fg">{unit.label}</span>
        </>
      )}
    </nav>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-2xs text-muted">
      {(Object.keys(STATUS) as SkillStatus[]).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2" style={{ borderColor: STATUS[s].color, background: s === "acquired" ? STATUS[s].color : "transparent", borderStyle: s === "locked" ? "dashed" : "solid" }} />
          {STATUS[s].label}
        </span>
      ))}
      <span className="ml-auto flex items-center gap-3 text-faint">
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-faint" />{t("Étoile : unité (taille selon les crédits)")}</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full border-2 border-faint" />{t("Acquis d'apprentissage")}</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rotate-45 rounded-[2px] border-2 border-faint" />{t("Projet")}</span>
      </span>
    </div>
  );
}


function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function Sheet({ tree, node: n, byId, onClose, onOpen }: { tree: SkillTree; node: SkillNode; byId: Map<string, SkillNode>; onClose: () => void; onOpen: (id: string) => void }) {
  const branch = tree.branches.find((b) => b.id === n.branch);
  const kids = tree.nodes.filter((x) => x.parent === n.id);
  const projects = tree.links.filter((l) => l.kind === "project_skill" && (l.target === n.id || kids.some((k) => k.id === l.target))).map((l) => byId.get(l.source)).filter((x): x is SkillNode => !!x);
  const trains = tree.links.filter((l) => l.source === n.id).map((l) => byId.get(l.target)).filter((x): x is SkillNode => !!x);
  const uniq = (xs: SkillNode[]) => [...new Map(xs.map((x) => [x.id, x])).values()];
  const kind = n.kind === "unit" ? t("Unité") : n.kind === "skill" ? t("Acquis d'apprentissage") : t("Projet");
  const List = ({ items }: { items: SkillNode[] }) => (
    <ul className="flex flex-col gap-0.5">
      {uniq(items).map((x) => (
        <li key={x.id}>
          <button type="button" className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-hover" onClick={() => onOpen(x.id)}>
            <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS[x.status].color }} />
            <span className="min-w-0 flex-1 truncate">{x.label}</span>
            <span className="text-faint">{STATUS[x.status].label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <aside className="anim-slide absolute top-0 right-0 bottom-0 z-10 bg-surface flex w-[340px] flex-col gap-3 overflow-y-auto border-l border-ink/8 p-4" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-2xs tracking-wide text-faint uppercase">{kind}</p>
          <h3 className="text-md font-medium">{n.label}</h3>
        </div>
        <button type="button" aria-label={t("Fermer")} className="text-muted hover:text-fg" onClick={onClose}><X className="size-4" /></button>
      </div>
      <p className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: `color-mix(in srgb, ${STATUS[n.status].color} 18%, transparent)`, color: STATUS[n.status].color }}>{STATUS[n.status].label}</span>
        {n.upcoming && <Badge>{t("Semestre suivant")}</Badge>}
        {n.mandatory && <Badge tone="warn">{t("Obligatoire")}</Badge>}
      </p>
      {n.kind === "unit" && n.validated !== null && n.total !== null && n.total > 0 && (
        <div>
          <Meter value={n.validated} total={n.total} color={STATUS[n.status].color} />
          <p className="mt-1 text-xs text-muted">{t("{a} acquis d'apprentissage validés sur {n}", { a: n.validated, n: n.total })}</p>
        </div>
      )}
      <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1.5 text-sm">
        {branch && <Row label={t("Bloc")}>{branch.name}</Row>}
        {n.credits !== null && <Row label={t("Crédits")}>{n.credits}</Row>}
        {n.grade && <Row label={t("Grade")}>{n.grade}</Row>}
        {n.semester !== null && <Row label={t("Semestre")}>{n.semester}{n.schoolYear ? ` · ${n.schoolYear}–${n.schoolYear + 1}` : ""}</Row>}
        {n.kind === "project" && n.schoolYear !== null && <Row label={t("Année")}>{n.schoolYear}–{n.schoolYear + 1}</Row>}
        {n.unitCode && <Row label={t("Code")}><span className="font-mono text-xs">{n.unitCode}</span></Row>}
        {n.kind === "project" && n.total !== null && n.total > 0 && <Row label={t("Réussites")}>{n.validated ?? 0} / {n.total}</Row>}
        {n.levelPercent !== null && n.kind === "skill" && <Row label={t("Niveau")}>{Math.round(n.levelPercent)} %</Row>}
        {n.domain && (
          <Row label={t("Domaine")}>
            {n.domain} <span className="ml-1 rounded border border-dashed border-warn/50 px-1 text-3xs text-warn">{t("estimation TekBoard")}</span>
          </Row>
        )}
      </dl>
      {n.kind === "unit" && kids.length > 0 && (<div><p className="mb-1 text-xs font-medium text-muted">{t("Acquis d'apprentissage")}</p><List items={kids} /></div>)}
      {n.kind === "skill" && n.parent && byId.get(n.parent) && (<div><p className="mb-1 text-xs font-medium text-muted">{t("Unité")}</p><List items={[byId.get(n.parent)!]} /></div>)}
      {projects.length > 0 && (<div><p className="mb-1 text-xs font-medium text-muted">{t("Projets qui y contribuent")}</p><List items={projects} /></div>)}
      {n.kind === "project" && trains.length > 0 && (<div><p className="mb-1 text-xs font-medium text-muted">{t("Compétences travaillées")}</p><List items={trains} /></div>)}
      <p className="mt-auto text-2xs text-faint">
        {t("Source : MY Epitech")} ({n.statusFrom === "graph" ? t("graphe de validation") : t("validations")}){n.domainEstimated ? ` · ${t("le domaine est déduit par TekBoard du code des projets.")}` : "."}
      </p>
    </aside>
  );
}
