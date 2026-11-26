// A presence status as people see it: a coloured dot and its word, or for "En pause" a small
// cup, so a break reads at a glance and is never mistaken for being away or busy.
import { Coffee } from "lucide-react";
import { Dot } from "../../components/ui";
import type { ConnectStatus } from "../../lib/api";
import { STATUS } from "../../lib/connect";

export function StatusLabel({ status }: { status: ConnectStatus }) {
  const s = STATUS[status] ?? STATUS.available;
  if (status === "break") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Coffee className="size-3 text-warn" aria-hidden />
        {s.label}
      </span>
    );
  }
  return <Dot tone={s.tone}>{s.label}</Dot>;
}
