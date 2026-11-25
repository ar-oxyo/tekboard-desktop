// What the Playground keeps while TekBoard runs: the drafts being edited (saved a moment
// after each keystroke), the open file of each draft, and the last run of each draft.
import { create } from "zustand";
import { api, type Draft } from "../../lib/api";

interface PlaygroundState {
  active: number | null;
  /** Working copies: what the editor shows, ahead of the database by at most a second. */
  edits: Record<number, Draft>;
  file: Record<number, string>;
  job: Record<number, number>;
  /** Drafts whose working copy is not saved yet. */
  dirty: Record<number, boolean>;
  setActive: (id: number | null) => void;
  edit: (d: Draft) => void;
  setFile: (id: number, name: string) => void;
  setJob: (id: number, job: number) => void;
  forget: (id: number) => void;
}

const timers = new Map<number, number>();

function omit<T>(map: Record<number, T>, id: number): Record<number, T> {
  const next = { ...map };
  delete next[id];
  return next;
}

/** Saves a draft now (before a run, when leaving). */
export async function flush(id: number): Promise<void> {
  const t = timers.get(id);
  if (t !== undefined) window.clearTimeout(t);
  timers.delete(id);
  const s = usePlayground.getState();
  const d = s.edits[id];
  if (!d || !s.dirty[id]) return;
  await api.playgroundSave(d.id, d.title, d.files, d.settings);
  usePlayground.setState((st) => ({ dirty: { ...st.dirty, [id]: false } }));
}

export const usePlayground = create<PlaygroundState>((set) => ({
  active: null,
  edits: {},
  file: {},
  job: {},
  dirty: {},
  setActive: (active) => set({ active }),
  edit: (d) => {
    set((s) => ({ edits: { ...s.edits, [d.id]: d }, dirty: { ...s.dirty, [d.id]: true } }));
    const prev = timers.get(d.id);
    if (prev !== undefined) window.clearTimeout(prev);
    timers.set(d.id, window.setTimeout(() => void flush(d.id).catch(() => undefined), 800));
  },
  setFile: (id, name) => set((s) => ({ file: { ...s.file, [id]: name } })),
  setJob: (id, job) => set((s) => ({ job: { ...s.job, [id]: job } })),
  forget: (id) => set((s) => ({ edits: omit(s.edits, id), file: omit(s.file, id), dirty: omit(s.dirty, id) })),
}));
