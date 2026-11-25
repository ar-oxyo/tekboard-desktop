// "Ce que je sais": every memory Artix keeps, to read, correct, pin or delete.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pin, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn, IconButton } from "../../components/ui";
import { api, asAppError, type Memory, type MemoryKind } from "../../lib/api";
import { useUi } from "../../lib/store";
import { projectName } from "./useScreen";
import { locale } from "../../lib/i18n";
import { t } from "../../lib/i18n";

export const KIND_LABEL: Record<MemoryKind, string> = { preference: "Préférence", goal: "Objectif", constraint: "Contrainte", decision: "Décision", difficulty: "Difficulté", next_step: t("Prochaine étape"), fact: t("Fait"), test_report: t("Rapport de tests") };

export function MemoryView({ project }: { project: string | null }) {
  const [onlyHere, setOnlyHere] = useState(false);
  const scope = onlyHere && project ? `project:${project}` : null;
  const list = useQuery({ queryKey: ["memory", scope], queryFn: () => api.memoryList(scope) });
  const [draft, setDraft] = useState("");
  const toast = useUi((s) => s.toast);
  const add = useMutation({ mutationFn: () => api.memoryAdd(project && onlyHere ? `project:${project}` : "global", "preference", draft, false), onSuccess: () => setDraft(""), onError: (e) => toast({ kind: "error", title: t("Non gardé"), detail: asAppError(e).message }) });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-ink/6 px-4 py-2.5 text-xs text-muted">
        <span className="flex-1">{t("Ce que Artix retient d'une conversation à l'autre. Jamais de secret.")}</span>
        {project && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-(--color-accent)" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} /> {projectName(project)}
          </label>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-3">
        {list.data?.length === 0 && <li className="px-1 text-sm text-muted">{t("Rien pour l'instant. Dis par exemple à Artix : « retiens que je ne travaille pas le dimanche ».")}</li>}
        {list.data?.map((m) => <Row key={m.id} m={m} />)}
      </ul>
      <form className="flex gap-2 border-t border-ink/6 p-3" onSubmit={(e) => (e.preventDefault(), draft.trim() && add.mutate())}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("Ajouter une préférence…")} className="field h-8 flex-1 rounded-lg border border-ink/8 px-2.5 text-sm focus:border-accent focus:outline-none" />
      </form>
    </div>
  );
}

function Row({ m }: { m: Memory }) {
  const [text, setText] = useState(m.content);
  const toast = useUi((s) => s.toast);
  const err = (e: unknown) => toast({ kind: "error", title: t("Non modifié"), detail: asAppError(e).message });
  const save = useMutation({ mutationFn: (patch: Parameters<typeof api.memoryUpdate>[1]) => api.memoryUpdate(m.id, patch), onError: err });
  const del = useMutation({ mutationFn: () => api.memoryDelete(m.id), onError: err });
  return (
    <li className="group row-hover flex items-start gap-2 rounded-lg px-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-2xs text-faint">
          {KIND_LABEL[m.kind]} · {m.scope === "global" ? "général" : projectName(m.scope.slice(8))}
          {m.expiresAt && ` · expire le ${new Date(m.expiresAt * 1000).toLocaleDateString(locale())}`}
        </p>
        <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== m.content && save.mutate({ content: text })} className="selectable w-full resize-none bg-transparent text-sm focus:outline-none" />
      </div>
      <IconButton label={m.pinned ? "Désépingler" : t("Épingler (toujours dans le contexte)")} active={m.pinned} onClick={() => save.mutate({ pinned: !m.pinned })}>
        <Pin className={cn("size-3.5", m.pinned && "fill-current")} />
      </IconButton>
      <IconButton label="Oublier" className="opacity-0 group-hover:opacity-100" onClick={() => del.mutate()}>
        <Trash2 className="size-3.5" />
      </IconButton>
    </li>
  );
}
