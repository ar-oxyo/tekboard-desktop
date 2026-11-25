import { describe, expect, it } from "vitest";
import type { ArenaResults, ArenaSeries } from "./api";
import { chartSeries, doubling, emptyConfig, fitLabel, mergeGenerated, parseSizes, ratioAt } from "./arena";

const point = (n: number, ms: number, extra: Partial<ArenaSeries["points"][number]> = {}) => ({ n, samples: [], wall: { median: ms, mad: 0, min: ms * 0.9, max: ms * 1.1, outliers: [] }, cpu: null, maxRssKb: 1000, ir: n * n, failed: null, ...extra });
const series = (variant: number, scenario: number, pts: ReturnType<typeof point>[]): ArenaSeries => ({ variant, scenario, points: pts, fitTime: null, fitIr: null, hot: null, profiledN: null, heapPeak: null, heap: null });

describe("arena helpers", () => {
  it("reads size lists", () => {
    expect(parseSizes("1000, 2k 4000;8000")).toEqual([1000, 2000, 4000, 8000]);
    expect(parseSizes("1e3, 1000, 2.5k")).toEqual([1000, 2500]);
    expect(typeof parseSizes("12, abc")).toBe("string");
    expect(typeof parseSizes("0")).toBe("string");
    expect(typeof parseSizes("")).toBe("string");
    expect(doubling(500, 4)).toEqual([500, 1000, 2000, 4000]);
  });

  it("builds chart series with stable colours and skips failed points", () => {
    const config = { ...emptyConfig(), scenarios: [emptyConfig().scenarios[0]] };
    const r = { config, variants: ["A", "B"], series: [series(0, 0, [point(10, 1), point(20, 4)]), series(1, 0, [point(10, 2), point(20, 3, { failed: "boom", wall: null })])], hypotheses: [], inputs: [], notes: [], machine: { cpu: null, cores: 1, load: null } } as ArenaResults;
    const s = chartSeries(r, "wall");
    expect(s.map((x) => [x.label, x.slot, x.dashed, x.points.length])).toEqual([["A", 0, false, 2], ["B", 1, true, 1]]);
    expect(chartSeries(r, "ir")[0].points[1].y).toBe(400);
    expect(ratioAt(r.series[0], r.series[1])).toEqual({ n: 10, ratio: 2 });
  });

  it("words the complexity with its confidence", () => {
    expect(fitLabel({ model: "O(n²)", confidence: "likely", exponent: 2, candidates: [], why: "" }).tone).toBe("ok");
    expect(fitLabel({ model: "O(n)", confidence: "uncertain", exponent: 1, candidates: [], why: "" }).tone).toBe("warn");
    expect(fitLabel(null).tone).toBe("neutral");
  });

  it("merges what Artix generated without duplicating files", () => {
    const c = emptyConfig();
    const m = mergeGenerated(c, [{ name: "gen.py", content: "new", library: null }, { name: "edge.py", content: "e", library: null }], [{ name: "triés", generator: "edge.py", sizes: [10], seed: 1, args: "{input}", stdin: false }]);
    expect(m.files.map((f) => f.name).sort()).toEqual(["edge.py", "gen.py"]);
    expect(m.files.find((f) => f.name === "gen.py")?.content).toBe("new");
    expect(m.scenarios).toHaveLength(2);
  });
});
