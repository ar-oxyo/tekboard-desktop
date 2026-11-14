// Planning assistant: a side panel over any screen. Quick actions are computed here (free,
// instant); free-form requests go to Claude Code with the planning as context and no tool.
// Whatever is proposed is previewed and saved only on "Apply plan".
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck, CalendarSearch, Check, ListTree, RefreshCw, Send, Sparkles, Square, Sun, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Select } from "../../components/Select";
import { Button, cn, IconButton, Spinner } from "../../components/ui";
import { api, asAppError, type ScheduleAction } from "../../lib/api";
import { addDays, buildContext, describeAction, fmtDur, freeSlots, fromLocalIso, hhmm, MIN, reorganize, schedule, startOfDay, type Span } from "../../lib/plan";
import { useUi, type Proposal } from "../../lib/store";
import { usePlanActions, usePlanData } from "../planning/usePlan";

interface Msg {
  id: number;
  role: "you" | "claude" | "tekboard";
  text: string;
  /** Free slots found locally, each one clickable. */
  slots?: Span[];
  cost?: number | null;
}

let nextMsg = 1;

export function AssistantPanel() {
  const open = useUi((s) => s.assistantOpen);
  return open ? <Panel /> : null;
}

function Panel() {
  const data = usePlanData();
  const act = usePlanActions();
  const proposal = useUi((s) => s.proposal);
  const ask = useUi((s) => s.assistantAsk);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<string | null>(null);
  const [subject, setSubject] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const say = (m: Omit<Msg, "id">) => setMsgs((l) => [...l, { ...m, id: nextMsg++ }]);
  const propose = (p: Proposal | null) => useUi.getState().propose(p);

  const job = useQuery({ queryKey: ["job", jobId], queryFn: () => api.jobGet(jobId!), enabled: jobId !== null, refetchInterval: (q) => (q.state.data && q.state.data.status !== "running" ? false : 1000), staleTime: 0, retry: false });
  useEffect(() => {
    const j = job.data;
    if (!j || j.status === "running" || jobId === null) return;
    setJobId(null);
    const s = j.summary as { reply?: string; actions?: ScheduleAction[]; rejected?: string[]; costUsd?: number | null; error?: string };
    if (j.status !== "success") {
      say({ role: "tekboard", text: j.status === "cancelled" ? "Cancelled." : `Claude Code did not answer: ${s.error ?? "see Testing → history for the log"}.` });
      return;
    }
    say({ role: "claude", text: s.reply || "(no text)", cost: s.costUsd });
    if (s.rejected?.length) say({ role: "tekboard", text: `Ignored ${s.rejected.length} proposal(s) that are not valid changes: ${s.rejected.join("; ")}.` });
    if (s.actions?.length) propose({ title: "Claude's plan", origin: "claude", actions: s.actions, note: null, costUsd: s.costUsd });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.data]);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [msgs, proposal, jobId]);

  const now = Date.now();
  const local = {
    day: () => runLocal("day"),
    week: () => runLocal("week"),
    reorg: () => {
      say({ role: "you", text: "Reorganize what I did not finish" });
      const r = reorganize(data.state.events, data.projects, data.busy, data.prefs, now);
      if (!r.actions.length) return say({ role: "tekboard", text: r.unplaced.length ? "No free time found to move what was not done." : "Nothing to move: every past session is marked done." });
      propose({ title: "Move what was not done", origin: "auto", actions: r.actions, note: r.unplaced.length ? `No room for: ${r.unplaced.map((u) => u.title).join(", ")}.` : null });
    },
    free: () => {
      say({ role: "you", text: "Find free time" });
      const slots = freeSlots(data.busy, data.prefs, now, addDays(startOfDay(now), 3), 60).slice(0, 8);
      say({ role: "tekboard", text: slots.length ? "Free time of at least an hour, today and the next two days. Click one to plan a session in it." : "No free hour in your working hours for the next three days.", slots });
    },
  };
  function runLocal(scope: "day" | "week") {
    say({ role: "you", text: scope === "day" ? "Plan my day" : "Plan my week" });
    const r = schedule(data.projects, data.state.events, data.busy, data.prefs, now, { horizonDays: scope === "day" ? 1 : 7 });
    if (!r.actions.length) {
      const noEstimate = data.projects.filter((p) => p.dueMs !== null && p.estimateMin === null).length;
      return say({ role: "tekboard", text: r.unplaced.length ? `No free time left for ${r.unplaced.map((u) => u.title).join(", ")}.` : noEstimate ? `Nothing to place: ${noEstimate} project(s) with a hand-in have no estimate of the work left. Set one in Planning → Projects or in the project sheet, or ask Claude.` : "Everything estimated is already planned." });
    }
    propose({ title: scope === "day" ? "Plan for today" : "Plan for the week", origin: "auto", actions: r.actions, note: r.unplaced.length ? `Not enough free time for: ${r.unplaced.map((u) => `${u.title} (${fmtDur(u.minutes)})`).join(", ")}.` : null });
  }

  const sendClaude = (question: string, subjectOf: string | null = null) => {
    const q = question.trim();
    if (!q || jobId !== null) return;
    say({ role: "you", text: q });
    setText("");
    const context = buildContext(data.projects, data.state, data.items, data.busy, data.prefs, Date.now());
    api.assistantStart(q, context, subjectOf).then(setJobId, (e) => say({ role: "tekboard", text: asAppError(e).message }));
  };

  // A request handed over by another screen (dashboard, review, project sheet).
  useEffect(() => {
    if (!ask || data.loading) return;
    useUi.setState({ assistantAsk: null });
    if (ask.text === "#day") local.day();
    else if (ask.text === "#week") local.week();
    else if (ask.text === "#reorganize") local.reorg();
    else if (ask.text === "#free") local.free();
    else if (ask.text === "#breakdown") setBreakdown(ask.project ?? data.projects[0]?.key ?? null);
    else sendClaude(ask.text, ask.project ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, data.loading]);

  const projectOptions = useMemo(() => data.projects.map((p) => ({ value: p.key, label: p.title, hint: p.module ?? undefined })), [data.projects]);

  return (
    <aside className="drawer anim-slide fixed top-0 right-0 bottom-0 z-[55] flex w-[420px] max-w-[94vw] flex-col border-l border-white/10" aria-label="Planning assistant">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/6 px-4">
        <Sparkles className="size-4 text-accent" />
        <h2 className="display flex-1 text-[15px] font-medium">Assistant</h2>
        <IconButton label="Close" onClick={() => useUi.getState().closeAssistant()}>
          <X className="size-4" />
        </IconButton>
      </header>
      <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-white/6 px-4 py-3">
        <Chip icon={<Sun className="size-3.5" />} onClick={local.day} title="Computed here, no Claude">
          Plan my day
        </Chip>
        <Chip icon={<CalendarCheck className="size-3.5" />} onClick={local.week} title="Computed here, no Claude">
          Plan my week
        </Chip>
        <Chip icon={<RefreshCw className="size-3.5" />} onClick={local.reorg} title="Computed here, no Claude">
          Reorganize
        </Chip>
        <Chip icon={<CalendarSearch className="size-3.5" />} onClick={local.free} title="Computed here, no Claude">
          Find free time
        </Chip>
        <Chip icon={<ListTree className="size-3.5" />} onClick={() => setBreakdown(breakdown ? null : (data.projects[0]?.key ?? null))} title="Asks Claude, with the project's subject when one is linked">
          Break down project
        </Chip>
      </div>
      {breakdown !== null && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-white/6 bg-white/2 px-4 py-3">
          <Select label="Project to break down" size="sm" value={breakdown} onChange={setBreakdown} options={projectOptions} />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" className="accent-(--color-accent)" checked={subject} onChange={(e) => setSubject(e.target.checked)} /> Send the text of its subject (linked PDF) to Claude
          </label>
          <Button
            size="sm"
            variant="primary"
            icon={<Sparkles className="size-3.5" />}
            disabled={!breakdown || jobId !== null}
            onClick={() => {
              const p = data.projects.find((x) => x.key === breakdown);
              sendClaude(`Break the project "${p?.title}" (key ${breakdown}) into small concrete tasks with an estimate each (create_task, with subtasks when useful), set its remaining estimate (set_estimate), and place work sessions for it before its hand-in.`, subject && p?.repoPath ? p.repoPath : null);
              setBreakdown(null);
            }}
          >
            Ask Claude
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {msgs.length === 0 && !proposal && (
          <div className="flex flex-col gap-2 pt-4 text-[13px] text-muted">
            <p>The four first actions are computed by TekBoard from your calendar, instantly and for free.</p>
            <p>Write anything else to ask Claude: “Il me reste 3 jours pour finir MyRPG, comment je répartis ?”, “Trouve-moi deux heures demain”, “Quels projets prioriser aujourd'hui ?”</p>
            <p className="text-xs text-faint">Claude receives your projects, hand-ins, tasks and the next two weeks of your calendar as text, with no tool: it cannot read files or run anything. Each question counts toward your Claude usage.</p>
          </div>
        )}
        <ul className="flex flex-col gap-3">
          {msgs.map((m) => (
            <li key={m.id} className={cn("flex flex-col gap-1", m.role === "you" && "items-end")}>
              <div className={cn("selectable max-w-[92%] rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap", m.role === "you" ? "bg-accent-soft text-fg" : m.role === "claude" ? "bg-raised" : "border border-white/7 text-muted")}>{m.text}</div>
              {m.slots && m.slots.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.slots.map((s) => (
                    <button key={s.start} type="button" className="cal-chip" style={{ ["--c" as string]: "var(--color-accent)" }} onClick={() => useUi.getState().editEvent({ kind: "session", start: Math.floor(s.start / 1000), end: Math.floor(Math.min(s.end, s.start + data.prefs.sessionMinutes * MIN) / 1000) })}>
                      {new Date(s.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric" })} {hhmm(s.start)}–{hhmm(s.end)} · {fmtDur((s.end - s.start) / MIN)}
                    </button>
                  ))}
                </div>
              )}
              {m.role === "claude" && typeof m.cost === "number" && <span className="text-[10px] text-faint">≈ ${m.cost.toFixed(3)}</span>}
            </li>
          ))}
          {jobId !== null && (
            <li className="flex items-center gap-2 text-[13px] text-muted">
              <Spinner /> Claude is looking at your planning…
              <IconButton label="Cancel" onClick={() => void api.jobCancel(jobId)}>
                <Square className="size-3" />
              </IconButton>
            </li>
          )}
        </ul>
        {proposal && <ProposalView key={JSON.stringify(proposal.actions).length + proposal.title} proposal={proposal} data={data} applying={act.apply.isPending} onApply={(actions) => act.apply.mutate({ actions, origin: proposal.origin }, { onSuccess: () => (propose(null), say({ role: "tekboard", text: `Applied ${actions.length} change(s).` })) })} onDiscard={() => propose(null)} />}
        <div ref={end} />
      </div>
      <form
        className="flex shrink-0 items-end gap-2 border-t border-white/6 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          sendClaude(text);
        }}
      >
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendClaude(text);
            }
          }}
          placeholder="Ask Claude about your planning…"
          aria-label="Request for Claude"
          className="field min-h-10 flex-1 resize-none border border-white/8 px-2.5 py-2 text-[13px] text-fg placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <IconButton label="Send to Claude" className="size-9" disabled={!text.trim() || jobId !== null} onClick={() => sendClaude(text)}>
          <Send className="size-4" />
        </IconButton>
      </form>
    </aside>
  );
}

function Chip({ icon, children, onClick, title }: { icon: ReactNode; children: ReactNode; onClick: () => void; title: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className="flex h-7 items-center gap-1.5 rounded-full border border-white/8 px-2.5 text-xs text-muted transition-colors duration-150 hover:border-line-strong hover:text-fg">
      {icon}
      {children}
    </button>
  );
}

/** Each change with a box to untick, a warning when it overlaps something, and "Apply plan". */
function ProposalView({ proposal, data, applying, onApply, onDiscard }: { proposal: Proposal; data: ReturnType<typeof usePlanData>; applying: boolean; onApply: (a: ScheduleAction[]) => void; onDiscard: () => void }) {
  const [off, setOff] = useState<Set<number>>(new Set());
  const rows = proposal.actions.map((a, i) => {
    let clash: string | null = null;
    if (a.type === "create_session" || a.type === "move_event") {
      const [s, e] = [fromLocalIso(a.start), fromLocalIso(a.end)];
      const self = a.type === "move_event" ? `p${a.id}` : null;
      const hit = data.items.find((it) => it.id !== self && !it.allDay && it.kind !== "campus" && it.kind !== "reminder" && it.kind !== "deadline" && it.kind !== "start" && it.start < e && it.end > s);
      if (Number.isNaN(s) || Number.isNaN(e) || e <= s) clash = "invalid time";
      else if (hit) clash = `overlaps “${hit.title}”`;
      else if (s < Date.now() - 5 * MIN) clash = "in the past";
    }
    return { a, i, d: describeAction(a, data.projects, data.state.events), clash };
  });
  const chosen = rows.filter((r) => !off.has(r.i)).map((r) => r.a);
  const minutes = rows.filter((r) => !off.has(r.i) && r.a.type === "create_session").reduce((s, r) => s + (r.a.type === "create_session" ? (fromLocalIso(r.a.end) - fromLocalIso(r.a.start)) / MIN : 0), 0);
  return (
    <section className="mt-4 rounded-lg border border-accent/30 bg-accent-soft/40">
      <header className="flex items-center gap-2 border-b border-white/6 px-3 py-2">
        <span className="flex-1 text-[13px] font-medium">{proposal.title}</span>
        <span className="text-[11px] text-faint">{proposal.origin === "auto" ? "computed by TekBoard" : "proposed by Claude"}</span>
      </header>
      {proposal.note && <p className="border-b border-white/6 px-3 py-2 text-xs text-warn">{proposal.note}</p>}
      <ul className="max-h-80 overflow-y-auto py-1">
        {rows.map(({ a, i, d, clash }) => (
          <li key={i}>
            <label className="row-hover flex cursor-pointer items-start gap-2 px-3 py-1.5 text-[13px]">
              <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={!off.has(i)} onChange={() => setOff((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))} />
              <span className="w-14 shrink-0 text-xs text-faint">{d.verb}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{d.text}</span>
                {d.when && <span className="block truncate font-mono text-[11px] text-muted">{d.when}</span>}
                {clash && (
                  <span className="flex items-center gap-1 text-[11px] text-warn">
                    <AlertTriangle className="size-3" /> {clash}
                  </span>
                )}
              </span>
              {a.type === "create_session" && <span className="shrink-0 font-mono text-[11px] text-faint">{fmtDur((fromLocalIso(a.end) - fromLocalIso(a.start)) / MIN)}</span>}
            </label>
          </li>
        ))}
      </ul>
      <footer className="flex items-center gap-2 border-t border-white/6 px-3 py-2">
        <span className="flex-1 text-xs text-muted">
          {chosen.length} change{chosen.length === 1 ? "" : "s"}
          {minutes > 0 && ` · ${fmtDur(minutes)} of work`}
        </span>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
        <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} disabled={chosen.length === 0} busy={applying} onClick={() => onApply(chosen)}>
          Apply plan
        </Button>
      </footer>
    </section>
  );
}
