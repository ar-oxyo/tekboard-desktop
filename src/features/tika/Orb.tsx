// Tika's face: a small orb whose motion says what it is doing. Calm when idle, a turning
// ring while it thinks, a quick pulse while a tool acts, a dot when something waits for you.
import { cn } from "../../components/ui";

export type OrbState = "idle" | "thinking" | "acting" | "attention" | "error";

export function Orb({ state = "idle", size = 28, className }: { state?: OrbState; size?: number; className?: string }) {
  return (
    <span className={cn("tika-orb", `tika-${state}`, className)} style={{ width: size, height: size }} aria-hidden>
      <span className="tika-core" />
      <span className="tika-ring" />
      {state === "attention" && <span className="tika-dot" />}
    </span>
  );
}
