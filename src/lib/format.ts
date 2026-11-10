/** "5 h ago" from an ISO date or a unix timestamp (seconds). Empty string when unparseable. */
export function timeAgo(when: string | number, now: Date = new Date()): string {
  const t = typeof when === "number" ? when * 1000 : Date.parse(when);
  if (Number.isNaN(t)) return "";
  const sec = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 31) return `${d} days ago`;
  const mo = Math.floor(d / 30.44);
  if (mo < 12) return `${mo} month${mo > 1 ? "s" : ""} ago`;
  const y = Math.floor(d / 365.25);
  return `${y} year${y > 1 ? "s" : ""} ago`;
}

/** Shortens the home prefix to `~` for display. */
export function tildify(path: string, home: string | null): string {
  if (home && (path === home || path.startsWith(home + "/"))) return "~" + path.slice(home.length);
  return path;
}

export function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  const last = trimmed.split(/[/:]/).pop() ?? "";
  return last.replace(/\.git$/, "");
}

/** Same shape the backend recognises: `G-CPE-110-LYN-1-1-project-27`. */
export function looksLikeEpitech(name: string): boolean {
  return /^[A-Z]-[A-Z]{3}-\d{3}-[A-Z]{3}-\d+-\d+-.+-\d+$/.test(name);
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
