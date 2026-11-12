import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Copy, FileText, FolderInput, LayoutTemplate, Pencil, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal";
import { Select } from "../../components/Select";
import { Badge, Button, Card, cn, EmptyState, ErrorNote, Field, Input, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type TemplateSummary } from "../../lib/api";
import { formatBytes, tildify } from "../../lib/format";
import { keys, useHome, useRepos, useSettings, useTemplates } from "../../lib/hooks";
import { repoOptions } from "../../lib/repos";
import { useUi } from "../../lib/store";

export function TemplatesPage() {
  const templates = useTemplates();
  const home = useHome();
  const sources = useQuery({ queryKey: ["template-sources"], queryFn: api.templateSources, staleTime: Infinity });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  const list = templates.data ?? [];
  const selected = list.find((t) => t.id === selectedId) ?? list[0] ?? null;

  async function browse() {
    const dir = await open({ directory: true, multiple: false, title: "Import a folder as a template" });
    if (typeof dir === "string") setImporting(dir);
  }

  // Offer known skeleton folders only while nothing was imported yet.
  const hasCustom = list.some((t) => !t.builtin);
  const offers = hasCustom ? [] : (sources.data ?? []);

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="Reusable project skeletons. Applying one copies files; nothing in a template is ever executed."
        actions={
          <Button variant="primary" icon={<FolderInput className="size-4" />} onClick={() => void browse()}>
            Import folder…
          </Button>
        }
      />

      {offers.map((dir) => (
        <div key={dir} className="mb-3 flex items-center gap-3 rounded-lg border border-accent/25 bg-accent-soft px-4 py-2.5">
          <LayoutTemplate className="size-4 shrink-0 text-accent" />
          <p className="min-w-0 flex-1 truncate text-[13px]">
            Existing skeleton found at <span className="selectable font-mono text-xs">{tildify(dir, home)}</span>
          </p>
          <Button size="sm" onClick={() => setImporting(dir)}>
            Import as template
          </Button>
        </div>
      ))}

      {templates.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted">
          <Spinner /> Loading…
        </p>
      ) : templates.error ? (
        <ErrorNote>{asAppError(templates.error).message}</ErrorNote>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<LayoutTemplate className="size-6" />} title="No template yet" action={<Button onClick={() => void browse()}>Import folder…</Button>}>
            Import any folder — a past project, your own skeleton — to reuse it for the next one.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-4">
          <ul className="flex flex-col gap-2">
            {list.map((t) => (
              <li key={t.id}>
                <TemplateCard template={t} active={selected?.id === t.id} onSelect={() => setSelectedId(t.id)} />
              </li>
            ))}
          </ul>
          {selected && <TemplateDetail key={selected.id} template={selected} onDeleted={() => setSelectedId(null)} onCreated={setSelectedId} />}
        </div>
      )}

      {importing && <ImportDialog source={importing} onClose={() => setImporting(null)} onImported={setSelectedId} />}
    </>
  );
}

function TemplateCard({ template, active, onSelect }: { template: TemplateSummary; active: boolean; onSelect: () => void }) {
  const settings = useSettings();
  const isDefault = settings.data?.defaultTemplate === template.id;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className="card card-interactive w-full px-3.5 py-3 text-left"
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{template.name}</span>
        {isDefault && <Star className="size-3.5 text-accent" fill="currentColor" aria-label="Default template" />}
      </span>
      <span className="mt-1 flex items-center gap-1.5">
        <Badge>{template.fileCount} files</Badge>
        {template.builtin && <Badge>built-in</Badge>}
      </span>
    </button>
  );
}

function TemplateDetail({ template, onDeleted, onCreated }: { template: TemplateSummary; onDeleted: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const openLauncher = useUi((s) => s.openLauncher);
  const settings = useSettings();
  const repos = useRepos((settings.data?.roots.length ?? 0) > 0);
  const files = useQuery({ queryKey: ["template-files", template.id], queryFn: () => api.templateFiles(template.id) });
  const [file, setFile] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });

  useEffect(() => {
    if (file === null && files.data && files.data.length > 0) {
      setFile((files.data.find((f) => f.rel === "Makefile") ?? files.data.find((f) => f.text) ?? files.data[0]).rel);
    }
  }, [files.data, file]);

  const preview = useQuery({ queryKey: ["template-file", template.id, file], queryFn: () => api.templateReadFile(template.id, file!), enabled: file !== null });
  const isDefault = settings.data?.defaultTemplate === template.id;

  const setDefault = useMutation({
    mutationFn: () => api.saveSettings({ ...settings.data!, defaultTemplate: isDefault ? null : template.id }),
    onSuccess: (saved) => qc.setQueryData(keys.settings, saved),
    onError: fail("Could not change the default template"),
  });
  const duplicate = useMutation({
    mutationFn: () => api.templateDuplicate(template.id, `${template.name} copy`),
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: keys.templates });
      onCreated(id);
    },
    onError: fail("Could not duplicate"),
  });
  const remove = useMutation({
    mutationFn: () => api.templateDelete(template.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.templates });
      void qc.invalidateQueries({ queryKey: keys.settings });
      onDeleted();
    },
    onError: fail("Could not delete"),
  });
  const edit = useMutation({ mutationFn: () => api.templateEdit(template.id), onError: fail("Could not open the IDE") });

  return (
    <Card className="min-w-0">
      <div className="border-b border-white/6 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold">{template.name}</h2>
          {template.variables.map((v) => (
            <Badge key={v} mono title="Variable replaced when the template is applied">
              {`{{${v}}}`}
            </Badge>
          ))}
        </div>
        {template.description && <p className="selectable mt-1 text-[13px] text-muted">{template.description}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select className="w-56" value={null} label="Apply to a project" placeholder="Apply to a project…" search onChange={(path) => path && openLauncher({ mode: "existing", path, templateId: template.id })} options={repoOptions(repos.data ?? [])} />
          <Button size="sm" variant="ghost" icon={<Star className="size-3.5" fill={isDefault ? "currentColor" : "none"} />} onClick={() => setDefault.mutate()}>
            {isDefault ? "Default for new projects" : "Set as default"}
          </Button>
          <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} title="Opens the template folder in your IDE" onClick={() => edit.mutate()}>
            Edit files
          </Button>
          <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} busy={duplicate.isPending} onClick={() => duplicate.mutate()}>
            Duplicate
          </Button>
          {armed ? (
            <>
              <Button size="sm" variant="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
                Delete for good
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setArmed(true)}>
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid h-[440px] grid-cols-[220px_minmax(0,1fr)]">
        <ul className="overflow-y-auto border-r border-white/6 py-1">
          {files.isLoading && (
            <li className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
              <Spinner /> Loading…
            </li>
          )}
          {(files.data ?? []).map((f) => (
            <li key={f.rel}>
              <button
                type="button"
                onClick={() => setFile(f.rel)}
                title={`${f.rel} · ${formatBytes(f.size)}`}
                className={cn("flex h-7 w-full items-center gap-2 px-3 text-left font-mono text-xs", file === f.rel ? "bg-raised text-fg" : "text-muted hover:bg-hover hover:text-fg")}
              >
                <FileText className="size-3 shrink-0 text-faint" />
                <span className="truncate" dir="rtl">
                  <bdi>{f.rel}</bdi>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 overflow-auto bg-bg">
          {preview.isLoading ? (
            <p className="flex items-center gap-2 p-4 text-xs text-muted">
              <Spinner /> Loading…
            </p>
          ) : preview.error ? (
            <div className="p-3">
              <ErrorNote>{asAppError(preview.error).message}</ErrorNote>
            </div>
          ) : preview.data?.text == null ? (
            <p className="p-4 text-xs text-muted">{preview.data ? `Binary file · ${formatBytes(preview.data.size)}` : "Select a file"}</p>
          ) : (
            <pre className="p-4 font-mono text-xs leading-[1.6] whitespace-pre text-fg" style={{ tabSize: 4 }}>
              {preview.data.text}
              {preview.data.truncated && "\n… (truncated)"}
            </pre>
          )}
        </div>
      </div>
    </Card>
  );
}

function ImportDialog({ source, onClose, onImported }: { source: string; onClose: () => void; onImported: (id: string) => void }) {
  const qc = useQueryClient();
  const home = useHome();
  const toast = useUi((s) => s.toast);
  const [name, setName] = useState(source.split("/").filter(Boolean).pop() ?? "Template");
  const [description, setDescription] = useState("");
  const run = useMutation({
    mutationFn: () => api.templateImport(source, name, description),
    onSuccess: (report) => {
      void qc.invalidateQueries({ queryKey: keys.templates });
      toast({ kind: "ok", title: `Imported ${report.files} file${report.files === 1 ? "" : "s"}`, detail: report.skipped > 0 ? `${report.skipped} link(s) or special file(s) were left out.` : undefined });
      onImported(report.id);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Import as template"
      description="The folder is copied into TekBoard's library. The original is not modified; .git is left out."
      width="w-[520px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={run.isPending} disabled={!name.trim()} onClick={() => run.mutate()}>
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="selectable truncate rounded-md border border-line bg-bg px-2.5 py-1.5 font-mono text-xs text-muted">{tildify(source, home)}</p>
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && run.mutate()} />
        </Field>
        <Field label="Description (optional)">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {run.error && <ErrorNote>{asAppError(run.error).message}</ErrorNote>}
      </div>
    </Modal>
  );
}
