// The captures linked to a project, in its sheet: a short list and a button to note one.
import { useQuery } from "@tanstack/react-query";
import { Lightbulb, PenLine } from "lucide-react";
import { api } from "../../lib/api";
import { CTYPE_LABEL, KIND_LABEL } from "../../lib/brain";
import { useUi } from "../../lib/store";
import { t } from "../../lib/i18n";
import { Button } from "../../components/ui";

export function ProjectCaptures({ project }: { project: string }) {
  const list = useQuery({ queryKey: ["brain", "project", project], queryFn: () => api.brainList({ view: "kept", project, limit: 8 }) });
  const items = list.data ?? [];
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs text-muted">{t("Captures du projet")}</span>
        <Button size="sm" variant="ghost" icon={<PenLine className="size-3.5" />} onClick={() => useUi.getState().setCaptureOpen(true, project)}>
          {t("Capturer une idée")}
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-faint">{t("Aucune capture liée à ce projet. Ctrl+I, puis associe-la depuis l'Inbox, ou capture d'ici.")}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => useUi.getState().openInbox({ view: "all", focus: c.id })} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] text-muted hover:bg-white/4 hover:text-fg">
                <Lightbulb className="size-3.5 shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="text-[11px] text-faint">{c.kind === "idea" ? CTYPE_LABEL[c.ctype || "idea"] : KIND_LABEL[c.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
