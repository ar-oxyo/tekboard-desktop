// Tika, docked on the right of every screen. It knows what is on screen, offers two or three
// things worth asking here, shows what it does while it does it (real tool calls), and puts
// every change it proposes in a card you accept or refuse. What it did can be undone.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Check, ChevronDown, CircleAlert, History, LoaderCircle, MessageSquarePlus, Send, Square, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn, IconButton } from "../../components/ui";
import { api, asAppError, type AiAction, type AiMessage, type AiProposal, type AiStep, type JobEvent } from "../../lib/api";
import { useJob } from "../../lib/jobs";
import { freeSlots, addDays, startOfDay, hhmm } from "../../lib/plan";
import { useUi } from "../../lib/store";
import { usePlanData } from "../planning/usePlan";
import { InsightList, useInsights } from "./Insights";
import { Markdown } from "./Markdown";
import { MemoryView } from "./MemoryView";
import { Orb, type OrbState } from "./Orb";
import { ProposalCard } from "./ProposalCard";
import { suggestPlan } from "./suggest";
import { projectName, suggestionsFor, useScreen } from "./useScreen";

export function TikaPanel() {
  const open = useUi((s) => s.assistantOpen);
  return open ? <Panel /> : null;
}

type View = "chat" | "history" | "memory";

const PAGE_LABEL: Record<string, string> = { today: "Aujourd'hui", projects: "Projets", planning: "Planning", school: "École", stats: "Stats", resources: "Ressources", settings: "Réglages" };

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? "Encore debout ?" : h < 12 ? "Bonjour !" : h < 18 ? "Salut !" : "Bonsoir !";
}

function Panel() {
  const qc = useQueryClient();
  const screen = useScreen();
  const thread = useUi((s) => s.tikaThread);
  const jobId = useUi((s) => s.tikaJob);
  const setTika = useUi((s) => s.setTika);
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
      setTika({ job: null });
      setPendingText(null);
      void qc.invalidateQueries({ queryKey: ["ai-thread"] });
      void qc.invalidateQueries({ queryKey: ["ai-proposals"] });
      void qc.invalidateQueries({ queryKey: ["ai-actions"] });
    }
  }, [job.data, qc, setTika]);

  const send = useMutation({
    mutationFn: (q: string) => api.aiSend(thread, q, screen),
    onMutate: (q) => setPendingText(q),
    onSuccess: (r) => {
      setTika({ thread: r.threadId, job: r.jobId });
      void qc.invalidateQueries({ queryKey: ["ai-thread", r.threadId] });
    },
    onError: (e) => {
      setPendingText(null);
      toast({ kind: "error", title: "Tika n'a pas pu partir", detail: asAppError(e).message });
    },
  });
  const submit = (q: string) => {
    const t = q.trim();
    if (!t || running || send.isPending) return;
    setText("");
    setView("chat");
    send.mutate(t);
  };

  // Requests handed over by other screens. `#…` are TekBoard's own instant computations.
  const data = usePlanData();
  useEffect(() => {
    if (!ask || data.loading) return;
    useUi.setState({ assistantAsk: null });
    const now = Date.now();
    if (ask.text === "#day" || ask.text === "#week") void suggestPlan(ask.text === "#day" ? "day" : "week");
    else if (ask.text === "#reorganize") void suggestPlan("reorganize");
else if (ask.text === "#free") {
      const slots = freeSlots(data.busy, data.prefs, now, addDays(startOfDay(now), 3), 60).slice(0, 6);
      setText(slots.length ? `Planifie une session dans un de ces créneaux : ${slots.map((s) => `${new Date(s.start).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })} ${hhmm(s.start)}–${hhmm(s.end)}`).join(", ")}` : "Je n'ai aucun créneau d'une heure ces trois jours : que puis-je alléger ?");
      input.current?.focus();
    } else if (ask.text === "#breakdown") {
      const name = projectName(ask.project ?? null) ?? "ce projet";
      submit(`Décompose ${name}${ask.project ? ` (clé ${ask.project})` : ""} en tâches concrètes estimées, fixe le travail restant et propose des sessions avant le rendu, avec des tests et une marge.`);
    } else submit(ask.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, data.loading]);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages.data, job.data?.events.length, job.data?.summary.partial, pendingText] );
  useEffect(() => input.current?.focus(), []);

  const byProposal = useMemo(() => new Map((proposals.data ?? []).map((p) => [p.id, p])), [proposals.data]);
  const byAction = useMemo(() => new Map((actions.data ?? []).map((a) => [a.id, a])), [actions.data]);
  const pendingElsewhere = (proposals.data ?? []).filter((p) => p.status === "pending" && p.threadId !== thread);

  const liveTool = job.data?.events.filter((e) => e.kind === "tool" && e.status === "running").at(-1);
  const orb: OrbState = running ? (liveTool ? "acting" : "thinking") : send.isPending ? "thinking" : (proposals.data ?? []).some((p) => p.status === "pending") || (insights.data?.length ?? 0) > 0 ? "attention" : "idle";
  const status = running ? (liveTool ? `${String(liveTool.label)}…` : "réfléchit…") : orb === "attention" ? ((proposals.data ?? []).some((p) => p.status === "pending") ? "une proposition t'attend" : "j'ai remarqué quelque chose") : "à ton écoute";
  const msgs = messages.data ?? [];
  const empty = msgs.length === 0 && !pendingText;
  const suggestions = suggestionsFor(screen, new Date().getHours());

  return (
    <aside className="tika-panel anim-slide relative z-[30] flex h-full w-[400px] max-w-[42vw] shrink-0 flex-col" aria-label="Tika">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-white/6 px-3.5">
        <Orb state={orb} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="display text-[14px] font-medium">Tika</p>
          <p className="truncate text-[11px] text-faint">{status}</p>
        </div>
        <IconButton label="Nouvelle conversation (Ctrl+Maj+J)" onClick={() => (setTika({ thread: null, job: null }), setView("chat"), input.current?.focus())}>
          <MessageSquarePlus className="size-4" />
        </IconButton>
        <IconButton label="Conversations" active={view === "history"} onClick={() => setView(view === "history" ? "chat" : "history")}>
          <History className="size-4" />
        </IconButton>
        <IconButton label="Ce que je sais (mémoire)" active={view === "memory"} onClick={() => setView(view === "memory" ? "chat" : "memory")}>
          <Brain className="size-4" />
        </IconButton>
        <IconButton label="Fermer (Ctrl+J)" onClick={() => useUi.getState().closeAssistant()}>
          <X className="size-4" />
        </IconButton>
      </header>

      {view === "memory" && <MemoryView project={screen.project ?? null} />}
      {view === "history" && <Threads current={thread} onOpen={(id) => (setTika({ thread: id, job: null }), setView("chat"))} />}

      {view === "chat" && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {empty && (
              <div className="flex flex-col gap-3 pt-3">
                <p className="display text-[17px] font-medium">{greeting()}</p>
                <p className="text-[13px] text-muted">Je vois tes projets, ton planning, tes sessions et tes tests. Demande-moi en langage normal : je lis, je propose, et je ne change rien d'important sans ton accord.</p>
                <InsightList compact />
                <div className="mt-1 flex flex-col gap-1.5">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => submit(s)} className="rounded-lg border border-white/7 px-3 py-2 text-left text-[13px] text-muted transition-colors duration-150 hover:border-accent/40 hover:text-fg">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {pendingElsewhere.length > 0 && (
              <div className="mb-3 flex flex-col gap-2">
                {pendingElsewhere.map((p) => (
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
                  <div className="selectable max-w-[88%] rounded-2xl rounded-br-md bg-accent-soft px-3 py-2 text-[13px] whitespace-pre-wrap">{pendingText}</div>
                </li>
              )}
              {(running || send.isPending) && <Live events={job.data?.events ?? []} partial={typeof job.data?.summary.partial === "string" ? job.data.summary.partial : ""} onStop={() => jobId !== null && void api.jobCancel(jobId)} />}
            </ul>
            <div ref={end} />
          </div>

          <form
            className="shrink-0 border-t border-white/6 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(text);
            }}
          >
            <div className="mb-2 flex items-center gap-1.5 text-[11px] text-faint">
              <span className="size-1.5 rounded-full bg-accent/70" />
              Sur : {PAGE_LABEL[screen.page] ?? "TekBoard"}
              {screen.project && ` · ${projectName(screen.project)}`}
              {screen.tab && screen.tab !== "overview" && ` · ${screen.tab}`}
            </div>
            <div className="field flex items-end gap-2 rounded-xl border border-white/8 p-1.5 focus-within:border-accent">
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
                placeholder={running ? "Tika répond…" : "Demande à Tika…"}
                aria-label="Message pour Tika"
                className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[13px] text-fg placeholder:text-faint focus:outline-none"
              />
              {running ? (
                <IconButton label="Interrompre" className="size-8" onClick={() => jobId !== null && void api.jobCancel(jobId)}>
                  <Square className="size-3.5" />
                </IconButton>
              ) : (
                <IconButton label="Envoyer (Entrée)" className="size-8" disabled={!text.trim() || send.isPending} onClick={() => submit(text)}>
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

/** What Tika is doing right now: the real tool calls of the run, then the text being written. */
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
        <Markdown text={partial} className="tika-caret selectable text-[13px] leading-relaxed" />
      ) : (
        <span className="flex items-center gap-2 text-xs text-faint">
          <LoaderCircle className="anim-spin size-3" /> {tools.length ? "Tika enchaîne…" : "Tika réfléchit…"}
          <button type="button" className="ml-auto hover:text-fg" onClick={onStop}>
            Interrompre
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
        <div className="selectable max-w-[88%] rounded-2xl rounded-br-md bg-accent-soft px-3 py-2 text-[13px] whitespace-pre-wrap">{m.text}</div>
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
      <Markdown text={m.text} className="selectable text-[13px] leading-relaxed" />
      {(m.meta.actions ?? []).map((id) => actions.get(id)).filter(Boolean).map((a) => <ActionChip key={a!.id} a={a!} />)}
      {(m.meta.proposals ?? []).map((id) => proposals.get(id)).filter(Boolean).map((p) => <BackendProposal key={p!.id} p={p!} />)}
      {typeof m.meta.costUsd === "number" && <span className="text-[10px] text-faint">≈ {m.meta.costUsd.toFixed(3)} $</span>}
    </li>
  );
}

/** Something Tika really did, with a way back. */
function ActionChip({ a }: { a: AiAction }) {
  const toast = useUi((s) => s.toast);
  const undo = useMutation({ mutationFn: () => api.aiUndo(a.id), onSuccess: (s) => toast({ kind: "ok", title: "Annulé", detail: s }), onError: (e) => toast({ kind: "error", title: "Pas annulé", detail: asAppError(e).message }) });
  const done = a.status === "done";
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs", done ? "border-ok/25 bg-ok/6" : "border-white/6 text-faint line-through")}>
      {done ? <Check className="size-3.5 shrink-0 text-ok" /> : <Undo2 className="size-3.5 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{a.summary}</span>
      {done && (
        <button type="button" disabled={undo.isPending} onClick={() => undo.mutate()} className="shrink-0 text-muted hover:text-fg">
          Annuler
        </button>
      )}
    </div>
  );
}

function BackendProposal({ p }: { p: AiProposal }) {
  const toast = useUi((s) => s.toast);
  const decide = useMutation({
    mutationFn: ({ accept, keep }: { accept: boolean; keep: number[] }) => api.aiProposalDecide(p.id, accept, accept ? keep : null),
    onSuccess: (_r, v) => toast({ kind: v.accept ? "ok" : "info", title: v.accept ? "Plan appliqué" : "Proposition refusée", detail: v.accept ? `${v.keep.length} changement(s).` : "Tika le saura au prochain message." }),
    onError: (e) => toast({ kind: "error", title: "Non appliqué : rien n'a changé", detail: asAppError(e).message }),
  });
  const outcome = p.outcome?.accepted && p.outcome.kept !== undefined ? `${p.outcome.kept}/${p.outcome.of}` : null;
  return <ProposalCard title={p.title} rationale={p.rationale} warnings={p.payload.warnings} actions={p.payload.actions ?? []} origin="claude" status={p.status} outcome={outcome} busy={decide.isPending} onDecide={(accept, keep) => decide.mutate({ accept, keep })} />;
}

function Threads({ current, onOpen }: { current: number | null; onOpen: (id: number) => void }) {
  const threads = useQuery({ queryKey: ["ai-threads"], queryFn: api.aiThreads });
  const remove = useMutation({ mutationFn: (id: number) => api.aiThreadDelete(id) });
  const setTika = useUi((s) => s.setTika);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <p className="px-1 pb-2 text-xs text-faint">Les conversations sont gardées 30 jours. Ce qui doit durer va dans la mémoire.</p>
      {threads.data?.length === 0 && <p className="px-1 text-[13px] text-muted">Aucune conversation pour l'instant.</p>}
      <ul className="flex flex-col gap-0.5">
        {threads.data?.map((t) => (
          <li key={t.id} className={cn("group row-hover flex items-center gap-2 rounded-lg px-2.5 py-2", t.id === current && "bg-white/4")}>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(t.id)}>
              <span className="block truncate text-[13px]">{t.title}</span>
              <span className="text-[11px] text-faint">
                {new Date(t.updatedAt * 1000).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {t.messages} message{t.messages > 1 ? "s" : ""}
              </span>
            </button>
            <IconButton
              label="Supprimer la conversation"
              className="opacity-0 group-hover:opacity-100"
              onClick={() =>
                remove.mutate(t.id, {
                  onSuccess: () => {
                    if (t.id === current) setTika({ thread: null, job: null });
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
