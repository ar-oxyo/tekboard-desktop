// Skill Tree: academic progression drawn as a tree of competencies, units, skills and projects,
// from MY Epitech's own data (cached at the last sync, so it opens offline). The only thing
// TekBoard deduces, the domain of a unit, is labelled as an estimate everywhere it appears.
import { useQuery } from "@tanstack/react-query";
import { Crosshair, GraduationCap, Minus, Network, Plus, RefreshCw, X } from "lucide-react";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Select } from "../../components/Select";
import { Badge, Button, Card, CardTitle, cn, EmptyState, ErrorNote, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type SkillNode, type SkillStatus, type SkillTree } from "../../lib/api";
import { locale, t } from "../../lib/i18n";
import { layout, neighbours, NO_FILTER, RADIUS, visible, type Filters } from "../../lib/skilltree";
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

const SIZE = { unit: 17, skill: 8, project: 5.5 } as const;

function Meter({ value, total, color = "var(--color-accent)" }: { value: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-white/8" role="img" aria-label={`${value} / ${total}`}>
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
          <p className="display mt-1 text-[30px] leading-tight font-medium">
            {c.acquired ?? "—"}
            {c.threshold !== null && <span className="text-[18px] text-muted"> / {c.threshold}</span>}
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
        <div className="flex flex-wrap items-center gap-2 border-b border-white/6 px-3 py-2">
          <Select size="sm" className="w-36" label={t("Année")} value={f.year === null ? "" : String(f.year)} onChange={(v) => setF({ ...f, year: v ? Number(v) : null })} options={[{ value: "", label: t("Toutes les années") }, ...years.map((y) => ({ value: String(y), label: `${y}–${y + 1}` }))]} />
          <Select size="sm" className="w-36" label={t("Semestre")} value={f.semester === null ? "" : String(f.semester)} onChange={(v) => setF({ ...f, semester: v ? Number(v) : null })} options={[{ value: "", label: t("Tous les semestres") }, ...semesters.map((s) => ({ value: String(s), label: t("Semestre {n}", { n: s }) + (s === tree.semester ? ` · ${t("actuel")}` : "") }))]} />
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
                <li key={b.id} className="text-[13px]">
                  <p className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: b.color ?? "var(--color-faint)" }} />
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    <span className="text-xs text-muted tabular-nums">{t("{a}/{n} unités", { a: got, n: b.units.length })}</span>
                  </p>
                  {b.threshold !== null && b.threshold > 0 && (
                    <div className="mt-1">
                      <Meter value={b.secure ?? 0} total={b.threshold} color={b.color ?? undefined} />
                      <p className="mt-0.5 text-[11px] text-faint">{t("{s} crédits assurés · seuil {t}", { s: b.secure ?? 0, t: b.threshold })}</p>
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
            {remaining.length === 0 && <li className="p-2 text-[13px] text-muted">{t("Toutes les unités du semestre sont acquises.")}</li>}
            {remaining.map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => setSelected(u.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover">
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
          <div className="flex flex-col gap-3 p-4 text-[13px]">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1">
              <dt className="text-muted">{t("Semestres précédents")}</dt><dd className="tabular-nums">{c.prior ?? "—"} cr.</dd>
              <dt className="text-muted">{t("Ce semestre")}</dt><dd className="tabular-nums">{c.thisSemester ?? "—"} cr.</dd>
              <dt className="text-muted">{t("Projets validés")}</dt><dd className="tabular-nums">{projects.filter((p) => p.status === "acquired").length}</dd>
            </dl>
            <p className="text-[11px] text-faint">{t("MY Epitech ne détaille pas les crédits de chaque semestre passé : seuls ces deux totaux sont affichés.")}</p>
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

function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return `M${a.x},${a.y} Q${mx * 0.9},${my * 0.9} ${b.x},${b.y}`;
}

function Canvas({ tree, shown, placed, byId, lit, selected, onHover, onSelect }: { tree: SkillTree; shown: Set<string>; placed: Placement; byId: Map<string, SkillNode>; lit: Set<string> | null; selected: string | null; onHover: (id: string | null) => void; onSelect: (id: string | null) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 0.62 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const W = 1000;
  const H = 640;
  const toLocal = (cx: number, cy: number) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * W - W / 2, y: ((cy - r.top) / r.height) * H - H / 2 };
  };
  function wheel(e: ReactWheelEvent) {
    const p = toLocal(e.clientX, e.clientY);
    const k = Math.min(3, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    setView({ k, x: p.x - ((p.x - view.x) * k) / view.k, y: p.y - ((p.y - view.y) * k) / view.k });
  }
  function down(e: ReactPointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function move(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const r = svg.current!.getBoundingClientRect();
    const dx = ((e.clientX - d.x) / r.width) * W;
    const dy = ((e.clientY - d.y) / r.height) * H;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  }
  const zoom = (f: number) => setView((v) => ({ ...v, k: Math.min(3, Math.max(0.3, v.k * f)) }));
  const dim = (id: string) => lit !== null && !lit.has(id);
  const labels = view.k > 1.15;

  return (
    <div className="relative">
      <svg
        ref={svg}
        viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`}
        className="block h-[560px] w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onWheel={wheel}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
        onClick={() => !drag.current?.moved && onSelect(null)}
        role="img"
        aria-label={t("Arbre de compétences")}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {[RADIUS.unit, RADIUS.skill, RADIUS.project].map((r) => <circle key={r} r={r} fill="none" stroke="currentColor" className="text-white/4" strokeDasharray="2 6" />)}
          {[...placed.branches].map(([id, b]) => (
            <path key={`sector-${id}`} d={`M0,0 L${Math.cos(b.from) * 860},${Math.sin(b.from) * 860}`} stroke="currentColor" className="text-white/5" />
          ))}
          {/* Root to branches, branches to units. */}
          {[...placed.branches].map(([id, b]) => {
            const branch = tree.branches.find((x) => x.id === id)!;
            return (
              <g key={`b-${id}`} opacity={lit && !branch.units.some((u) => lit.has(u)) ? 0.25 : 1}>
                <line x1={0} y1={0} x2={b.x} y2={b.y} stroke={branch.color ?? "var(--color-faint)"} strokeOpacity={0.5} strokeWidth={2} />
                {branch.units.filter((u) => placed.nodes.has(u)).map((u) => <path key={u} d={curve(b, placed.nodes.get(u)!)} fill="none" stroke={branch.color ?? "var(--color-faint)"} strokeOpacity={0.35} strokeWidth={1.5} />)}
              </g>
            );
          })}
          {tree.links.filter((l) => placed.nodes.has(l.source) && placed.nodes.has(l.target)).map((l) => {
            const on = lit !== null && lit.has(l.source) && lit.has(l.target);
            const src = byId.get(l.source)!;
            return <path key={`${l.source}-${l.target}`} d={curve(placed.nodes.get(l.target)!, placed.nodes.get(l.source)!)} fill="none" stroke={on ? STATUS[src.status].color : "currentColor"} className={on ? "" : "text-white/12"} strokeWidth={on ? 1.6 : 1} opacity={lit && !on ? 0.3 : 1} />;
          })}
          <circle r={46} fill="var(--color-surface)" stroke="var(--color-accent)" strokeOpacity={0.5} strokeWidth={2} />
          <text textAnchor="middle" y={-4} className="fill-fg text-[15px] font-medium">{tree.credits.acquired ?? "—"}</text>
          <text textAnchor="middle" y={13} className="fill-muted text-[9px]">{tree.credits.threshold !== null ? `/ ${tree.credits.threshold} ${t("crédits")}` : t("crédits")}</text>
          {[...placed.branches].map(([id, b]) => {
            const branch = tree.branches.find((x) => x.id === id)!;
            return (
              <g key={`bl-${id}`} transform={`translate(${b.x},${b.y})`}>
                <circle r={7} fill={branch.color ?? "var(--color-faint)"} />
                <text x={Math.cos(b.angle) * 14} y={Math.sin(b.angle) * 14 + 4} textAnchor={Math.abs(Math.cos(b.angle)) < 0.3 ? "middle" : Math.cos(b.angle) > 0 ? "start" : "end"} className="fill-fg text-[11px] font-medium">
                  {branch.name.length > 24 ? `${branch.name.slice(0, 23)}…` : branch.name}
                </text>
              </g>
            );
          })}
          {tree.nodes.filter((n) => shown.has(n.id) && placed.nodes.has(n.id)).map((n, i) => {
            const p = placed.nodes.get(n.id)!;
            const s = STATUS[n.status];
            const r = SIZE[n.kind];
            const filled = n.status === "acquired";
            const showLabel = n.kind === "unit" || labels || selected === n.id || lit?.has(n.id);
            const flip = Math.cos(p.angle) < 0;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                className="anim-pop cursor-pointer"
                style={{ animationDelay: `${Math.min(i, 80) * 6}ms` }}
                opacity={dim(n.id) ? 0.22 : n.status === "locked" ? 0.55 : 1}
                onPointerEnter={() => onHover(n.id)}
                onPointerLeave={() => onHover(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!drag.current?.moved) onSelect(n.id);
                }}
              >
                {selected === n.id && <circle r={r + 6} fill="none" stroke="var(--color-fg)" strokeOpacity={0.6} strokeWidth={1.5} />}
                {n.status === "in_progress" && <circle r={r + 4} fill="none" stroke={s.color} strokeWidth={1.5} className="skill-pulse" />}
                <circle r={r} fill={filled ? s.color : "var(--color-surface)"} stroke={s.color} strokeWidth={n.kind === "unit" ? 2.5 : 1.6} strokeDasharray={n.status === "locked" ? "3 3" : undefined} />
                {n.kind === "unit" && n.validated !== null && n.total ? <text textAnchor="middle" y={3.5} className={cn("text-[9px] font-medium tabular-nums", filled ? "fill-bg" : "fill-fg")}>{n.validated}/{n.total}</text> : null}
                {showLabel && (
                  <text x={flip ? -(r + 5) : r + 5} y={3.5} textAnchor={flip ? "end" : "start"} className={cn(n.kind === "unit" ? "fill-fg text-[11px]" : "fill-muted text-[9px]")}>
                    {n.label.length > 34 ? `${n.label.slice(0, 33)}…` : n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute top-3 left-3 flex flex-col gap-1">
        <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} title={t("Zoomer")} onClick={() => zoom(1.25)} />
        <Button size="sm" variant="secondary" icon={<Minus className="size-3.5" />} title={t("Dézoomer")} onClick={() => zoom(0.8)} />
        <Button size="sm" variant="secondary" icon={<Crosshair className="size-3.5" />} title={t("Recentrer")} onClick={() => setView({ x: 0, y: 0, k: 0.62 })} />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/6 px-3 py-2 text-[11px] text-muted">
      {(Object.keys(STATUS) as SkillStatus[]).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2" style={{ borderColor: STATUS[s].color, background: s === "acquired" ? STATUS[s].color : "transparent", borderStyle: s === "locked" ? "dashed" : "solid" }} />
          {STATUS[s].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5"><Network className="size-3" /> {t("Gros cercles : unités · moyens : acquis d'apprentissage · petits : projets")}</span>
      <span className="ml-auto text-faint">{t("Relations : celles de MY Epitech. Domaine : estimation TekBoard.")}</span>
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
    <aside className="glass anim-slide absolute top-[45px] right-0 bottom-0 z-10 flex w-[340px] flex-col gap-3 overflow-y-auto border-l border-white/8 p-4" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] tracking-wide text-faint uppercase">{kind}</p>
          <h3 className="text-[15px] font-medium">{n.label}</h3>
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
      <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1.5 text-[13px]">
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
            {n.domain} <span className="ml-1 rounded border border-dashed border-warn/50 px-1 text-[10px] text-warn">{t("estimation TekBoard")}</span>
          </Row>
        )}
      </dl>
      {n.kind === "unit" && kids.length > 0 && (<div><p className="mb-1 text-xs font-medium text-muted">{t("Acquis d'apprentissage")}</p><List items={kids} /></div>)}
      {n.kind === "skill" && n.parent && byId.get(n.parent) && (<div><p className="mb-1 text-xs font-medium text-muted">{t("Unité")}</p><List items={[byId.get(n.parent)!]} /></div>)}
      {projects.length > 0 && (<div><p className="mb-1 text-xs font-medium text-muted">{t("Projets qui y contribuent")}</p><List items={projects} /></div>)}
      {n.kind === "project" && trains.length > 0 && (<div><p className="mb-1 text-xs font-medium text-muted">{t("Compétences travaillées")}</p><List items={trains} /></div>)}
      <p className="mt-auto text-[11px] text-faint">
        {t("Source : MY Epitech")} ({n.statusFrom === "graph" ? t("graphe de validation") : t("validations")}){n.domainEstimated ? ` · ${t("le domaine est déduit par TekBoard du code des projets.")}` : "."}
      </p>
    </aside>
  );
}
