// Scales and ticks for the hand-drawn SVG charts (no chart library). Pure, tested in charts.test.ts.

/** Categorical series colours, in this fixed order, never cycled (validated for colour-blind
 *  separation and 3:1 contrast on TekBoard's dark surfaces with the dataviz palette checker). */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];

export interface Scale {
  (v: number): number;
  ticks: number[];
  domain: [number, number];
}

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
}

/** Linear scale from [lo, hi] (padded to round ticks, starting at 0 when `zero`) to [a, b]. */
export function linear(lo: number, hi: number, a: number, b: number, zero = true, count = 5): Scale {
  let min = zero ? Math.min(0, lo) : lo;
  let max = hi;
  if (!(max > min)) max = min + 1;
  const step = niceStep(max - min, count);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  const f = ((v: number) => a + ((v - min) / (max - min)) * (b - a)) as Scale;
  f.ticks = ticks;
  f.domain = [min, max];
  return f;
}

/** Log10 scale (values must be > 0); ticks on powers of ten, plus 2 and 5 when the range is short. */
export function log(lo: number, hi: number, a: number, b: number): Scale {
  const min = Math.floor(Math.log10(Math.max(lo, 1e-12)));
  let max = Math.ceil(Math.log10(Math.max(hi, lo, 1e-12)));
  if (max <= min) max = min + 1;
  const ticks: number[] = [];
  for (let e = min; e <= max; e++) {
    ticks.push(10 ** e);
    if (max - min <= 2 && e < max) ticks.push(2 * 10 ** e, 5 * 10 ** e);
  }
  const f = ((v: number) => a + ((Math.log10(Math.max(v, 1e-12)) - min) / (max - min)) * (b - a)) as Scale;
  f.ticks = ticks.sort((x, y) => x - y);
  f.domain = [10 ** min, 10 ** max];
  return f;
}

/** Short number: 1.2k, 3.4M, 0.25. */
export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toPrecision(3)}G`;
  if (a >= 1e6) return `${+(v / 1e6).toPrecision(3)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toPrecision(3)}k`;
  if (a >= 1) return `${+v.toPrecision(4)}`;
  if (a === 0) return "0";
  return `${+v.toPrecision(2)}`;
}

/** Milliseconds in the unit that reads best. */
export function duration(ms: number): string {
  if (ms >= 1000) return `${+(ms / 1000).toPrecision(3)} s`;
  if (ms >= 1) return `${+ms.toPrecision(3)} ms`;
  return `${+(ms * 1000).toPrecision(3)} µs`;
}

export function bytes(n: number): string {
  if (n >= 1 << 30) return `${+(n / (1 << 30)).toPrecision(3)} Gio`;
  if (n >= 1 << 20) return `${+(n / (1 << 20)).toPrecision(3)} Mio`;
  if (n >= 1 << 10) return `${+(n / (1 << 10)).toPrecision(3)} Kio`;
  return `${n} o`;
}

/** Index of the x closest to `x` in a sorted list. */
export function nearest(xs: number[], x: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  return best;
}
