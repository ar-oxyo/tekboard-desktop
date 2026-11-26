// An invitation to a TekSpace space, as a card: a small plan of the campus where the space
// runs, who invites, how many are there, and one action to enter.
import { useEffect, useRef } from "react";
import { Button } from "../../components/ui";
import { timeAgo } from "../../lib/format";
import { plural, t } from "../../lib/i18n";
import { H, MAP, TABLES, W } from "./map";
import type { Hosted } from "./lobby";

const CELL = 3;

/** The campus plan, drawn small: rooms, walls and tables. Pixel art, its own fixed colours. */
export function MiniCampus({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    const colours: Record<string, string> = { wall: "#2b2a33", wood: "#8d6e63", carpet: "#5c6bc0", tile: "#90a4ae", library: "#6d4c41", focus: "#4db6ac", meeting: "#ba68c8" };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        c.fillStyle = colours[MAP.floor[y][x]] ?? "#2b2a33";
        c.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    c.fillStyle = "#ffcc80";
    for (const tb of TABLES) c.fillRect(tb.x * CELL, tb.y * CELL, tb.w * CELL, tb.h * CELL);
  }, []);
  return <canvas ref={ref} width={W * CELL} height={H * CELL} className={className} style={{ imageRendering: "pixelated" }} aria-hidden />;
}

export function InviteCard({ invite, busy, onJoin, onDismiss, disabledReason }: { invite: Hosted; busy?: boolean; onJoin: () => void; onDismiss: () => void; disabledReason?: string | null }) {
  return (
    <div className="anim-rise flex items-center gap-4 rounded-(--radius-card) border border-line bg-surface p-3">
      <MiniCampus className="h-[54px] w-[90px] shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{t("{n} t'invite", { n: invite.hostNick || t("Quelqu'un") })}</p>
        <p className="truncate text-base font-medium text-fg">{invite.name || "TekSpace"}</p>
        <p className="text-xs text-faint">
          {plural(invite.count, "{n} personne", "{n} personnes")} · {timeAgo(Math.floor(invite.at / 1000))}
        </p>
      </div>
      <Button variant="primary" busy={busy} disabled={!!disabledReason} disabledReason={disabledReason ?? null} onClick={onJoin}>
        {t("Entrer")}
      </Button>
      <Button variant="ghost" onClick={onDismiss}>
        {t("Plus tard")}
      </Button>
    </div>
  );
}
