// TekShare transfers: offers to answer, transfers in progress, received resources to put
// away (each kind with the destinations that fit it), and the history.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Check, FileUp, FolderUp, Inbox, NotebookPen, Settings2, Trash2, X } from "lucide-react";
import { api, asAppError, type ImportTarget, type Imported, type Transfer } from "../../lib/api";
import { useUi } from "../../lib/store";
import { formatBytes, timeAgo } from "../../lib/format";
import { ACTIVE, DEST_LABEL, KIND_LABEL, percent, STATUS_LABEL } from "../../lib/share";
import { useArena } from "../arena/store";
import { usePlayground } from "../playground/store";
import { Modal } from "../../components/Modal";
import { CodeView, DiffView } from "../../components/DiffView";
import { ProjectPicker } from "../../components/ProjectPicker";
import { Badge, Button, Card, CardTitle, ErrorNote, IconButton, Input, Spinner } from "../../components/ui";
import { Menu, MenuItem } from "../../components/Menu";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { t } from "../../lib/i18n";

export function useTransfers() {
  return useQuery({ queryKey: ["tekshare"], queryFn: api.shareList, staleTime: 2000 });
}

export function Transfers() {
  const list = useTransfers();
  const [opened, setOpened] = useState<string | null>(null);
  const openShare = useUi((s) => s.openShare);
  const all = list.data ?? [];
  const pending = all.filter((x) => x.direction === "in" && (x.status === "offered" || x.status === "received"));
  const rest = all.filter((x) => !pending.includes(x));
  const pick = async (directory: boolean) => {
    const p = await openDialog({ directory, multiple: false, title: directory ? t("Dossier à partager") : t("Fichier à partager") });
    if (typeof p === "string") openShare(directory ? { kind: "folder", path: p } : { kind: "file", path: p });
  };
  return (
    <Card>
      <CardTitle
        right={
          <Menu trigger={<Button size="sm" icon={<FileUp className="size-3.5" />}>{t("Partager…")}</Button>}>
            <MenuItem icon={<FileUp className="size-3.5" />} onSelect={() => void pick(false)}>
              {t("Un fichier")}
            </MenuItem>
            <MenuItem icon={<FolderUp className="size-3.5" />} onSelect={() => void pick(true)}>
              {t("Un dossier")}
            </MenuItem>
            <MenuItem icon={<NotebookPen className="size-3.5" />} onSelect={() => { const text = window.prompt(t("Note à partager")); if (text?.trim()) openShare({ kind: "note", title: text.trim().split("\n")[0].slice(0, 60), text }); }}>
              {t("Une note")}
            </MenuItem>
            <MenuItem icon={<Settings2 className="size-3.5" />} onSelect={() => openShare({ kind: "config" })}>
              {t("Mes réglages d'apparence")}
            </MenuItem>
          </Menu>
        }
      >
        <Inbox className="size-4 text-faint" /> TekShare
      </CardTitle>
      {all.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">{t("Rien d'échangé pour l'instant. « Partager » existe aussi dans le Playground, l'Arena, les bibliothèques, les modèles, les prompts, les tests et le menu des projets.")}</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {[...pending, ...rest].slice(0, 60).map((x) => (
            <TransferRow key={x.id} x={x} onOpen={() => setOpened(x.id)} />
          ))}
        </ul>
      )}
      {opened && <ImportDialog id={opened} onClose={() => setOpened(null)} />}
    </Card>
  );
}

function TransferRow({ x, onOpen }: { x: Transfer; onOpen: () => void }) {
  const toast = useUi((s) => s.toast);
  const err = (e: unknown) => toast({ kind: "error", title: "TekShare", detail: asAppError(e).message });
  const moving = x.status === "sending" || x.status === "receiving";
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      {x.direction === "in" ? <ArrowDownLeft className="size-4 shrink-0 text-info" /> : <ArrowUpRight className="size-4 shrink-0 text-faint" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-fg">
          {x.title} <span className="text-xs text-faint">· {KIND_LABEL[x.kind] ?? x.kind}</span>
        </p>
        <p className="truncate text-xs text-faint">
          {x.direction === "in" ? t("de {n}", { n: x.peerNick }) : t("à {n}", { n: x.peerNick })} · {formatBytes(x.size)} · {timeAgo(x.createdAt)}
          {x.school && <span className="ml-2 text-warn">{t("projet de l'école")}</span>}
          {x.detail && <span className="ml-2">{x.detail}</span>}
        </p>
        {moving && (
          <span className="mt-1 block h-1 overflow-hidden rounded bg-white/5">
            <span className="block h-1 bg-accent transition-all" style={{ width: `${percent(x)}%` }} />
          </span>
        )}
      </div>
      <Badge tone={x.status === "failed" ? "danger" : x.status === "received" || x.status === "offered" ? "info" : x.status === "imported" || x.status === "sent" ? "ok" : "neutral"}>{x.direction === "in" && x.status === "offered" ? t("Nouvelle offre") : STATUS_LABEL[x.status]}</Badge>
      {x.direction === "in" && x.status === "offered" && (
        <>
          <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => void api.shareAnswer(x.id, true).catch(err)}>
            {t("Accepter")}
          </Button>
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => void api.shareAnswer(x.id, false).catch(err)}>
            {t("Refuser")}
          </Button>
        </>
      )}
      {x.direction === "in" && (x.status === "received" || x.status === "imported") && (
        <Button size="sm" variant={x.status === "received" ? "primary" : "secondary"} onClick={onOpen}>
          {x.status === "received" ? t("Ranger…") : t("Ouvrir…")}
        </Button>
      )}
      {ACTIVE.includes(x.status) ? (
        <IconButton label={t("Annuler")} onClick={() => void api.shareCancel(x.id).catch(err)}>
          <X className="size-3.5" />
        </IconButton>
      ) : (
        <IconButton label={t("Retirer de l'historique")} onClick={() => void api.shareForget(x.id).catch(err)}>
          <Trash2 className="size-3.5" />
        </IconButton>
      )}
    </li>
  );
}

function ImportDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const ui = useUi();
  const opened = useQuery({ queryKey: ["tekshare-open", id], queryFn: () => api.shareOpen(id), retry: false });
  const [repo, setRepo] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const o = opened.data;
  const go = async (dest: string, target: ImportTarget) => {
    setBusy(dest);
    try {
      const r: Imported = await api.shareImport(id, target);
      if (dest === "patch" && target.to === "patch" && !target.apply) {
        setChecked(r.detail);
        return;
      }
      toast({ kind: "ok", title: t("Rangé"), detail: r.detail });
      void qc.invalidateQueries({ queryKey: ["tekshare"] });
      follow(r);
      onClose();
    } catch (e) {
      toast({ kind: "error", title: t("Impossible"), detail: asAppError(e).message });
    } finally {
      setBusy(null);
    }
  };
  const follow = (r: Imported) => {
    const o2 = r.open;
    if (!o2?.page) return;
    if (o2.page === "playground" && o2.id) {
      usePlayground.getState().setActive(o2.id);
      void qc.invalidateQueries({ queryKey: ["playground"] });
      ui.setPage("playground");
    } else if (o2.page === "arena" && o2.runId) {
      useArena.getState().set({ viewRun: o2.runId });
      ui.setPage("arena");
    } else if (o2.page === "sheet" && o2.path) ui.openSheet(o2.path);
    else if (o2.page === "git" && o2.path) ui.openGit(o2.path);
    else if (["library", "templates", "prompts", "settings"].includes(o2.page)) ui.setPage(o2.page as "library");
  };
  const artix = () => {
    const text = o?.files[0]?.[2] ?? "";
    ui.openAssistant({ text: t("{who} m'a envoyé ceci ({k}). Analyse-le et explique-moi ce qu'il faut en retenir :\n```\n{t}\n```", { who: o?.transfer.peerNick ?? "", k: KIND_LABEL[o?.manifest.kind ?? ""] ?? "", t: text.slice(0, 12000) }) });
    onClose();
  };
  const needsRepo = (d: string) => d === "project" || d === "patch";
  return (
    <Modal open onClose={onClose} title={o ? `${KIND_LABEL[o.manifest.kind] ?? o.manifest.kind} · ${o.manifest.title}` : t("Ressource reçue")} description={o ? t("De {n} · {s} · vérifié (SHA-256). Rien n'est exécuté.", { n: o.transfer.peerNick, s: formatBytes(o.transfer.size) }) : undefined} width="w-[760px]">
      {opened.isLoading && <Spinner />}
      {opened.error && <ErrorNote>{asAppError(opened.error).message}</ErrorNote>}
      {o && (
        <div className="space-y-4">
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {o.files.slice(0, 8).map(([path, size, text]) => (
              <div key={path}>
                <p className="font-mono text-[11px] text-faint">
                  {path} · {formatBytes(size)}
                </p>
                {text !== null && (o.manifest.kind === "patch" ? <DiffView text={text} className="max-h-48 rounded-md" /> : <CodeView text={text} className="max-h-40 rounded-md" />)}
              </div>
            ))}
            {o.files.length > 8 && <p className="text-xs text-faint">{t("… et {n} autre(s) fichier(s)", { n: o.files.length - 8 })}</p>}
          </div>
          {o.destinations.some(needsRepo) && <ProjectPicker value={repo} onChange={setRepo} label={t("Projet de destination")} />}
          {o.destinations.some((d) => d === "library" || d === "template" || d === "prompt") && <Input placeholder={t("Nom (facultatif)")} value={name} onChange={(e) => setName(e.target.value)} />}
          {checked && <p className="text-[13px] text-ok">{checked}</p>}
          <div className="flex flex-wrap gap-2">
            {o.destinations.map((d) => {
              const label = DEST_LABEL[d] ?? d;
              const repoMissing = needsRepo(d) && !repo;
              const onClick = () => {
                if (d === "artix") return artix();
                if (d === "playground") return void go(d, { to: "playground" });
                if (d === "library") return void go(d, { to: "library", name });
                if (d === "template") return void go(d, { to: "template", name });
                if (d === "prompt") return void go(d, { to: "prompt", preset: name });
                if (d === "project") return void go(d, { to: "project", repo: repo!, subdir: o.manifest.kind === "tests" ? "tests" : "." });
                if (d === "patch") return void go(d, { to: "patch", repo: repo!, apply: checked !== null });
                if (d === "arena") return void go(d, { to: "arena" });
                if (d === "config") return void go(d, { to: "config" });
                return void go(d, { to: "downloads" });
              };
              return (
                <Button key={d} variant={d === o.destinations[0] ? "primary" : "secondary"} busy={busy === d} disabled={repoMissing} disabledReason={t("Choisis le projet")} onClick={onClick}>
                  {d === "patch" ? (checked ? t("Appliquer le patch") : t("Vérifier le patch")) : label}
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
