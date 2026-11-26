// Planning settings, out of the way of planning itself: the rhythm (hours, working days,
// sessions, breaks, margin before a hand-in) and the calendar's categories and projects.
// Opened from the gear of the planning bar; what is shown day to day stays in the filter menu.
import { useState } from "react";
import { Modal } from "../../components/Modal";
import { Button, cn } from "../../components/ui";
import { t } from "../../lib/i18n";
import { CategorySettings } from "./CalendarSettings";
import { RhythmSettings } from "./Dialogs";

export type PlanSettingsTab = "rhythm" | "calendar";

const TABS: Array<[PlanSettingsTab, string]> = [
  ["rhythm", t("Rythme et disponibilités")],
  ["calendar", t("Catégories et projets")],
];

export function PlanSettingsDialog({ onClose, tab: initial = "rhythm" }: { onClose: () => void; tab?: PlanSettingsTab }) {
  const [tab, setTab] = useState<PlanSettingsTab>(initial);
  return (
    <Modal open onClose={onClose} title={t("Réglages du planning")} width="w-[600px]" footer={<Button variant="primary" onClick={onClose}>{t("Terminé")}</Button>}>
      <div role="tablist" aria-label={t("Réglages du planning")} className="-mt-1 mb-4 flex gap-4 border-b border-line">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("-mb-px h-9 border-b-2 text-sm transition-colors duration-(--dur-fast)", tab === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
            {label}
          </button>
        ))}
      </div>
      <div key={tab} className="anim-fade">
        {tab === "rhythm" ? <RhythmSettings /> : <CategorySettings />}
      </div>
    </Modal>
  );
}
