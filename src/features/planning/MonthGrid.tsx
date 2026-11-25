// Month view: one cell per day, a few entries each. Personal entries can be dragged to another day.
import { Flag } from "lucide-react";
import { useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { cn } from "../../components/ui";
import { addDays, hhmm, startOfDay, startOfWeek, type CalItem } from "../../lib/plan";
import { dropTarget, itemTitle } from "./TimeGrid";
import { locale, t } from "../../lib/i18n";

const MAX = 4;

interface Props {
  /** Any instant of the month to show. */
  date: number;
  items: CalItem[];
  now: number;
  onOpen: (item: CalItem) => void;
  onMove: (item: CalItem, start: number, end: number) => void;
  onPickDay: (day: number) => void;
}

export function MonthGrid({ date, items, now, onOpen, onMove, onPickDay }: Props) {
  const first = new Date(new Date(date).getFullYear(), new Date(date).getMonth(), 1).getTime();
  const month = new Date(first).getMonth();
  const start = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = startOfDay(now);
  const [drag, setDrag] = useState<{ item: CalItem; x: number; y: number; over: number | null } | null>(null);

  const grab = (e: RPointerEvent, item: CalItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const [x0, y0] = [e.clientX, e.clientY];
    let moved = false;
    let over: number | null = null;
    const move = (ev: PointerEvent) => {
      if (item.source !== "plan") return;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      moved = true;
      over = dropTarget(ev.clientX, ev.clientY)?.day ?? null;
      setDrag({ item, x: ev.clientX, y: ev.clientY, over });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!moved) return onOpen(item);
      if (over === null) return;
      // Same hours, other day.
      const from = startOfDay(item.start);
      const shift = (ms: number) => {
        const d = new Date(ms);
        const t = new Date(over!);
        return new Date(t.getFullYear(), t.getMonth(), t.getDate() + Math.round((startOfDay(ms) - from) / 86_400_000), d.getHours(), d.getMinutes()).getTime();
      };
      if (over !== from) onMove(item, shift(item.start), shift(item.end));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-ink/6">
        {days.slice(0, 7).map((d) => (
          <div key={d} className="flex h-9 items-center justify-center text-xs text-muted capitalize">
            {new Date(d).toLocaleDateString(locale(), { weekday: "short" })}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const end = addDays(d, 1);
          const here = items.filter((i) => i.start < end && i.end > d && i.id !== drag?.item.id).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
          const other = new Date(d).getMonth() !== month;
          return (
            <div key={d} data-day={d} onClick={(e) => e.target === e.currentTarget && onPickDay(d)} className={cn("flex min-h-0 flex-col gap-0.5 overflow-hidden border-t border-l border-ink/6 p-1 transition-colors duration-150", other && "opacity-45", drag?.over === d && "bg-accent-soft")}>
              <button type="button" onClick={() => onPickDay(d)} title={t("Ouvrir ce jour")} className={cn("mb-0.5 flex h-5 min-w-5 items-center justify-center self-end rounded-full px-1 text-xs", d === today ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-fg")}>
                {new Date(d).getDate()}
              </button>
              {here.slice(0, MAX).map((i) => (
                <button key={i.id} type="button" title={itemTitle(i)} onPointerDown={(e) => grab(e, i)} className="cal-chip flex items-center gap-1 text-left" data-my={i.source === "my" || undefined} data-done={i.done || undefined} style={{ "--c": i.color } as CSSProperties}>
                  {i.kind === "deadline" ? <Flag className="size-3 shrink-0" /> : !i.allDay && <span className="shrink-0 font-mono text-3xs opacity-70">{hhmm(i.start)}</span>}
                  <span className="truncate">{i.title}</span>
                </button>
              ))}
              {here.length > MAX && (
                <button type="button" onClick={() => onPickDay(d)} className="text-left text-3xs text-faint hover:text-fg">
                  {here.length - MAX} more
                </button>
              )}
            </div>
          );
        })}
      </div>
      {drag && (
        <div className="cal-chip pointer-events-none fixed z-[80] max-w-48 truncate shadow-pop" style={{ left: drag.x + 10, top: drag.y + 8, "--c": drag.item.color } as CSSProperties}>
          {drag.item.title}
        </div>
      )}
    </div>
  );
}
