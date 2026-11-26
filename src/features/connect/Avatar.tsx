// A person's face in lists: their character (one of the ready-made avatars or their own),
// else their initials on a colour drawn from their fingerprint. A dot tells whether they are
// connected.
import type { ConnectProfile } from "../../lib/api";
import { cn } from "../../components/ui";
import { SERIES_COLORS } from "../../lib/charts";
import { decodeLook } from "../space/avatar";
import { AvatarCanvas, isLook } from "../space/avatars";

export function Avatar({ profile, fp, size = 32, online }: { profile: ConnectProfile; fp: string; size?: number; online?: boolean }) {
  const initials = profile.nick.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
  const color = SERIES_COLORS[parseInt(fp.slice(0, 2) || "0", 16) % SERIES_COLORS.length];
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {isLook(profile.avatar) ? (
        <span className="flex size-full items-center justify-center overflow-hidden rounded-full bg-ink/8">
          <AvatarCanvas look={decodeLook(profile.avatar, fp)} size={Math.round(size * 1.3)} className="translate-y-[24%]" />
        </span>
      ) : (
        <span className="flex size-full items-center justify-center rounded-full font-medium text-white" style={{ background: color, fontSize: size * 0.38 }} aria-hidden>
          {initials}
        </span>
      )}
      {online !== undefined && <span className={cn("absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-(--color-surface)", online ? "bg-ok" : "bg-faint")} />}
    </span>
  );
}
