// Artix, docked on the right of every screen. It knows what is on screen, offers two or three
// things worth asking here, does what is asked when it is clear (every action can be undone),
// and puts larger changes in a card you accept or refuse. A request made from another screen
// (break a project down, a suggestion) opens its own conversation instead of mixing into the
// one in progress.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, CalendarClock, Check, ChevronDown, CircleAlert, CornerDownRight, History, LoaderCircle, MessageSquarePlus, Send, Settings2, Square, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Menu, MenuItem } from "../../components/Menu";
import { cn, IconButton } from "../../components/ui";
import { api, asAppError, type AiAction, type AiMessage, type AiProposal, type AiStep, type JobEvent } from "../../lib/api";
import { useJob } from "../../lib/jobs";
import { freeSlots, addDays, startOfDay, hhmm } from "../../lib/plan";
import { useUi } from "../../lib/store";
import { locale, t } from "../../lib/i18n";
import { aiGate } from "../../lib/ai";
import { useAiStatus } from "../settings/AiProvider";

const tr = t;
import { usePlanData } from "../planning/usePlan";
import { InsightList, useInsights } from "./Insights";
import { Markdown } from "./Markdown";
import { MemoryView } from "./MemoryView";
import { Artix, type ArtixState } from "./Artix";
import { ProposalCard } from "./ProposalCard";
import { suggestPlan, type PlanScope } from "./suggest";
import { projectName, suggestionsFor, useScreen } from "./useScreen";

export function ArtixPanel() {
  const open = useUi((s) => s.assistantOpen);
  return open ? <Panel /> : null;
}

type View = "chat" | "history" | "memory";

const PAGE_LABEL: Record<string, string> = { today: t("Aujourd'hui"), projects: t("Projets"), planning: t("Planning"), school: t("École"), stats: "Stats", resources: "Ressources", settings: t("Réglages") };

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? tr("Encore debout ?") : h < 12 ? tr("Bonjour !") : h < 18 ? tr("Salut !") : t("Bonsoir !");
}

function Panel() {
  const ai = aiGate(useAiStatus().data);
  const qc = useQueryClient();
  const screen = useScreen();
  const thread = useUi((s) => s.artixThread);
  const jobId = useUi((s) => s.artixJob);
  const setArtix = useUi((s) => s.setArtix);
  const ask = useUi((s) => s.assistantAsk);
  const toast = useUi((s) => s.toast);
  const [view, setView] = useState<View>("chat");
  const [text, setText] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const messages = useQuery({ queryKey: ["ai-thread", thread], queryFn: () => api.aiThread(thread!), enabled: thread !== null });
  const proposals = useQuery({ queryKey: ["ai-proposals"], queryFn: () => api.aiProposals(null) });
  const actions = useQuery({ queryKey: ["ai-actions"], queryFn: () => api.aiActions(100) });
  const job = useJob(jobId);
  const insights = useInsights();
  const running = job.data?.status === "running";

  // The turn ended: the conversation is re-read from the database (it holds the answer).
  useEffect(() => {
    if (job.data && job.data.status !== "running") {
      setArtix({ job: null });
      setPendingText(null);
      void qc.invalidateQueries({ queryKey: ["ai-thread"] });
      void qc.invalidateQueries({ queryKey: ["ai-proposals"] });
      void qc.invalidateQueries({ queryKey: ["ai-actions"] });
    }
  }, [job.data, qc, setArtix]);

  const send = useMutation({
    mutationFn: ({ q, fresh }: { q: string; fresh?: boolean }) => api.aiSend(fresh ? null : thread, q, screen),
    onMutate: ({ q }) => setPendingText(q),
    onSuccess: (r) => {
      setArtix({ thread: r.threadId, job: r.jobId });
      void qc.invalidateQueries({ queryKey: ["ai-thread", r.threadId] });
    },
    onError: (e) => {
      setPendingText(null);
      toast({ kind: "error", title: t("Artix n'a pas pu partir"), detail: asAppError(e).message });
    },
  });
  /** `fresh`: a request from another screen gets a conversation of its own. */
  const submit = (q: string, fresh = false) => {
    const text = q.trim();
    if (!text || running || send.isPending) return;
    setText("");
    setView("chat");
    setNotice(null);
    // A thread exists only once something was said in it: no need to wait for its messages
    // (they may still be loading) to know the request needs a conversation of its own.
    const separate = fresh && thread !== null;
    if (separate) setArtix({ thread: null, job: null });
    send.mutate({ q: text, fresh: separate });
  };

  // Requests handed over by other screens. `#…` are TekBoard's own instant computations.
  // The request is taken and cleared in one step, so it runs once even if the effect runs twice.
  const data = usePlanData();
  const [notice, setNotice] = useState<{ tone: "info" | "warn"; title: string; text?: string } | null>(null);
  useEffect(() => {
    if (!ask || data.loading) return;
    const a = useUi.getState().takeAssistantAsk();
    if (!a) return;
    const now = Date.now();
    const plan = (scope: PlanScope) => {
      setNotice(null);
      void suggestPlan(scope, null, true).then((o) => {
        if (o.status === "nothing") setNotice({ tone: "info", title: scope === "reorganize" ? t("Rien à replacer") : t("Rien à planifier"), text: o.message });
        else if (o.status === "error") setNotice({ tone: "warn", title: t("Planning non calculé"), text: o.message });
      });
    };
    if (a.text === "#day" || a.text === "#week") plan(a.text === "#day" ? "day" : "week");
    else if (a.text === "#reorganize") plan("reorganize");
    else if (a.text === "#free") {
      const slots = freeSlots(data.busy, data.prefs, now, addDays(startOfDay(now), 3), 60).slice(0, 6);
      setText(slots.length ? `Planifie une session dans un de ces créneaux : ${slots.map((s) => `${new Date(s.start).toLocaleDateString(locale(), { weekday: "short", day: "numeric" })} ${hhmm(s.start)}–${hhmm(s.end)}`).join(", ")}` : "Je n'ai aucun créneau d'une heure ces trois jours : que puis-je alléger ?");
      input.current?.focus();
    } else if (a.text === "#breakdown") {
      const name = projectName(a.project ?? null) ?? t("ce projet");
      submit(t("Décompose {name} en tâches.", { name: `${name}${a.project ? ` (${a.project})` : ""}` }), true);
    } else submit(a.text, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, data.loading]);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages.data, job.data?.events.length, job.data?.summary.partial, pendingText] );
  useEffect(() => input.current?.focus(), []);

  const byProposal = useMemo(() => new Map((proposals.data ?? []).map((p) => [p.id, p])), [proposals.data]);
  const byAction = useMemo(() => new Map((actions.data ?? []).map((a) => [a.id, a])), [actions.data]);
  // Proposals with no conversation show here; those of another conversation are a link to it
  // (their card belongs there, not on top of whatever is open).
  const pendingLoose = (proposals.data ?? []).filter((p) => p.status === "pending" && p.threadId === null);
  const pendingOther = (proposals.data ?? []).filter((p) => p.status === "pending" && p.threadId !== null && p.threadId !== thread);

  const liveTool = job.data?.events.filter((e) => e.kind === "tool" && e.status === "running").at(-1);
  const msgs = messages.data ?? [];
  // A turn that just ended shows on Artix's face for a moment: done, or a problem.
  const last = msgs.at(-1);
  const [flash, setFlash] = useState<{ id: number; state: ArtixState } | null>(null);
  useEffect(() => {
    if (!last || last.role === "user" || Date.now() / 1000 - last.createdAt > 20) return;
    const state: ArtixState = last.role === "system" && last.meta.error ? "error" : last.role === "assistant" ? "success" : "idle";
    setFlash({ id: last.id, state });
    const id = window.setTimeout(() => setFlash(null), state === "error" ? 6000 : 2600);
    return () => window.clearTimeout(id);
  }, [last?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = (proposals.data ?? []).some((p) => p.status === "pending");
  const face: ArtixState = running ? (liveTool ? "working" : "thinking") : send.isPending ? "thinking" : flash?.id === last?.id && flash ? flash.state : pending || (insights.data?.length ?? 0) > 0 ? "attention" : "idle";
  const status = running ? (liveTool ? `${String(liveTool.label)}…` : t("réfléchit…")) : face === "success" ? t("c'est fait") : face === "error" ? t("un problème") : face === "attention" ? (pending ? t("une proposition t'attend") : t("j'ai remarqué quelque chose")) : t("à ton écoute");
  const empty = msgs.length === 0 && !pendingText;
  const suggestions = suggestionsFor(screen, new Date().getHours());

  return (
    <aside className="artix-panel anim-slide relative z-[30] flex h-full w-[400px] max-w-[42vw] shrink-0 flex-col" aria-label="Artix">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-ink/6 px-3.5">
        <Artix state={face} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="display text-base font-medium">Artix</p>
          <p className="truncate text-2xs text-faint">{status}</p>
        </div>
        <IconButton label={t("Nouvelle conversation (Ctrl+Maj+J)")} onClick={() => (setArtix({ thread: null, job: null }), setView("chat"), input.current?.focus())}>
          <MessageSquarePlus className="size-4" />
        </IconButton>
        <IconButton label={t("Conversations")} active={view === "history"} onClick={() => setView(view === "history" ? "chat" : "history")}>
          <History className="size-4" />
        </IconButton>
        <Menu label={t("Plus")}>
          <MenuItem icon={<Brain className="size-4" />} onSelect={() => setView(view === "memory" ? "chat" : "memory")}>{t("Ce que je sais (mémoire)")}</MenuItem>
          <MenuItem icon={<Settings2 className="size-4" />} onSelect={() => { useUi.setState({ settingsTab: "ai" }); useUi.getState().setPage("settings"); }}>{t("Réglages de l'IA")}</MenuItem>
        </Menu>
        <IconButton label={t("Fermer (Ctrl+J)")} onClick={() => useUi.getState().closeAssistant()}>
          <X className="size-4" />
        </IconButton>
      </header>

      {view === "memory" && <MemoryView project={screen.project ?? null} />}
      {view === "history" && <Threads current={thread} onOpen={(id) => (setArtix({ thread: id, job: null }), setView("chat"))} />}

      {view === "chat" && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {!ai.ready && (
              <div className="mb-3 rounded-lg border border-warn/30 bg-warn/8 px-3 py-2 text-sm">
                <p className="text-fg">{ai.why}</p>
                <p className="mt-1 text-xs text-muted">{t("Sans IA, les plannings proposés (#day, #week, #reorganize) fonctionnent quand même.")}</p>
                <button type="button" className="mt-1.5 text-xs text-accent hover:underline" onClick={() => { useUi.setState({ settingsTab: "ai" }); useUi.getState().setPage("settings"); }}>
                  {t("Ouvrir les réglages de l'IA")}
                </button>
              </div>
            )}
            {notice && (
              <div className={cn("mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm", notice.tone === "warn" ? "bg-warn/8" : "bg-ink/4")}>
                <div className="min-w-0 flex-1">
                  <p className="text-fg">{notice.title}</p>
                  {notice.text && <p className="mt-0.5 text-xs text-muted">{notice.text}</p>}
                </div>
                <IconButton label={t("Fermer")} onClick={() => setNotice(null)}><X className="size-3.5" /></IconButton>
              </div>
            )}
            {empty && !notice && pendingLoose.length === 0 && (
              <div className="flex flex-col gap-4 pt-4">
                <p className="display text-lg font-medium">{greeting()}</p>
                <InsightList compact />
                <ul className="flex flex-col">
                  {suggestions.slice(0, 3).map((s) => (
                    <li key={s}>
                      <button type="button" onClick={() => submit(s)} className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-muted transition-colors duration-150 hover:bg-hover hover:text-fg">
                        <CornerDownRight className="size-3.5 shrink-0 text-faint group-hover:text-accent" />
                        <span className="min-w-0 flex-1">{s}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pendingOther.length > 0 && (
              <div className="mb-3 flex flex-col gap-1">
                {[...new Map(pendingOther.map((p) => [p.threadId!, p])).values()].map((p) => (
                  <button key={p.id} type="button" onClick={() => setArtix({ thread: p.threadId, job: null })} className="flex items-center gap-2 rounded-lg bg-accent-soft/50 px-3 py-2 text-left text-xs text-fg hover:bg-accent-soft">
                    <CalendarClock className="size-3.5 shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 truncate">{t("Proposition en attente : {t}", { t: p.title })}</span>
                    <span className="shrink-0 text-accent">{t("Ouvrir")}</span>
                  </button>
                ))}
              </div>
            )}
            {pendingLoose.length > 0 && (
              <div className="mb-3 flex flex-col gap-2">
                {pendingLoose.map((p) => (
                  <BackendProposal key={p.id} p={p} />
                ))}
              </div>
            )}
            <ul className="flex flex-col gap-4">
              {msgs.map((m) => (
                <MessageView key={m.id} m={m} proposals={byProposal} actions={byAction} />
              ))}
              {pendingText && !msgs.some((m) => m.role === "user" && m.text === pendingText && running) && msgs.at(-1)?.text !== pendingText && (
                <li className="flex justify-end">
                  <div className="selectable max-w-[88%] rounded-2xl rounded-br-md bg-accent-soft px-3 py-2 text-sm whitespace-pre-wrap">{pendingText}</div>
                </li>
              )}
              {(running || send.isPending) && <Live events={job.data?.events ?? []} partial={typeof job.data?.summary.partial === "string" ? job.data.summary.partial : ""} onStop={() => jobId !== null && void api.jobCancel(jobId)} />}
            </ul>
            <div ref={end} />
          </div>

          <form
            className="shrink-0 border-t border-ink/6 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(text);
            }}
          >
            <div className="mb-2 flex items-center gap-1.5 text-2xs text-faint">
              <span className="size-1.5 rounded-full bg-accent/70" />
              {t("Sur : {p}", { p: PAGE_LABEL[screen.page] ?? "TekBoard" })}
              {screen.project && ` · ${projectName(screen.project)}`}
              {screen.tab && screen.tab !== "overview" && ` · ${screen.tab}`}
            </div>
            <div className="field flex items-end gap-2 rounded-xl border border-ink/8 p-1.5 focus-within:border-accent">
              <textarea
                ref={input}
                rows={1}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit(text);
                  }
                }}
                placeholder={running ? tr("Artix répond…") : t("Demande à Artix…")}
                aria-label={t("Message pour Artix")}
                className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm text-fg placeholder:text-faint focus:outline-none focus-visible:outline-none"
              />
              {running ? (
                <IconButton label={t("Interrompre")} className="size-8" onClick={() => jobId !== null && void api.jobCancel(jobId)}>
                  <Square className="size-3.5" />
                </IconButton>
              ) : (
                <IconButton label={t("Envoyer (Entrée)")} className="size-8" disabled={!text.trim() || send.isPending} onClick={() => submit(text)}>
                  <Send className="size-4" />
                </IconButton>
              )}
            </div>
          </form>
        </>
      )}
    </aside>
  );
}

function stepIcon(status: string) {
  if (status === "running") return <LoaderCircle className="anim-spin size-3 text-accent" />;
  if (status === "error") return <CircleAlert className="size-3 text-warn" />;
  return <Check className="size-3 text-ok" />;
}

/** What Artix is doing right now: the real tool calls of the run, then the text being written. */
function Live({ events, partial, onStop }: { events: JobEvent[]; partial: string; onStop: () => void }) {
  const tools = events.filter((e) => e.kind === "tool");
  return (
    <li className="flex flex-col gap-2">
      {tools.length > 0 && (
        <ul className="flex flex-col gap-1">
          {tools.map((t, i) => (
            <li key={String(t.id ?? i)} className="flex items-center gap-2 text-xs text-muted">
              {stepIcon(String(t.status))}
              <span>{String(t.label)}</span>
              {t.detail && <span className="truncate text-faint">{String(t.detail)}</span>}
            </li>
          ))}
        </ul>
      )}
      {partial ? (
        <Markdown text={partial} className="artix-caret selectable text-sm leading-relaxed" />
      ) : (
        <span className="flex items-center gap-2 text-xs text-faint">
          <LoaderCircle className="anim-spin size-3" /> {tools.length ? tr("Artix enchaîne…") : t("Artix réfléchit…")}
          <button type="button" className="ml-auto hover:text-fg" onClick={onStop}>
            {t("Interrompre")}
          </button>
        </span>
      )}
    </li>
  );
}

function Steps({ steps }: { steps: AiStep[] }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  return (
    <div className="text-xs text-faint">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 hover:text-muted">
        <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} />
        {steps.length} action{steps.length > 1 ? "s" : ""} : {steps.slice(0, 3).map((s) => s.label).join(", ")}
        {steps.length > 3 && "…"}
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-0.5 pl-4">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              {stepIcon(s.status)}
              <span className="text-muted">{s.label}</span>
              <span className="truncate">{s.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageView({ m, proposals, actions }: { m: AiMessage; proposals: Map<number, AiProposal>; actions: Map<number, AiAction> }) {
  if (m.role === "user")
    return (
      <li className="flex justify-end">
        <div className="selectable max-w-[88%] rounded-2xl rounded-br-md bg-accent-soft px-3 py-2 text-sm whitespace-pre-wrap">{m.text}</div>
      </li>
    );
  if (m.role === "system")
    return (
      <li className={cn("flex items-start gap-2 text-xs", m.meta.error ? "text-warn" : "text-faint")}>
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span className="selectable">{m.text}</span>
      </li>
    );
  return (
    <li className="flex flex-col gap-1.5">
      <Steps steps={m.meta.steps ?? []} />
      <Markdown text={m.text} className="selectable text-sm leading-relaxed" />
      {(m.meta.actions ?? []).map((id) => actions.get(id)).filter(Boolean).map((a) => <ActionChip key={a!.id} a={a!} />)}
      {(m.meta.proposals ?? []).map((id) => proposals.get(id)).filter(Boolean).map((p) => <BackendProposal key={p!.id} p={p!} />)}
      {typeof m.meta.costUsd === "number" && <span className="text-3xs text-faint">≈ {m.meta.costUsd.toFixed(3)} $</span>}
    </li>
  );
}

/** Something Artix really did, with a way back. */
function ActionChip({ a }: { a: AiAction }) {
  const toast = useUi((s) => s.toast);
  const undo = useMutation({ mutationFn: () => api.aiUndo(a.id), onSuccess: (s) => toast({ kind: "ok", title: t("Annulé"), detail: s }), onError: (e) => toast({ kind: "error", title: t("Pas annulé"), detail: asAppError(e).message }) });
  const done = a.status === "done";
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs", done ? "border-ok/25 bg-ok/6" : "border-ink/6 text-faint line-through")}>
      {done ? <Check className="size-3.5 shrink-0 text-ok" /> : <Undo2 className="size-3.5 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{a.summary}</span>
      {done && (
        <button type="button" disabled={undo.isPending} onClick={() => undo.mutate()} className="shrink-0 text-muted hover:text-fg">
          {t("Annuler")}
        </button>
      )}
    </div>
  );
}

function BackendProposal({ p }: { p: AiProposal }) {
  const toast = useUi((s) => s.toast);
  const breakdown = p.kind === "breakdown";
  const project = (p.payload as { project?: string }).project ?? null;
  const decide = useMutation({
    mutationFn: async ({ accept, keep, plan }: { accept: boolean; keep: number[]; plan?: boolean }) => {
      await api.aiProposalDecide(p.id, accept, accept ? keep : null);
      // Option B: the tasks are saved, then sessions are proposed (nothing reaches the calendar before "Appliquer").
      if (accept && plan && project) return api.aiTool("suggest_plan", { scope: "two_weeks", project }, p.threadId);
      return null;
    },
    onSuccess: (r, v) => {
      if (!v.accept) return toast({ kind: "info", title: t("Proposition refusée") });
      if (v.plan) {
        const nothing = r && r.status === "nothing";
        return toast({ kind: nothing ? "info" : "ok", title: t("Tâches enregistrées"), detail: nothing ? t("Aucune session à proposer : rien à placer, ou pas de créneau libre.") : t("Sessions proposées : valide-les avant qu'elles arrivent dans le calendrier.") });
      }
      toast({ kind: "ok", title: breakdown ? t("Tâches enregistrées") : t("Plan appliqué"), detail: breakdown ? t("Aucune session n'a été créée.") : undefined });
    },
    onError: (e) => toast({ kind: "error", title: t("Non appliqué : rien n'a changé"), detail: asAppError(e).message }),
  });
  const outcome = p.outcome?.accepted && p.outcome.kept !== undefined ? `${p.outcome.kept}/${p.outcome.of}` : null;
  return (
    <ProposalCard
      title={p.title}
      rationale={p.rationale}
      warnings={p.payload.warnings}
      actions={p.payload.actions ?? []}
      origin="claude"
      status={p.status}
      outcome={outcome}
      busy={decide.isPending}
      onDecide={(accept, keep) => decide.mutate({ accept, keep })}
      acceptLabel={breakdown ? t("Accepter") : undefined}
      alternate={breakdown && project ? { label: t("Accepter et planifier"), onAccept: (keep) => decide.mutate({ accept: true, keep, plan: true }) } : undefined}
    />
  );
}

function Threads({ current, onOpen }: { current: number | null; onOpen: (id: number) => void }) {
  const threads = useQuery({ queryKey: ["ai-threads"], queryFn: api.aiThreads });
  const remove = useMutation({ mutationFn: (id: number) => api.aiThreadDelete(id) });
  const setArtix = useUi((s) => s.setArtix);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <p className="px-1 pb-2 text-xs text-faint">{t("Les conversations sont gardées 30 jours. Ce qui doit durer va dans la mémoire.")}</p>
      {threads.data?.length === 0 && <p className="px-1 text-sm text-muted">{t("Aucune conversation pour l'instant.")}</p>}
      <ul className="flex flex-col gap-0.5">
        {threads.data?.map((t) => (
          <li key={t.id} className={cn("group row-hover flex items-center gap-2 rounded-lg px-2.5 py-2", t.id === current && "bg-ink/4")}>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(t.id)}>
              <span className="block truncate text-sm">{t.title}</span>
              <span className="text-2xs text-faint">
                {new Date(t.updatedAt * 1000).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {t.messages} message{t.messages > 1 ? "s" : ""}
              </span>
            </button>
            <IconButton
              label={tr("Supprimer la conversation")}
              className="opacity-0 group-hover:opacity-100"
              onClick={() =>
                remove.mutate(t.id, {
                  onSuccess: () => {
                    if (t.id === current) setArtix({ thread: null, job: null });
                  },
                })
              }
            >
              <Trash2 className="size-3.5" />
            </IconButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
