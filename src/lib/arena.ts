// Algorithm Arena: what the screen computes itself (defaults, size lists, chart series,
// complexity wording). Pure functions, tested in arena.test.ts.
import type { ArenaFit, ArenaResults, ArenaScenario, ArenaSeries, BenchConfig, DraftFile } from "./api";
import type { ChartSeries } from "../components/charts/LineChart";
import { t } from "./i18n";

export const DEFAULT_OPTIONS = { repeats: 5, warmup: true, callgrind: true, massif: true, heap: true, timeoutS: 30, memMb: 1024 };

/** A generator that reads N, SEED, OUTPUT — the convention every generator follows. */
export const STARTER_GENERATOR = `import random
import sys

# Called as: gen.py N SEED OUTPUT — writes data of size N, reproducible with SEED.
n, seed, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
random.seed(seed)
with open(out, "w") as f:
    f.write(f"{n}\\n")
    f.write(" ".join(str(random.randint(0, 1_000_000)) for _ in range(n)))
    f.write("\\n")
`;

export function newScenario(files: DraftFile[]): ArenaScenario {
  const gen = files.find((f) => f.name.endsWith(".py") || f.name.endsWith(".c"))?.name ?? null;
  return { name: t("Aléatoire"), generator: gen, sizes: [1000, 2000, 4000, 8000, 16000], seed: 42, args: gen ? "{input}" : "{n}", stdin: false };
}

export function emptyConfig(): BenchConfig {
  const files: DraftFile[] = [{ name: "gen.py", content: STARTER_GENERATOR, library: null }];
  return { name: t("Nouveau benchmark"), variants: [], scenarios: [newScenario(files)], files, options: { ...DEFAULT_OPTIONS } };
}

/** "1000, 2k, 4 000, 1e4" → sorted unique sizes. `null` with a reason when something is not a size. */
export function parseSizes(text: string): number[] | string {
  const out = new Set<number>();
  for (const raw of text.split(/[,;\s]+(?=[\d])|[,;]/).map((s) => s.trim().replace(/\s/g, "")).filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?)(k|m)?$/i.exec(raw) ?? /^(\d+(?:\.\d+)?e\d+)$/i.exec(raw);
    if (!m) return t("« {v} » n'est pas une taille", { v: raw });
    const mult = m[2]?.toLowerCase() === "k" ? 1e3 : m[2]?.toLowerCase() === "m" ? 1e6 : 1;
    const v = Math.round(Number(m[1]) * mult);
    if (!(v >= 1 && v <= 1e9)) return t("Les tailles vont de 1 à 1 000 000 000");
    out.add(v);
  }
  if (out.size === 0) return t("Au moins une taille");
  if (out.size > 12) return t("12 tailles au plus");
  return [...out].sort((a, b) => a - b);
}

/** Geometric sizes: `count` sizes from `from`, each `factor` times the previous one. */
export function doubling(from: number, count: number, factor = 2): number[] {
  return Array.from({ length: count }, (_, i) => Math.round(from * factor ** i));
}

export function seriesLabel(r: ArenaResults, s: ArenaSeries): string {
  const scenario = r.config?.scenarios[s.scenario]?.name ?? `#${s.scenario + 1}`;
  const variant = r.variants[s.variant] ?? `#${s.variant + 1}`;
  const many = (r.config?.scenarios.length ?? 1) > 1;
  return r.variants.length > 1 ? (many ? `${variant} · ${scenario}` : variant) : scenario;
}

export type Metric = "wall" | "cpu" | "rss" | "ir";

/** Chart series for a metric. Colour slot = scenario (stable), dashes = second variant. */
export function chartSeries(r: ArenaResults, metric: Metric): ChartSeries[] {
  return r.series
    .map((s) => ({
      id: `${s.variant}-${s.scenario}`,
      label: seriesLabel(r, s),
      slot: r.variants.length > 1 && (r.config?.scenarios.length ?? 1) === 1 ? s.variant : s.scenario,
      dashed: s.variant === 1,
      points: s.points.flatMap((p) => {
        if (p.failed) return [];
        if (metric === "wall" && p.wall) return [{ x: p.n, y: p.wall.median, lo: p.wall.min, hi: p.wall.max }];
        if (metric === "cpu" && p.cpu) return [{ x: p.n, y: p.cpu.median, lo: p.cpu.min, hi: p.cpu.max }];
        if (metric === "rss" && p.maxRssKb !== null) return [{ x: p.n, y: p.maxRssKb }];
        if (metric === "ir" && p.ir !== null) return [{ x: p.n, y: p.ir }];
        return [];
      }),
    }))
    .filter((s) => s.points.length > 0);
}

export function fitLabel(f: ArenaFit | null | undefined): { text: string; tone: "ok" | "warn" | "neutral" } {
  if (!f || !f.model || f.confidence === "insufficient") return { text: t("indéterminée"), tone: "neutral" };
  return f.confidence === "likely" ? { text: t("{m} probable", { m: f.model }), tone: "ok" } : { text: t("{m} ?", { m: f.model }), tone: "warn" };
}

/** Speed ratio of variant B over A at the largest size both measured (>1: B is slower). */
export function ratioAt(a: ArenaSeries | undefined, b: ArenaSeries | undefined): { n: number; ratio: number } | null {
  if (!a || !b) return null;
  const common = a.points.filter((p) => p.wall && b.points.some((q) => q.n === p.n && q.wall)).map((p) => p.n);
  if (common.length === 0) return null;
  const n = Math.max(...common);
  const pa = a.points.find((p) => p.n === n)!.wall!.median;
  const pb = b.points.find((p) => p.n === n)!.wall!.median;
  return pa > 0 ? { n, ratio: pb / pa } : null;
}

/**
 * Merges what Artix generated into a config: its files replace same-named ones, its
 * scenarios are added (a scenario of the same name is replaced) and its hypotheses are kept
 * with the benchmark, so the results show them next to the measurements.
 */
export function mergeGenerated(c: BenchConfig, files: DraftFile[], scenarios: ArenaScenario[], hypotheses: NonNullable<BenchConfig["hypotheses"]> = []): BenchConfig {
  const names = new Set(files.map((f) => f.name));
  const scen = new Set(scenarios.map((s) => s.name));
  const seen = new Set((c.hypotheses ?? []).map((h) => `${h.function}|${h.message}`));
  return {
    ...c,
    files: [...c.files.filter((f) => !names.has(f.name)), ...files],
    scenarios: [...c.scenarios.filter((s) => !scen.has(s.name)), ...scenarios].slice(0, 6),
    hypotheses: [...(c.hypotheses ?? []), ...hypotheses.filter((h) => !seen.has(`${h.function}|${h.message}`))].slice(0, 30),
  };
}

/** The hypotheses of a run, split into the project's own code and its libraries. */
export function splitHypotheses<H extends { scope?: string }>(all: H[]): { project: H[]; library: H[] } {
  return { project: all.filter((h) => h.scope !== "library"), library: all.filter((h) => h.scope === "library") };
}
