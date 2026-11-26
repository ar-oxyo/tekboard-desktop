// Today's widgets on a 12-column grid (one column below 56rem of content). Out of edit mode
// nothing moves: no handle, no drag. In edit mode each widget gets a frame with a grip (drag
// it, or arrow keys), its width and a remove button; a dashed box shows where it will land.
import { GripVertical, LayoutGrid, Plus, RotateCcw, X } from "lucide-react";
import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { Menu, MenuItem } from "../../components/Menu";
import { Button, cn, IconButton } from "../../components/ui";
import { t } from "../../lib/i18n";
import { addWidget, available, DEFAULT_LAYOUT, dropIndex, moveTo, nextSize, removeWidget, WIDGETS, type TodayLayout, type WidgetId } from "./layout";

const SPAN: Record<number, string> = { 3: "@4xl:col-span-3", 4: "@4xl:col-span-4", 6: "@4xl:col-span-6", 8: "@4xl:col-span-8", 12: "@4xl:col-span-12" };
const LABEL = new Map(WIDGETS.map((w) => [w.id, w.label]));

export function WidgetGrid({ layout, onChange, edit, onDone, render }: { layout: TodayLayout; onChange: (l: TodayLayout) => void; edit: boolean; onDone: () => void; render: (id: WidgetId) => ReactNode }) {
  const refs = useRef(new Map<WidgetId, HTMLElement>());
  const [drag, setDrag] = useState<{ id: WidgetId; to: number } | null>(null);
  const others = layout.items.filter((i) => i.id !== drag?.id);

  // The pointer is followed on the window: the dragged widget leaves the grid (a placeholder
  // takes its place), so its grip cannot keep the pointer to itself.
  const start = (e: ReactPointerEvent, id: WidgetId) => {
    e.preventDefault();
    const rest = layout.items.filter((i) => i.id !== id);
    let to = layout.items.findIndex((i) => i.id === id);
    setDrag({ id, to });
    const move = (ev: PointerEvent) => {
      const rects = rest.map((i) => ({ id: i.id, ...rectOf(refs.current.get(i.id)) })).filter((r) => r.w > 0);
      to = dropIndex(rects, ev.clientX, ev.clientY);
      setDrag({ id, to });
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (ev.type === "pointerup") onChange(moveTo(layout, id, to));
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  const key = (e: React.KeyboardEvent, id: WidgetId) => {
    const i = layout.items.findIndex((x) => x.id === id);
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") onChange(moveTo(layout, id, i - 1));
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") onChange(moveTo(layout, id, i + 1));
    else return;
    e.preventDefault();
  };

  // While dragging, the others are laid out with a placeholder where the widget will go.
  const shown: Array<{ id: WidgetId; size: number; ghost?: boolean }> = drag ? [...others.slice(0, drag.to), { ...layout.items.find((i) => i.id === drag.id)!, ghost: true }, ...others.slice(drag.to)] : layout.items;

  return (
    <div className="flex flex-col gap-5">
      {edit && (
        <div className="sticky top-0 z-20 -mx-2 flex flex-wrap items-center gap-2 rounded-(--btn-radius) bg-bg/95 px-2 py-2 backdrop-blur-sm" role="toolbar" aria-label={t("Personnaliser Aujourd'hui")}>
          <LayoutGrid className="size-4 text-accent" />
          <span className="text-sm text-fg" title={t("Glisse une poignée pour déplacer, change la largeur, ajoute ou retire. Tout est gardé tout de suite.")}>{t("Disposition")}</span>
          <span className="text-xs text-faint">{t("gardée automatiquement")}</span>
          <span className="flex-1" />
          <Menu trigger={<Button size="sm" icon={<Plus className="size-3.5" />} disabled={available(layout).length === 0} disabledReason={t("Tous les widgets sont déjà là")}>{t("Ajouter")}</Button>} label={t("Ajouter un widget")}>
            {available(layout).map((w) => (
              <MenuItem key={w.id} onSelect={() => onChange(addWidget(layout, w.id))} hint={w.description}>{w.label}</MenuItem>
            ))}
          </Menu>
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => onChange({ ...structuredClone(DEFAULT_LAYOUT), checklist: layout.checklist })}>{t("Disposition d'origine")}</Button>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" className="accent-(--color-accent)" checked={layout.checklist} onChange={(e) => onChange({ ...layout, checklist: e.target.checked })} />
            {t("Premiers pas")}
          </label>
          <Button size="sm" variant="primary" onClick={onDone}>{t("Terminé")}</Button>
        </div>
      )}
      {layout.items.length === 0 && <p className="py-10 text-center text-sm text-muted">{t("Aucun widget. Ajoute-en, ou reviens à la disposition d'origine.")}</p>}
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-7 @4xl:grid-cols-12">
        {shown.map((item) =>
          item.ghost ? (
            <div key={`ghost-${item.id}`} className={cn("min-h-24 rounded-(--radius-card) border-2 border-dashed border-accent/50 bg-accent-soft/40", SPAN[item.size])} aria-hidden />
          ) : (
            <div key={item.id} ref={(el) => { if (el) refs.current.set(item.id, el); else refs.current.delete(item.id); }} className={cn("relative min-w-0", SPAN[item.size], edit && "rounded-(--radius-card) outline-1 outline-offset-4 outline-line-strong outline-dashed")}>
              {edit && (
                <div className="absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-(--btn-radius) bg-raised px-1 shadow-(--shadow-pop)">
                  <button type="button" className="flex h-7 cursor-grab items-center gap-1 px-1.5 text-xs text-muted active:cursor-grabbing" onPointerDown={(e) => start(e, item.id)} onKeyDown={(e) => key(e, item.id)} aria-label={t("Déplacer {w} (flèches)", { w: LABEL.get(item.id) ?? item.id })} title={t("Glisser, ou flèches du clavier")}>
                    <GripVertical className="size-3.5" /> {item.size > 4 && LABEL.get(item.id)}
                  </button>
                  {(WIDGETS.find((w) => w.id === item.id)?.sizes.length ?? 1) > 1 && (
                    <button type="button" className="h-7 rounded-[4px] px-1.5 font-mono text-2xs text-muted hover:bg-hover hover:text-fg" onClick={() => onChange(nextSize(layout, item.id))} title={t("Changer la largeur")}>
                      {item.size}/12
                    </button>
                  )}
                  <IconButton label={t("Retirer")} onClick={() => onChange(removeWidget(layout, item.id))}><X className="size-3.5" /></IconButton>
                </div>
              )}
              {/* In edit mode the widget cannot be used: no accidental click while arranging. */}
              <div className={cn(edit && "pointer-events-none select-none opacity-90")} inert={edit || undefined}>{render(item.id)}</div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function rectOf(el: HTMLElement | undefined) {
  const r = el?.getBoundingClientRect();
  return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 };
}
