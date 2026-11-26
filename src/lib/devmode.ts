// Turning the developer mode on, like Android: seven taps on the version number (Settings →
// About), each less than `GAP_MS` after the previous one. Pure, tested in devmode.test.ts.

export const TAPS_NEEDED = 7;
/** Longer than this between two taps and the count starts again. */
export const GAP_MS = 1500;
/** From this tap on, the remaining count is shown ("3 more"). */
export const HINT_FROM = 3;

export interface TapState {
  count: number;
  last: number;
}

export const NO_TAPS: TapState = { count: 0, last: 0 };

export type TapResult = { state: TapState; remaining: number; done: boolean };

/** One tap at `now` (milliseconds). `done` once, on the seventh tap in a row. */
export function tap(state: TapState, now: number): TapResult {
  const count = state.count > 0 && now - state.last <= GAP_MS ? state.count + 1 : 1;
  if (count >= TAPS_NEEDED) return { state: NO_TAPS, remaining: 0, done: true };
  return { state: { count, last: now }, remaining: TAPS_NEEDED - count, done: false };
}

/** Whether the remaining count is worth showing after this tap. */
export const showsHint = (r: TapResult) => !r.done && TAPS_NEEDED - r.remaining >= HINT_FROM;
