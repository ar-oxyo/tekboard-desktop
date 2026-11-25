// Skill Tree: academic progression drawn as a tree of competencies, units, skills and projects,
// from MY Epitech's own data (cached at the last sync, so it opens offline). The only thing
// TekBoard deduces, the domain of a unit, is labelled as an estimate everywhere it appears.
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, Maximize, Minus, Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Select } from "../../components/Select";
import { Badge, Button, Card, CardTitle, cn, EmptyState, ErrorNote, IconButton, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type SkillNode, type SkillStatus, type SkillTree } from "../../lib/api";
import { locale, t } from "../../lib/i18n";
import { fit, layout, neighbours, NO_FILTER, visible, wheelAction, zoomAt, type Filters, type View } from "../../lib/skilltree";
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

function Meter({ value, total, color = "var(--color-accent)" }: { value: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-ink/8" role="img" aria-label={`${value} / ${total}`}>
      <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: color }} />
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

function TreeView({ tree }: { tree: SkillTree }) {
  // The current semester first: the next one is a filter away.
  const [f, setF] = useState<Filters>({ ...NO_FILTER, semester: tree.semester });
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const shown = useMemo(() => visible(tree, f), [tree, f]);
  const placed = useMemo(() => layout(tree, shown), [tree, shown]);
  const byId = useMemo(() => new Map(tree.nodes.map((n) => [n.id, n])), [tree]);
  const focus = hover ?? selected;
  const lit = useMemo(() => (focus ? neighbours(tree, focus) : null), [tree, focus]);

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
          <p className="display mt-1 text-2xl leading-tight font-medium">
            {c.acquired ?? "—"}
            {c.threshold !== null && <span className="text-lg text-muted"> / {c.threshold}</span>}
          </p>
          <div className="mt-2"><Meter value={c.acquired ?? 0} total={c.threshold ?? 0} color="var(--color-ok)" /></div>
          <p className="mt-1.5 text-xs text-faint">
            {c.threshold !== null ? t("Objectif fixé par MY Epitech") : t("MY Epitech ne donne pas d'objectif de crédits")}
            {c.secure !== null && ` · ${t("{n} assurés", { n: c.secure })}`}
            {c.reachable !== null && ` · ${t("{n} atteignables", { n: c.reachable })}`}
            {c.lost > 0 && <span className="text-danger"> · {t("{n} perdus", { n: c.lost })}</span>}
          </p>
        </Card>
        <Stat label={t("Unités acquises (semestre)")} value={`${current.filter((u) => u.status === "acquired").length} / ${current.length}`} note={t("{n} en cours", { n: current.filter((u) => u.status === "in_progress").length })} />
        <Stat label={t("Compétences acquises")} value={skills.length ? `${Math.round((skills.filter((s) => s.status === "acquired").length / skills.length) * 100)} %` : "—"} note={t("{a} sur {n} acquis d'apprentissage", { a: skills.filter((s) => s.status === "acquired").length, n: skills.length })} />
      </div>

      <Card className="relative overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink/6 px-3 py-2">
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
        <Canvas tree={tree} shown={shown} placed={placed} byId={byId} lit={lit} selected={selected} onHover={setHover} onSelect={setSelected} />
        <Legend />
        {selected && byId.get(selected) && <Sheet tree={tree} node={byId.get(selected)!} byId={byId} onClose={() => setSelected(null)} onOpen={setSelected} />}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle>{t("Blocs de compétences")}</CardTitle>
          <ul className="flex flex-col gap-3 p-4">
            {tree.branches.map((b) => {
              const got = b.units.filter((u) => byId.get(u)?.status === "acquired").length;
              return (
                <li key={b.id} className="text-sm">
                  <p className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: b.color ?? "var(--color-faint)" }} />
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    <span className="text-xs text-muted tabular-nums">{t("{a}/{n} unités", { a: got, n: b.units.length })}</span>
                  </p>
                  {b.threshold !== null && b.threshold > 0 && (
                    <div className="mt-1">
                      <Meter value={b.secure ?? 0} total={b.threshold} color={b.color ?? undefined} />
                      <p className="mt-0.5 text-2xs text-faint">{t("{s} crédits assurés · seuil {t}", { s: b.secure ?? 0, t: b.threshold })}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <CardTitle right={<span className="text-xs text-muted">{remaining.length}</span>}>{t("Unités restant à valider")}</CardTitle>
          <ul className="flex max-h-72 flex-col overflow-y-auto p-2">
            {remaining.length === 0 && <li className="p-2 text-sm text-muted">{t("Toutes les unités du semestre sont acquises.")}</li>}
            {remaining.map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => setSelected(u.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover">
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

type Placement = ReturnType<typeof layout>;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Smooth link from a project chip to a skill it trains (only drawn when one of them is lit). */
function projectLink(a: { x: number; y: number }, b: { x: number; y: number }) {
  const my = (a.y + b.y) / 2;
  return `M${a.x},${a.y - 8} C${a.x},${my} ${b.x},${my} ${b.x},${b.y + 8}`;
}

/** Progress ring: an arc of `pct` % around a mark of radius `r`. */
function Ring({ r, pct, color }: { r: number; pct: number; color: string }) {
  const c = 2 * Math.PI * r;
  return <circle r={r} fill="none" stroke={color} strokeWidth={2} strokeDasharray={`${(c * Math.max(0, Math.min(100, pct))) / 100} ${c}`} transform="rotate(-90)" strokeLinecap="round" />;
}

function Canvas({ tree, shown, placed, byId, lit, selected, onHover, onSelect }: { tree: SkillTree; shown: Set<string>; placed: Placement; byId: Map<string, SkillNode>; lit: Set<string> | null; selected: string | null; onHover: (id: string | null) => void; onSelect: (id: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  // Once the person pans or zooms, a resize no longer refits behind their back.
  const touched = useRef(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // New filters, new tree: show it whole.
  useEffect(() => {
    touched.current = false;
  }, [placed]);
  useEffect(() => {
    if (!touched.current && size.w > 0) setView(fit(placed.width, placed.height, size.w, size.h));
  }, [placed, size]);
  // React's onWheel is passive: the page would scroll while the tree zooms. A native,
  // non-passive listener keeps the wheel inside the tree.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      touched.current = true;
      const a = wheelAction(e);
      const r = el.getBoundingClientRect();
      setView((v) => (a.kind === "zoom" ? zoomAt(v, a.factor, e.clientX - r.left, e.clientY - r.top) : { ...v, x: v.x + a.dx, y: v.y + a.dy }));
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, []);

  const refit = () => {
    touched.current = false;
    setView(fit(placed.width, placed.height, size.w, size.h));
  };
  const zoom = (f: number) => {
    touched.current = true;
    setView((v) => zoomAt(v, f, size.w / 2, size.h / 2));
  };
  const pan = (dx: number, dy: number) => {
    touched.current = true;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  function key(e: React.KeyboardEvent) {
    const k = e.key;
    if (k === "+" || k === "=") zoom(1.25);
    else if (k === "-") zoom(0.8);
    else if (k === "0" || k.toLowerCase() === "f") refit();
    else if (k === "ArrowLeft") pan(60, 0);
    else if (k === "ArrowRight") pan(-60, 0);
    else if (k === "ArrowUp") pan(0, 60);
    else if (k === "ArrowDown") pan(0, -60);
    else return;
    e.preventDefault();
  }
  function down(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  }
  function move(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    // Captured only once it is a drag: capturing on press would steal the click from the nodes.
    if (!d.moved) svg.current?.setPointerCapture?.(e.pointerId);
    d.moved = true;
    touched.current = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  }
  const dim = (id: string) => lit !== null && !lit.has(id);
  const labels = view.k >= 0.55;
  const branchOf = new Map(tree.branches.map((b) => [b.id, b]));
  // Project → skill links: only those touching the lit set, so the tree stays readable.
  const projectLinks = lit ? tree.links.filter((l) => l.kind === "project_skill" && lit.has(l.source) && lit.has(l.target) && placed.nodes.has(l.source) && placed.nodes.has(l.target)) : [];

  return (
    <div ref={box} className="relative h-[min(68vh,620px)] min-h-80 overflow-hidden overscroll-contain">
      <svg
        ref={svg}
        width={size.w}
        height={size.h}
        tabIndex={0}
        className="block cursor-grab touch-none select-none outline-none active:cursor-grabbing"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
        onClick={() => !drag.current?.moved && onSelect(null)}
        onKeyDown={key}
        role="img"
        aria-label={t("Arbre de compétences")}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {placed.lanes.map((l) => {
            const b = branchOf.get(l.id);
            const color = l.color ?? "var(--color-faint)";
            return (
              <g key={l.id} opacity={lit && b && !b.units.some((u) => lit.has(u)) ? 0.35 : 1}>
                <rect x={l.x} y={l.y} width={l.w} height={l.h} rx={14} fill="var(--color-ink)" fillOpacity={0.035} />
                <circle cx={l.x + 22} cy={l.y + 22} r={4} fill={l.projects ? "var(--color-faint)" : color} />
                <text x={l.x + 34} y={l.y + 26} className="fill-fg text-xs font-medium">{l.projects ? t("Projets") : clip(l.name, 48)}</text>
                {b && b.threshold !== null && b.threshold > 0 && (
                  <g transform={`translate(${l.x + l.w - 156},${l.y + 18})`}>
                    <rect width={90} height={5} y={2} rx={2.5} fill="var(--color-ink)" fillOpacity={0.08} />
                    <rect width={Math.min(90, (90 * (b.secure ?? 0)) / b.threshold)} height={5} y={2} rx={2.5} fill={color} />
                    <text x={100} y={8} className="fill-muted text-3xs tabular-nums">{t("{s}/{t} cr.", { s: b.secure ?? 0, t: b.threshold })}</text>
                  </g>
                )}
              </g>
            );
          })}
          {placed.edges.map((e) => {
            const on = lit !== null && lit.has(e.from) && lit.has(e.to);
            const child = byId.get(e.to);
            return <path key={`${e.from}>${e.to}`} d={e.d} fill="none" stroke={on && child ? STATUS[child.status].color : "var(--color-ink)"} strokeOpacity={on ? 0.9 : 0.16} strokeWidth={on ? 1.6 : 1.2} opacity={dim(e.to) ? 0.4 : 1} />;
          })}
          {projectLinks.map((l) => (
            <path key={`${l.source}~${l.target}`} d={projectLink(placed.nodes.get(l.source)!, placed.nodes.get(l.target)!)} fill="none" stroke={STATUS[byId.get(l.source)!.status].color} strokeOpacity={0.7} strokeWidth={1.4} strokeDasharray="4 4" />
          ))}
          {tree.nodes.filter((n) => shown.has(n.id) && placed.nodes.has(n.id)).map((n) => {
            const p = placed.nodes.get(n.id)!;
            const s = STATUS[n.status];
            const filled = n.status === "acquired";
            const sel = selected === n.id;
            const progress = n.kind === "unit" ? (n.total ? ((n.validated ?? 0) / n.total) * 100 : null) : n.levelPercent;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                className="cursor-pointer"
                opacity={dim(n.id) ? 0.25 : n.status === "locked" ? 0.6 : 1}
                onPointerEnter={() => onHover(n.id)}
                onPointerLeave={() => onHover(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!drag.current?.moved) onSelect(n.id);
                }}
              >
                {n.kind === "unit" && (
                  <>
                    {sel && <rect x={-19} y={-19} width={38} height={38} rx={11} fill="none" stroke="var(--color-fg)" strokeOpacity={0.55} strokeWidth={1.5} />}
                    <rect x={-14} y={-14} width={28} height={28} rx={8} fill={filled ? s.color : "var(--color-surface)"} stroke={s.color} strokeWidth={2} strokeDasharray={n.status === "locked" ? "3 3" : undefined} />
                    <text x={24} y={-2} className="fill-fg text-xs font-medium">{clip(n.label, 26)}</text>
                    <text x={24} y={12} className="fill-muted text-3xs tabular-nums">
                      {[n.validated !== null && n.total ? `${n.validated}/${n.total}` : null, n.credits !== null ? t("{n} cr.", { n: n.credits }) : null, n.grade].filter(Boolean).join(" · ") || s.label}
                    </text>
                  </>
                )}
                {n.kind === "skill" && (
                  <>
                    {sel && <circle r={12} fill="none" stroke="var(--color-fg)" strokeOpacity={0.55} strokeWidth={1.5} />}
                    {n.status === "in_progress" && progress !== null && <Ring r={9.5} pct={progress} color={s.color} />}
                    <circle r={6} fill={filled ? s.color : "var(--color-surface)"} stroke={s.color} strokeWidth={1.6} strokeDasharray={n.status === "locked" ? "2 2" : undefined} />
                    {labels && <text x={15} y={4} className={cn("text-2xs", n.status === "acquired" ? "fill-fg" : "fill-muted")}>{clip(n.label, 30)}</text>}
                  </>
                )}
                {n.kind === "project" && (
                  <>
                    {sel && <rect x={-10} y={-10} width={20} height={20} rx={4} transform="rotate(45)" fill="none" stroke="var(--color-fg)" strokeOpacity={0.55} strokeWidth={1.5} />}
                    <rect x={-6} y={-6} width={12} height={12} rx={2} transform="rotate(45)" fill={filled ? s.color : "var(--color-surface)"} stroke={s.color} strokeWidth={1.6} strokeDasharray={n.status === "locked" ? "2 2" : undefined} />
                    {labels && <text x={16} y={4} className="fill-fg text-2xs">{clip(n.label, 30)}</text>}
                  </>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute right-3 bottom-3 flex gap-1 rounded-lg bg-surface p-0.5 shadow-sm">
        <IconButton label={t("Zoomer (+)")} onClick={() => zoom(1.25)}><Plus className="size-3.5" /></IconButton>
        <IconButton label={t("Dézoomer (−)")} onClick={() => zoom(0.8)}><Minus className="size-3.5" /></IconButton>
        <IconButton label={t("Tout afficher (F)")} onClick={refit}><Maximize className="size-3.5" /></IconButton>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink/6 px-3 py-2 text-2xs text-muted">
      {(Object.keys(STATUS) as SkillStatus[]).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2" style={{ borderColor: STATUS[s].color, background: s === "acquired" ? STATUS[s].color : "transparent", borderStyle: s === "locked" ? "dashed" : "solid" }} />
          {STATUS[s].label}
        </span>
      ))}
      <span className="ml-auto flex items-center gap-3 text-faint">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] border-2 border-faint" />{t("Unité")}</span>
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
    <aside className="glass anim-slide absolute top-[45px] right-0 bottom-0 z-10 flex w-[340px] flex-col gap-3 overflow-y-auto border-l border-ink/8 p-4" onClick={(e) => e.stopPropagation()}>
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
