// Today as widgets: which ones show, in which order and at which width (out of 12 columns).
// Pure and tested. The default reproduces the classic Today exactly; a layout saved by an
// older version is migrated, never reset; a widget added in a later version goes to the
// catalogue, never into a layout the student arranged.
import { t } from "../../lib/i18n";

export type WidgetId = "hero" | "tile.logtime" | "tile.credits" | "tile.work" | "tile.due" | "timeline" | "projects" | "more" | "deadlines" | "workload" | "quick" | "activity" | "credits" | "skilltree" | "inbox";

export interface WidgetDef {
  id: WidgetId;
  label: string;
  description: string;
  /** Widths it can take, in columns out of 12. */
  sizes: number[];
  size: number;
}

export const WIDGETS: WidgetDef[] = [
  { id: "hero", label: t("Maintenant"), description: t("Le projet du moment et ce qu'il faut faire"), sizes: [12, 8], size: 12 },
  { id: "tile.logtime", label: t("Logtime de la semaine"), description: t("Heures au campus face à l'objectif"), sizes: [3, 4, 6], size: 3 },
  { id: "tile.credits", label: t("Crédits"), description: t("Crédits obtenus selon MY Epitech"), sizes: [3, 4, 6], size: 3 },
  { id: "tile.work", label: t("Travail prévu aujourd'hui"), description: t("Sessions du jour face au plafond"), sizes: [3, 4, 6], size: 3 },
  { id: "tile.due", label: t("Prochain rendu"), description: t("Le rendu le plus proche"), sizes: [3, 4, 6], size: 3 },
  { id: "timeline", label: t("Frise du jour"), description: t("Cours, sessions et rendus d'aujourd'hui"), sizes: [4, 6, 12], size: 4 },
  { id: "projects", label: t("Cartes projets"), description: t("Projets en cours, à cloner, à commiter"), sizes: [8, 6, 12], size: 8 },
  { id: "more", label: t("Rendus, charge et activité"), description: t("La section repliée du bas d'Aujourd'hui"), sizes: [12], size: 12 },
  { id: "deadlines", label: t("Rendus"), description: t("Les prochains rendus, avec leur urgence"), sizes: [4, 6, 12], size: 4 },
  { id: "workload", label: t("Sept prochains jours"), description: t("Charge de travail jour par jour"), sizes: [4, 6, 12], size: 4 },
  { id: "quick", label: t("Actions rapides"), description: t("Ouvrir, lancer, capturer"), sizes: [4, 6], size: 4 },
  { id: "activity", label: t("Activité récente"), description: t("Commits, tests et ouvertures"), sizes: [4, 6, 12], size: 4 },
  { id: "credits", label: t("Simulation de crédits"), description: t("Ton scénario face à l'objectif"), sizes: [4, 6], size: 4 },
  { id: "skilltree", label: "Skill Tree", description: t("Progression par bloc de compétences"), sizes: [4, 6, 12], size: 4 },
  { id: "inbox", label: "Inbox", description: t("Les dernières captures à trier"), sizes: [4, 6], size: 4 },
];

const DEF = new Map(WIDGETS.map((w) => [w.id, w]));

export interface LayoutItem {
  id: WidgetId;
  size: number;
}

export interface TodayLayout {
  version: 2;
  items: LayoutItem[];
  /** The "first steps" list above the widgets (until done or hidden). */
  checklist: boolean;
}

/** The classic Today: now, four indicators, the day beside the projects, the folded section. */
export const DEFAULT_LAYOUT: TodayLayout = {
  version: 2,
  checklist: true,
  items: [
    { id: "hero", size: 12 },
    { id: "tile.logtime", size: 3 },
    { id: "tile.credits", size: 3 },
    { id: "tile.work", size: 3 },
    { id: "tile.due", size: 3 },
    { id: "timeline", size: 4 },
    { id: "projects", size: 8 },
    { id: "more", size: 12 },
  ],
};

const fit = (id: WidgetId, size: number) => {
  const d = DEF.get(id)!;
  return d.sizes.includes(size) ? size : d.size;
};

/** Reads a stored layout: the current shape (cleaned), the 0.9 shape (migrated), or the default. */
export function readLayout(raw: unknown): TodayLayout {
  const v = raw as Record<string, unknown> | null;
  if (v && v.version === 2 && Array.isArray(v.items)) {
    const seen = new Set<string>();
    const items = (v.items as Array<Partial<LayoutItem>>).filter((i): i is LayoutItem => typeof i?.id === "string" && DEF.has(i.id as WidgetId) && !seen.has(i.id) && (seen.add(i.id), true)).map((i) => ({ id: i.id, size: fit(i.id, Number(i.size)) }));
    return { version: 2, items, checklist: v.checklist !== false };
  }
  if (v && Array.isArray(v.order) && Array.isArray(v.hidden)) return migrate(v.order as string[], v.hidden as string[]);
  return structuredClone(DEFAULT_LAYOUT);
}

/** 0.9 layout (`order` of four blocks, `hidden` blocks and parts) → widgets, same look. */
export function migrate(order: string[], hidden: string[]): TodayLayout {
  const off = new Set(hidden);
  const items: LayoutItem[] = [];
  for (const b of order) {
    if (off.has(b)) continue;
    if (b === "hero") items.push({ id: "hero", size: 12 });
    if (b === "tiles") for (const k of ["logtime", "credits", "work", "due"] as const) if (!off.has(`tile.${k}`)) items.push({ id: `tile.${k}`, size: 3 });
    if (b === "day") {
      const tl = !off.has("timeline");
      const pr = !off.has("projects");
      if (tl) items.push({ id: "timeline", size: pr ? 4 : 12 });
      if (pr) items.push({ id: "projects", size: tl ? 8 : 12 });
    }
    if (b === "more") items.push({ id: "more", size: 12 });
  }
  // Tiles that are fewer than four share the row, as they used to.
  const tiles = items.filter((i) => i.id.startsWith("tile."));
  if (tiles.length > 0 && tiles.length < 4) for (const tile of tiles) tile.size = tiles.length === 3 ? 4 : tiles.length === 2 ? 6 : 6;
  return { version: 2, items, checklist: !off.has("checklist") };
}

export function moveTo(l: TodayLayout, id: WidgetId, to: number): TodayLayout {
  const from = l.items.findIndex((i) => i.id === id);
  if (from < 0) return l;
  const items = [...l.items];
  const [it] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(items.length, to)), 0, it);
  return { ...l, items };
}

/** The next width this widget allows (round robin). */
export function nextSize(l: TodayLayout, id: WidgetId): TodayLayout {
  const d = DEF.get(id);
  if (!d) return l;
  return { ...l, items: l.items.map((i) => (i.id === id ? { ...i, size: d.sizes[(d.sizes.indexOf(i.size) + 1) % d.sizes.length] } : i)) };
}

export function removeWidget(l: TodayLayout, id: WidgetId): TodayLayout {
  return { ...l, items: l.items.filter((i) => i.id !== id) };
}

export function addWidget(l: TodayLayout, id: WidgetId): TodayLayout {
  if (l.items.some((i) => i.id === id) || !DEF.has(id)) return l;
  return { ...l, items: [...l.items, { id, size: DEF.get(id)!.size }] };
}

/** Widgets not on the page, offered in the catalogue. */
export const available = (l: TodayLayout) => WIDGETS.filter((w) => !l.items.some((i) => i.id === w.id));

/** Where a dragged widget lands: before the widget whose centre is nearest the pointer. */
export function dropIndex(rects: Array<{ id: WidgetId; x: number; y: number; w: number; h: number }>, px: number, py: number): number {
  let best = rects.length;
  let dist = Infinity;
  rects.forEach((r, i) => {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const d = Math.hypot((px - cx) / Math.max(1, r.w), (py - cy) / Math.max(1, r.h));
    if (d < dist) {
      dist = d;
      best = px > cx && Math.abs(py - cy) < r.h / 2 ? i + 1 : i;
    }
  });
  return best;
}
