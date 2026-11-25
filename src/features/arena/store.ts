// Algorithm Arena state kept while TekBoard runs: the benchmark being edited and the jobs
// it started (a benchmark run, Artix building the environment, Artix's report).
import { create } from "zustand";
import type { BenchConfig } from "../../lib/api";
import { emptyConfig } from "../../lib/arena";

interface ArenaState {
  config: BenchConfig;
  savedId: number | null;
  runJob: number | null;
  aiJob: number | null;
  reportJob: number | null;
  /** A finished run from the history, shown instead of the live one. */
  viewRun: number | null;
  set: (patch: Partial<Omit<ArenaState, "set">>) => void;
}

export const useArena = create<ArenaState>((set) => ({
  config: emptyConfig(),
  savedId: null,
  runJob: null,
  aiJob: null,
  reportJob: null,
  viewRun: null,
  set: (patch) => set(patch),
}));
