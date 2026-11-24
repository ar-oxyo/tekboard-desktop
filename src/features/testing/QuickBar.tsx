// Quick command bar: run `make`, `make re`, … or a command of your own in the selected
// repository, see its log and exit code in the report, stop it, or open a terminal there.
// Commands start only from a click or Enter in this bar; nothing else can feed it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Eraser, History, Play, Square, SquareTerminal, X } from "lucide-react";
import { useState } from "react";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../../components/Menu";
import { cn, IconButton, Spinner } from "../../components/ui";
import { api, asAppError } from "../../lib/api";
import { useUi } from "../../lib/store";
import { t } from "../../lib/i18n";

export const PRESETS = ["make", "make re", "make clean", "make fclean"] as const;
/** Presets shown as buttons next to the main one; the others stay in its menu. */
const CHIPS = ["make re", "make fclean"] as const;

interface Props {
  repo: string;
  /** Id of the command currently running here, if any. */
  running: number | null;
  /** Empties the log shown by TekBoard. No process is started. */
  onClear: () => void;
  onStarted: (jobId: number) => void;
  onStop: (jobId: number) => void;
  terminal: boolean;
}

export function QuickBar({ repo, running, onClear, onStarted, onStop, terminal }: Props) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [custom, setCustom] = useState("");
  const history = useQuery({ queryKey: ["quick-history", repo], queryFn: () => api.quickHistory(repo), staleTime: 0 });
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });
  const run = useMutation({
    mutationFn: (command: string) => api.quickRun(repo, command),
    onSuccess: (id) => {
      onStarted(id);
      void qc.invalidateQueries({ queryKey: ["quick-history", repo] });
    },
    onError: fail("The command did not start"),
  });
  const forget = useMutation({ mutationFn: (command: string) => api.quickForget(repo, command), onSuccess: () => void qc.invalidateQueries({ queryKey: ["quick-history", repo] }), onError: fail("Not removed") });
  const openTerminal = useMutation({ mutationFn: () => api.openTerminal(repo), onError: fail("The terminal did not start") });
  const busy = running !== null || run.isPending;
  // `clear` is TekBoard's own: it empties the log view and never reaches the system.
  const start = (command: string) => {
    const c = command.trim();
    if (c === "") return;
    if (c === "clear") {
      onClear();
      setCustom("");
      return;
    }
    if (!busy) run.mutate(c);
  };
  const recent = (history.data ?? []).filter((c) => !(PRESETS as readonly string[]).includes(c));
  const chip = "flex h-7 shrink-0 items-center rounded-md border border-white/8 px-2.5 font-mono text-xs text-muted transition-colors hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-45";
  return (
    <div className="card flex flex-wrap items-center gap-1.5 px-2.5 py-2" role="toolbar" aria-label={t("Commandes rapides")}>
      <div className="flex shrink-0">
        <button type="button" disabled={busy} onClick={() => start("make")} className={cn(chip, "rounded-r-none border-r-0 text-fg")} title={t("Lancer make dans ce dépôt")}>
          make
        </button>
        <Menu
          align="start"
          trigger={
            <button type="button" aria-label={t("Raccourcis et commandes récentes")} className={cn(chip, "rounded-l-none px-1.5")}>
              <ChevronDown className="size-3.5" />
            </button>
          }
        >
          <MenuLabel>Raccourcis</MenuLabel>
          {PRESETS.map((p) => (
            <MenuItem key={p} disabled={busy} onSelect={() => start(p)}>
              <span className="font-mono">{p}</span>
            </MenuItem>
          ))}
          {recent.length > 0 && (
            <>
              <MenuSeparator />
              <MenuLabel>{t("Récentes dans ce dépôt")}</MenuLabel>
              {recent.map((c) => (
                <MenuItem key={c} icon={<History className="size-3.5" />} disabled={busy} onSelect={() => start(c)} title={c}>
                  <span className="font-mono">{c}</span>
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
      </div>
      {CHIPS.map((c) => (
        <button key={c} type="button" disabled={busy} onClick={() => start(c)} className={chip}>
          {c}
        </button>
      ))}
      <button type="button" onClick={onClear} className={chip} title={t("Vide le journal affiché ici. Rien n'est lancé.")}>
        <Eraser className="mr-1.5 size-3.5" />
        clear
      </button>
      <form
        className="flex min-w-40 flex-1 items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          start(custom);
        }}
      >
        <div className="relative min-w-0 flex-1">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            list={`quick-${repo}`}
            aria-label={t("Commande libre")}
            placeholder="./my_hunter -h"
            title={"A program and its arguments, run in the repository folder without a shell.\nQuotes group words; pipes, && and redirections are refused."}
            className="field h-7 w-full border border-white/8 px-2.5 pr-7 font-mono text-xs text-fg placeholder:font-sans placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none"
          />
          {custom !== "" && (
            <button type="button" aria-label={t("Vider le champ")} onClick={() => setCustom("")} className="absolute top-1/2 right-1.5 -translate-y-1/2 text-faint hover:text-fg">
              <X className="size-3.5" />
            </button>
          )}
          <datalist id={`quick-${repo}`}>{recent.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        {running !== null ? (
          <button type="button" onClick={() => onStop(running)} className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-danger/30 bg-danger/15 px-2.5 text-xs text-danger hover:bg-danger/25" title={t("Arrête la commande et tout ce qu'elle a lancé")}>
            <Square className="size-3" fill="currentColor" /> Arrêter
          </button>
        ) : (
          <button type="submit" disabled={custom.trim() === "" || run.isPending} className="btn-secondary flex h-7 shrink-0 items-center gap-1.5 rounded-(--btn-radius) px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            {run.isPending ? <Spinner /> : <Play className="size-3.5" />} Run
          </button>
        )}
      </form>
      {recent.length > 0 && (
        <Menu label={t("Commandes récentes")} trigger={<IconButton label={t("Commandes récentes")}><History className="size-4" /></IconButton>}>
          <MenuLabel>{t("Clic pour relancer · ✕ pour oublier")}</MenuLabel>
          {recent.map((c) => (
            <div key={c} className="flex items-center">
              <div className="min-w-0 flex-1">
                <MenuItem disabled={busy} onSelect={() => start(c)} title={c}>
                  <span className="font-mono">{c}</span>
                </MenuItem>
              </div>
              <IconButton label={`Forget “${c}”`} onClick={() => forget.mutate(c)}>
                <X className="size-3.5" />
              </IconButton>
            </div>
          ))}
        </Menu>
      )}
      <IconButton label={terminal ? "Open a terminal in this repository" : "No terminal command is set (Settings)"} disabled={!terminal} onClick={() => openTerminal.mutate()}>
        <SquareTerminal className="size-4" />
      </IconButton>
    </div>
  );
}
