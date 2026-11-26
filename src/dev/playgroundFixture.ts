// Development only: two Playground drafts and a finished comparison (?drafts=1).
const now = Math.floor(Date.now() / 1000);
const settings = { compiler: "gcc", flags: "-Wall -Wextra -O2", args: "", stdin: "", asan: false, ubsan: false, valgrind: false, timeoutS: 10, memMb: 256 };
const code = (body: string) => `#include <stdio.h>\n\nint main(void)\n{\n    long s = 0;\n\n${body}\n    printf("%ld\\n", s);\n    return 0;\n}\n`;

export const drafts = [
  { id: 1, title: "somme naïve", files: [{ name: "main.c", content: code("    for (long i = 0; i < 100000000; i++)\n        s += i % 7;"), library: null }], settings, open: true, createdAt: now - 3600, updatedAt: now - 60 },
  { id: 2, title: "somme naïve · B", files: [{ name: "main.c", content: code("    for (long i = 0; i < 100000000; i += 7)\n        s += 21;"), library: null }], settings, open: true, createdAt: now - 1800, updatedAt: now - 30 },
];

const stats = (median: number, mad: number) => ({ median, mad, min: median - mad * 2, max: median + mad * 3, outliers: [] });

export const compareJob = {
  id: 77,
  kind: "playground_compare",
  repo: null,
  title: "Playground · somme naïve / somme naïve · B",
  status: "success",
  steps: [
    { id: "build", label: "Compilation de A et B", status: "success", detail: null },
    { id: "run", label: "Exécution de A et B", status: "success", detail: "mêmes sorties" },
    { id: "bench", label: "Mesures alternées", status: "success", detail: "5 mesures par version" },
    { id: "verdict", label: "Comparaison", status: "success", detail: null },
  ],
  log: "",
  startedAt: now - 20,
  durationMs: 4200,
  summary: {
    sameOutput: true,
    sameCode: true,
    run_a: { exitCode: 0, signalName: null, timedOut: false, stdout: "299999997\n", stderr: "", durationMs: 312 },
    run_b: { exitCode: 0, signalName: null, timedOut: false, stdout: "299999997\n", stderr: "", durationMs: 48 },
    bench_a: { runs: 5, wall: stats(298.4, 2.1), cpu: stats(297.9, 2.0), maxRssKb: 1420, spread: 0.0104 },
    bench_b: { runs: 5, wall: stats(42.7, 0.6), cpu: stats(42.4, 0.5), maxRssKb: 1416, spread: 0.0208 },
    verdict: { faster: "b", ratio: 6.99, significant: true, why: "écart de 598.8 % pour un bruit d'environ 2.1 %" },
  },
  runId: 12,
  events: [],
  logTotal: 0,
};
