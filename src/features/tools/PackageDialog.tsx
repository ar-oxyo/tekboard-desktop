// Package for AI: choose a mode, review exactly what goes in, write the zip. Nothing is sent anywhere.
import { useMutation, useQuery } from "@tanstack/react-query";
import { FolderOpen, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "../../components/Modal";
import { Badge, Button, cn, ErrorNote, Input, Spinner } from "../../components/ui";
import { api, asAppError, type PackOptions } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { useUi } from "../../lib/store";

const MODES: Array<{ id: PackOptions["mode"]; label: string; hint: string }> = [
  { id: "context", label: "AI Context Pack", hint: "Source code plus PROJECT_CONTEXT.md, FILE_TREE.txt and a manifest written from the repository's facts." },
  { id: "source", label: "Source only", hint: "Source code and build configuration." },
  { id: "full", label: "Full project", hint: "Everything, assets included, except build products and secrets." },
];

export function PackageDialog({ repo }: { repo: string }) {
  const close = useUi((s) => s.closeTool);
  const toast = useUi((s) => s.toast);
  const [mode, setMode] = useState<PackOptions["mode"]>("context");
  const [exclude, setExclude] = useState<string[]>([]);
  const [include, setInclude] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [onlyOut, setOnlyOut] = useState(false);
  const options: PackOptions = useMemo(() => ({ mode, exclude, include }), [mode, exclude, include]);
  const preview = useQuery({ queryKey: ["pack-preview", repo, options], queryFn: () => api.packagePreview(repo, options), staleTime: 0, placeholderData: (prev) => prev });
  const create = useMutation({ mutationFn: () => api.packageCreate(repo, options), onError: (e) => toast({ kind: "error", title: "The archive was not created", detail: asAppError(e).message }) });
  const p = preview.data;
  const rows = (p?.entries ?? []).filter((e) => (!onlyOut || !e.included) && e.path.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (path: string, included: boolean) => {
    if (included) {
      setInclude(include.filter((x) => x !== path));
      setExclude([...exclude.filter((x) => x !== path), path]);
    } else {
      setExclude(exclude.filter((x) => x !== path));
      if (!include.includes(path)) setInclude([...include, path]);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      width="w-[820px]"
      title="Package for AI"
      description={repo.split("/").pop()}
      footer={
        create.data ? (
          <>
            <span className="selectable mr-auto min-w-0 truncate font-mono text-xs text-muted">{create.data.path}</span>
            <Button icon={<FolderOpen className="size-3.5" />} onClick={() => api.packageReveal().catch((e) => toast({ kind: "error", title: "Could not open the folder", detail: asAppError(e).message }))}>Open folder</Button>
            <Button variant="primary" onClick={close}>Done</Button>
          </>
        ) : (
          <>
            <span className="mr-auto text-xs text-muted">{p ? `${p.included} files · ${formatBytes(p.includedSize)} before compression` : ""}</span>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" busy={create.isPending} disabled={!p || p.included === 0} onClick={() => create.mutate()}>Create the ZIP</Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button key={m.id} type="button" onClick={() => { setMode(m.id); create.reset(); }} className={cn("rounded-lg border px-3 py-2 text-left transition-colors", mode === m.id ? "border-accent/50 bg-accent-soft" : "border-line hover:border-line-strong")}>
              <span className="block text-[13px] font-medium">{m.label}</span>
              <span className="mt-0.5 block text-xs text-muted">{m.hint}</span>
            </button>
          ))}
        </div>
        {create.data && <p className="rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-[13px] text-ok">Archive created: {create.data.files} files, {formatBytes(create.data.size)}. It stays on this computer until you share it yourself.</p>}
        {preview.error && <ErrorNote>{asAppError(preview.error).message}</ErrorNote>}
        {p && p.sensitive > 0 && (
          <p className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            <ShieldAlert className="mt-px size-3.5 shrink-0" />
            {p.sensitive} file{p.sensitive > 1 ? "s look" : " looks"} like a secret (by name, or because a token or private key was recognised inside). {p.sensitive > 1 ? "They are" : "It is"} left out and cannot be added.
          </p>
        )}
        <div className="flex items-center gap-2">
          <Input className="h-7 text-xs" placeholder="Filter files" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted"><input type="checkbox" className="accent-(--color-accent)" checked={onlyOut} onChange={(e) => setOnlyOut(e.target.checked)} />Only what is left out</label>
          {preview.isFetching && <Spinner />}
        </div>
        <ul className="max-h-[38vh] overflow-y-auto rounded-lg border border-line bg-bg py-1">
          {rows.length === 0 && <li className="px-3 py-3 text-xs text-muted">{p ? "No file matches." : "Reading the project…"}</li>}
          {rows.slice(0, 600).map((e) => (
            <li key={e.path}>
              <label className={cn("flex min-h-7 items-center gap-2.5 px-3 text-xs", e.sensitive ? "cursor-not-allowed" : "hover:bg-raised")}>
                <input type="checkbox" className="accent-(--color-accent)" checked={e.included} disabled={e.sensitive} onChange={() => toggle(e.path, e.included)} />
                <span className={cn("selectable min-w-0 flex-1 truncate font-mono", !e.included && "text-muted")}>{e.path}</span>
                {e.sensitive ? <Badge tone="warn">{e.reason}</Badge> : e.reason && <span className="shrink-0 text-faint">{e.reason}</span>}
                <span className="w-16 shrink-0 text-right text-faint">{formatBytes(e.size)}</span>
              </label>
            </li>
          ))}
          {rows.length > 600 && <li className="px-3 py-2 text-xs text-faint">{rows.length - 600} more — use the filter.</li>}
        </ul>
        {p && (p.skippedDirs.length > 0 || p.truncated) && (
          <p className="selectable text-xs text-faint">
            {p.skippedDirs.length > 0 && <>Folders skipped whole: {p.skippedDirs.join(", ")}. </>}
            {p.truncated && "This project has more files than TekBoard lists (20,000): the rest is not in the archive."}
          </p>
        )}
      </div>
    </Modal>
  );
}
