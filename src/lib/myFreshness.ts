// When MY Epitech data counts as old: past a day. Pure, shared by the screens and their tests.

export const STALE_AFTER_S = 24 * 3600;

/** Is data read at `at` (seconds) too old at `now`? An unknown date is "never synced", not "stale". */
export function isStale(at: number | null | undefined, now = Date.now() / 1000): boolean {
  return at != null && now - at > STALE_AFTER_S;
}
