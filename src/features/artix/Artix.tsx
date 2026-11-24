// Artix's face: a small robot drawn in the colours of the current design. Its motion says
// what it is doing, without words and without taking room:
// - idle: floats gently and blinks now and then;
// - thinking: looks around, its antenna light pulses;
// - working: eyes narrowed on the task, a quick bob, a spark turning by the antenna;
// - success: happy eyes and one hop;
// - error: worried eyes, red light, a small tilt;
// - attention: an amber light, something waits for you.
// Reduced motion keeps the faces and drops the movement.
import { cn } from "../../components/ui";

export type ArtixState = "idle" | "thinking" | "working" | "success" | "error" | "attention";

export function Artix({ state = "idle", size = 28, className, label }: { state?: ArtixState; size?: number; className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={cn("artix", `artix-${state}`, className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <g className="artix-figure">
        <line x1="16" y1="9.5" x2="16" y2="5.6" className="artix-stem" />
        <circle cx="16" cy="4.4" r="2" className="artix-light" />
        <circle cx="6.2" cy="17.5" r="1.6" className="artix-ear" />
        <circle cx="25.8" cy="17.5" r="1.6" className="artix-ear" />
        <rect x="6.5" y="9" width="19" height="17" rx="7" className="artix-body" />
        <rect x="9.4" y="12.6" width="13.2" height="9.4" rx="4.4" className="artix-face" />
        {state === "success" ? (
          <path d="M11.6 17.8q1.4-2 2.8 0M17.6 17.8q1.4-2 2.8 0" className="artix-arc" />
        ) : state === "error" ? (
          <path d="M11.7 16.2l2.6 1.1M20.3 16.2l-2.6 1.1M13.9 20.2h4.2" className="artix-arc" />
        ) : (
          <g className="artix-eyes">
            <rect x="11.8" y="15.2" width="2.6" height="3.8" rx="1.3" className="artix-eye" />
            <rect x="17.6" y="15.2" width="2.6" height="3.8" rx="1.3" className="artix-eye" />
          </g>
        )}
        {state === "working" && <path d="M19.4 2.6a3.6 3.6 0 0 1 0 3.6" className="artix-spark" />}
      </g>
    </svg>
  );
}
