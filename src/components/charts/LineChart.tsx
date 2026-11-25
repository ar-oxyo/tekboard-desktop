// Line chart in plain SVG: up to four series against a numeric x (input size), optional
// log scales, spread band (min–max) per point, a legend plus direct end labels, and a
// crosshair tooltip. Colours follow the series, text stays in the theme's ink.
import { useMemo, useRef, useState } from "react";
import { compact, linear, log, nearest, SERIES_COLORS } from "../../lib/charts";
import { cn } from "../ui";

export interface ChartPoint {
  x: number;
  y: number;
  lo?: number;
  hi?: number;
}

export interface ChartSeries {
  id: string;
  label: string;
  /** Slot in SERIES_COLORS (fixed per entity, never by rank). */
  slot: number;
  /** Dashed line: a second encoding next to colour (variant B). */
  dashed?: boolean;
  points: ChartPoint[];
}

interface Props {
  series: ChartSeries[];
  xLabel: string;
  yLabel: string;
  formatY: (v: number) => string;
  logX?: boolean;
  logY?: boolean;
  height?: number;
  className?: string;
}

const M = { top: 12, right: 92, bottom: 34, left: 58 };

export function LineChart({ series, xLabel, yLabel, formatY, logX, logY, height = 220, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 560;
  const all = series.flatMap((s) => s.points);
  const xs = useMemo(() => [...new Set(all.map((p) => p.x))].sort((a, b) => a - b), [all]);
  if (all.length === 0) return null;
  const ys = all.flatMap((p) => [p.y, p.hi ?? p.y]).filter((v) => v > 0 || !logY);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const sx = logX ? log(x0, x1, M.left, width - M.right) : linear(x0, x1, M.left, width - M.right, false, 6);
  const sy = logY ? log(Math.min(...ys), Math.max(...ys), height - M.bottom, M.top) : linear(0, Math.max(...ys), height - M.bottom, M.top);
  const path = (pts: ChartPoint[]) => pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
  const band = (pts: ChartPoint[]) => {
    const withBand = pts.filter((p) => p.lo !== undefined && p.hi !== undefined);
    if (withBand.length < 2) return null;
    const top = withBand.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.hi!).toFixed(1)}`).join("");
    const bottom = [...withBand].reverse().map((p) => `L${sx(p.x).toFixed(1)},${sy(Math.max(p.lo!, logY ? 1e-12 : 0)).toFixed(1)}`).join("");
    return `${top}${bottom}Z`;
  };
  const onMove = (e: React.MouseEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * width;
    const pxs = xs.map((x) => sx(x));
    setHover(nearest(pxs, px));
  };
  const hx = hover !== null ? xs[hover] : null;
  const xTicks = (logX ? sx.ticks : sx.ticks).filter((t) => t >= sx.domain[0] && t <= sx.domain[1]);
  return (
    <div className={cn("relative", className)}>
      {series.length > 1 && (
        <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden>
                <line x1="0" y1="3" x2="18" y2="3" stroke={SERIES_COLORS[s.slot % SERIES_COLORS.length]} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div ref={box} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} className="block w-full" role="img" aria-label={`${yLabel} / ${xLabel}`}>
          {sy.ticks.map((t) => (
            <g key={`y${t}`}>
              <line x1={M.left} x2={width - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--color-line)" strokeOpacity="0.5" strokeWidth="1" />
              <text x={M.left - 6} y={sy(t) + 3} textAnchor="end" fontSize="10" fill="var(--color-faint)">
                {formatY(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={`x${t}`} x={sx(t)} y={height - M.bottom + 14} textAnchor="middle" fontSize="10" fill="var(--color-faint)">
              {compact(t)}
            </text>
          ))}
          <text x={(M.left + width - M.right) / 2} y={height - 4} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
            {xLabel}
            {logX ? " (log)" : ""}
          </text>
          <text x={12} y={(height - M.bottom + M.top) / 2} textAnchor="middle" fontSize="10" fill="var(--color-muted)" transform={`rotate(-90 12 ${(height - M.bottom + M.top) / 2})`}>
            {yLabel}
            {logY ? " (log)" : ""}
          </text>
          {series.map((s) => {
            const color = SERIES_COLORS[s.slot % SERIES_COLORS.length];
            const b = band(s.points);
            return b ? <path key={`b${s.id}`} d={b} fill={color} fillOpacity="0.12" stroke="none" /> : null;
          })}
          {hx !== null && <line x1={sx(hx)} x2={sx(hx)} y1={M.top} y2={height - M.bottom} stroke="var(--color-muted)" strokeOpacity="0.6" strokeWidth="1" />}
          {series.map((s) => {
            const color = SERIES_COLORS[s.slot % SERIES_COLORS.length];
            const last = s.points[s.points.length - 1];
            return (
              <g key={s.id}>
                <path d={path(s.points)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "6 4" : undefined} />
                {s.points.map((p) => (
                  <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r={p.x === hx ? 4.5 : 3} fill={color} stroke="var(--color-surface)" strokeWidth="2" />
                ))}
                {last && (
                  <text x={sx(last.x) + 8} y={sy(last.y) + 3} fontSize="10" fill="var(--color-muted)">
                    {s.label.length > 14 ? `${s.label.slice(0, 13)}…` : s.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {hx !== null && (
        <div className="pointer-events-none absolute top-6 rounded-md border border-line bg-raised px-2.5 py-1.5 text-[11px] shadow-lg" style={{ left: `${Math.min(70, (sx(hx) / width) * 100)}%` }}>
          <p className="mb-0.5 text-faint">
            {xLabel} = {compact(hx)}
          </p>
          {series.map((s) => {
            const p = s.points.find((q) => q.x === hx);
            return p ? (
              <p key={s.id} className="flex items-center gap-1.5 text-fg">
                <span className="size-2 rounded-full" style={{ background: SERIES_COLORS[s.slot % SERIES_COLORS.length] }} />
                <span className="text-muted">{s.label}</span>
                <span className="ml-auto pl-3 tabular">{formatY(p.y)}</span>
              </p>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
