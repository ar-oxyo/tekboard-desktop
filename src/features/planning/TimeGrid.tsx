// Day and week timeline: entries as blocks, moved and resized with the pointer.
// Personal entries can be dragged; MY Epitech sessions and hand-ins are drawn apart and stay put.
import { Flag, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { cn } from "../../components/ui";
import { addDays, fmtDur, hhmm, KIND_LABEL, layoutDay, MIN, offRanges, startOfDay, type CalItem, type PlanPrefs } from "../../lib/plan";
import { locale, t } from "../../lib/i18n";

export const HOUR = 52;
const SNAP = 15 * MIN;
const snap = (ms: number) => Math.round(ms / SNAP) * SNAP;
const atMinutes = (day: number, minutes: number) => {
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes).getTime();
};
const minutesIn = (ms: number, day: number) => (ms - day) / MIN;

export interface DropTarget {
  day: number;
  /** Instant under the pointer, snapped to 15 minutes; `null` over a month cell or an all-day row. */
  time: number | null;
}

/** Day (and hour, over a timeline) under a point of the screen. Works for every calendar view. */
export function dropTarget(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day]");
  if (!el) return null;
  const day = Number(el.dataset.day);
  if (el.dataset.timeline === undefined) return { day, time: null };
  const r = el.getBoundingClientRect();
  const minutes = Math.min(24 * 60 - 15, Math.max(0, Math.round(((y - r.top) / HOUR) * 4) * 15));
  return { day, time: atMinutes(day, minutes) };
}

export const itemTitle = (i: CalItem) => [`${KIND_LABEL[i.kind]} · ${i.title}`, i.allDay ? null : `${hhmm(i.start)} – ${hhmm(i.end)} (${fmtDur((i.end - i.start) / MIN)})`, i.module, i.detail, i.unregistered ? t("Tu n'es pas inscrit à cette séance") : null, i.agenda?.account === "aer" ? t("Agenda AER") : i.agenda?.account === "both" ? t("Dans tes agendas Student et AER") : null, i.source === "my" ? t("Depuis MY Epitech, en lecture seule") : null].filter(Boolean).join("\n");

interface Props {
  days: number[];
  items: CalItem[];
  now: number;
  prefs: PlanPrefs;
  /** Block shown while something is dragged from outside the grid (an inbox task). */
  ghost: { start: number; end: number; title: string } | null;
  onCreate: (start: number, end: number) => void;
  onOpen: (item: CalItem) => void;
  onMove: (item: CalItem, start: number, end: number) => void;
  onPickDay: (day: number) => void;
}

export function TimeGrid({ days, items, now, prefs, ghost, onCreate, onOpen, onMove, onPickDay }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; start: number; end: number; dropped?: boolean } | null>(null);
  // A dropped block is held where it was dropped until the entry itself is there (the
  // optimistic update lands a moment later), then the plain entry takes over.
  useEffect(() => {
    if (!drag?.dropped) return;
    const it = items.find((i) => i.id === drag.id);
    if (!it || (it.start === drag.start && it.end === drag.end)) setDrag(null);
    const safety = window.setTimeout(() => setDrag(null), 2000);
    return () => window.clearTimeout(safety);
  }, [items, drag]);
  const today = startOfDay(now);

  // Opens on the working hours, not on midnight.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, (prefs.dayStart / 60 - 1) * HOUR);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const timed = useMemo(() => items.filter((i) => !i.allDay), [items]);
  const allDay = useMemo(() => items.filter((i) => i.allDay), [items]);

  const track = (onMoveEv: (ev: PointerEvent) => void, onEnd: () => void) => {
    const up = () => {
      window.removeEventListener("pointermove", onMoveEv);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.userSelect = "";
      onEnd();
    };
    window.addEventListener("pointermove", onMoveEv);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const grab = (e: RPointerEvent, item: CalItem, mode: "move" | "start" | "end") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (item.source !== "plan") {
      track(() => undefined, () => onOpen(item));
      return;
    }
    const [x0, y0] = [e.clientX, e.clientY];
    const offset = mode === "move" ? (dropTarget(x0, y0)?.time ?? item.start) - snap(item.start) : 0;
    let cur = { start: item.start, end: item.end };
    let moved = false;
    track(
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        moved = true;
        const t = dropTarget(ev.clientX, ev.clientY)?.time;
        if (t === null || t === undefined) return;
        if (mode === "move") cur = { start: t - offset, end: t - offset + (item.end - item.start) };
        else if (mode === "end") cur = { start: item.start, end: Math.max(item.start + SNAP, t) };
        else cur = { start: Math.min(item.end - SNAP, t), end: item.end };
        setDrag({ id: item.id, ...cur });
      },
      () => {
        if (!moved) {
          onOpen(item);
        } else if (cur.start !== item.start || cur.end !== item.end) {
          onMove(item, cur.start, cur.end);
          setDrag({ id: item.id, ...cur, dropped: true });
          return;
        }
        setDrag(null);
      },
    );
  };

  /** Pressing on an empty part of a day draws a new entry; a plain click makes it one hour long. */
  const draw = (e: RPointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const t0 = dropTarget(e.clientX, e.clientY)?.time;
    if (t0 === null || t0 === undefined) return;
    const dayEnd = addDays(t0, 1);
    let cur = { start: t0, end: t0 + 60 * MIN };
    let moved = false;
    const y0 = e.clientY;
    document.body.style.userSelect = "none";
    track(
      (ev) => {
        if (!moved && Math.abs(ev.clientY - y0) < 6) return;
        moved = true;
        const t = dropTarget(ev.clientX, ev.clientY)?.time ?? cur.end;
        cur = t >= t0 ? { start: t0, end: Math.min(dayEnd, Math.max(t0 + SNAP, t + SNAP)) } : { start: Math.max(startOfDay(t0), t), end: t0 + SNAP };
        setDrag({ id: "new", ...cur });
      },
      () => {
        setDrag(null);
        onCreate(cur.start, Math.min(cur.end, dayEnd));
      },
    );
  };

  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  const hasAllDay = days.some((d) => allDay.some((i) => i.start < addDays(d, 1) && i.end > d));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 border-b border-ink/6" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => {
          const date = new Date(d);
          const isToday = d === today;
          return (
            <button key={d} type="button" onClick={() => onPickDay(d)} title={t("Ouvrir ce jour")} className="flex h-11 items-center justify-center gap-2 border-l border-ink/6 text-xs text-muted transition-colors duration-150 hover:text-fg">
              <span className="capitalize">{date.toLocaleDateString(locale(), { weekday: "short" })}</span>
              <span className={cn("flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm", isToday ? "bg-accent font-medium text-on-accent" : "text-fg")}>{date.getDate()}</span>
            </button>
          );
        })}
      </div>
      {hasAllDay && (
        <div className="grid shrink-0 border-b border-ink/6" style={{ gridTemplateColumns: cols }}>
          <div className="flex items-center justify-end pr-2 text-3xs text-faint">{t("toute la journée")}</div>
          {days.map((d) => (
            <div key={d} data-day={d} className="flex min-h-7 flex-col gap-0.5 border-l border-ink/6 p-0.5">
              {allDay
                .filter((i) => i.start < addDays(d, 1) && i.end > d)
                .map((i) => (
                  <button key={i.id} type="button" title={itemTitle(i)} onClick={() => onOpen(i)} className="cal-chip truncate text-left" data-my={i.source === "my" || undefined} style={{ "--c": i.color } as CSSProperties}>
                    {i.kind === "deadline" && <Flag className="mr-1 inline size-3 align-[-2px]" />}
                    {i.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 font-mono text-3xs text-faint" style={{ top: (h + 1) * HOUR }}>
                {String(h + 1).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const end = addDays(d, 1);
            const here = timed.filter((i) => i.start < end && i.end > d && i.id !== drag?.id);
            const blocks = layoutDay(here.filter((i) => i.kind !== "deadline" && i.kind !== "start"));
            const marks = here.filter((i) => i.kind === "deadline" || i.kind === "start");
            const dragged = drag && drag.start < end && drag.end > d ? drag : null;
            const draggedItem = dragged ? timed.find((i) => i.id === dragged.id) : undefined;
            const shown = ghost && ghost.start < end && ghost.end > d ? ghost : null;
            return (
              <div key={d} data-day={d} data-timeline onPointerDown={draw} className="cal-col relative border-l border-ink/6" style={{ backgroundSize: `100% ${HOUR}px` }}>
                {offRanges(prefs, d).map(([a, b]) => (
                  <div key={a} className="cal-off pointer-events-none absolute inset-x-0" style={{ top: (a / 60) * HOUR, height: ((b - a) / 60) * HOUR }} />
                ))}
                {blocks.map(({ item, col, cols: n }) => (
                  <Block key={item.id} item={item} day={d} col={col} cols={n} past={item.end < now} onGrab={grab} onOpen={onOpen} />
                ))}
                {marks.map((i) => {
                  const t = i.kind === "deadline" ? i.end : i.start;
                  return (
                    <button key={i.id} type="button" title={itemTitle(i)} onPointerDown={(e) => e.stopPropagation()} onClick={() => onOpen(i)} className="cal-mark absolute inset-x-0 z-10 flex items-center" style={{ top: (minutesIn(t, d) / 60) * HOUR - 9, "--c": i.color } as CSSProperties}>
                      <span className="cal-mark-label truncate">
                        <Flag className="mr-1 inline size-3 align-[-2px]" />
                        {i.title} · {hhmm(t)}
                      </span>
                    </button>
                  );
                })}
                {dragged && (
                  <div className="cal-event pointer-events-none absolute right-1 left-0.5 z-20 px-2 py-1" data-dragging style={{ ...box(dragged.start, dragged.end, d), "--c": draggedItem?.color ?? "var(--color-accent)" } as CSSProperties}>
                    <p className="truncate text-xs font-medium">{draggedItem?.title ?? "New entry"}</p>
                    <p className="font-mono text-3xs text-muted">
                      {hhmm(dragged.start)} – {hhmm(dragged.end)} · {fmtDur((dragged.end - dragged.start) / MIN)}
                    </p>
                  </div>
                )}
                {shown && (
                  <div className="cal-event pointer-events-none absolute right-1 left-0.5 z-20 px-2 py-1" data-dragging style={{ ...box(shown.start, shown.end, d), "--c": "var(--color-accent)" } as CSSProperties}>
                    <p className="truncate text-xs font-medium">{shown.title}</p>
                    <p className="font-mono text-3xs text-muted">
                      {hhmm(shown.start)} – {hhmm(shown.end)}
                    </p>
                  </div>
                )}
                {d === today && (
                  <div className="pointer-events-none absolute inset-x-0 z-30 flex items-center" style={{ top: (minutesIn(now, d) / 60) * HOUR }}>
                    <span className="-ml-1 size-2 rounded-full bg-accent-2" />
                    <span className="h-0.5 flex-1 bg-accent-2" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function box(start: number, end: number, day: number): CSSProperties {
  const top = Math.max(0, minutesIn(start, day));
  const bottom = Math.min(24 * 60, minutesIn(end, day));
  return { top: (top / 60) * HOUR + 1, height: Math.max(14, ((bottom - top) / 60) * HOUR - 2) };
}

function Block({ item, day, col, cols, past, onGrab, onOpen }: { item: CalItem; day: number; col: number; cols: number; past: boolean; onOpen: (item: CalItem) => void; onGrab: (e: RPointerEvent, item: CalItem, mode: "move" | "start" | "end") => void }) {
  const style = box(item.start, item.end, day);
  const height = style.height as number;
  const mine = item.source === "plan";
  const width = 100 / cols;
  return (
    <div
      role="button"
      tabIndex={0}
      title={itemTitle(item)}
      onPointerDown={(e) => onGrab(e, item, "move")}
      onKeyDown={(e) => e.key === "Enter" && onOpen(item)}
      data-my={!mine || undefined}
      data-done={item.done || undefined}
      data-unregistered={item.unregistered || undefined}
      data-past={(past && !item.done) || undefined}
      className={cn("cal-event absolute overflow-hidden px-1.5", height < 30 ? "py-0" : "py-1", mine ? "cursor-grab active:cursor-grabbing" : "cursor-default")}
      style={{ ...style, left: `calc(${col * width}% + 2px)`, width: `calc(${width}% - 5px)`, "--c": item.color } as CSSProperties}
    >
      <p className={cn("flex items-center gap-1 truncate font-medium", height < 30 ? "text-2xs leading-[14px]" : "text-xs")}>
        {!mine && <Lock className="size-2.5 shrink-0 opacity-60" />}
        {item.agenda?.account === "aer" && <span className="shrink-0 rounded-[3px] bg-ink/10 px-1 font-mono text-3xs leading-[13px]" aria-label={t("Agenda AER")}>AER</span>}
        <span className="truncate">{item.title}</span>
      </p>
      {height >= 34 && (
        <p className="truncate font-mono text-3xs text-muted">
          {hhmm(item.start)} – {hhmm(item.end)}
          {item.exam ? " · exam" : ""}
          {item.unregistered ? ` · ${t("non inscrit")}` : ""}
        </p>
      )}
      {height >= 56 && (item.module || item.detail) && <p className="truncate text-3xs text-faint">{item.module ?? item.detail}</p>}
      {mine && (
        <>
          <span className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize" onPointerDown={(e) => onGrab(e, item, "start")} />
          <span className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" onPointerDown={(e) => onGrab(e, item, "end")} />
        </>
      )}
    </div>
  );
}
