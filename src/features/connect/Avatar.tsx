// A person's face in lists: their TekSpace character when they made one, else their
// initials on a colour drawn from their fingerprint. A dot tells whether they are connected.
import type { ConnectProfile } from "../../lib/api";
import { cn } from "../../components/ui";
import { SERIES_COLORS } from "../../lib/charts";

export function Avatar({ profile, fp, size = 32, online }: { profile: ConnectProfile; fp: string; size?: number; online?: boolean }) {
  const initials = profile.nick.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
  const color = SERIES_COLORS[parseInt(fp.slice(0, 2) || "0", 16) % SERIES_COLORS.length];
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span className="flex size-full items-center justify-center rounded-full font-medium text-white" style={{ background: color, fontSize: size * 0.38 }} aria-hidden>
        {initials}
      </span>
      {online !== undefined && <span className={cn("absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-(--color-surface)", online ? "bg-ok" : "bg-faint")} />}
    </span>
  );
}
