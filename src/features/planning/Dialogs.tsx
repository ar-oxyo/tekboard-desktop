// Planning dialogs, open over any screen: calendar entry, task, quick capture, preferences, weekly review.
import { Check, ChevronLeft, ChevronRight, Lightbulb, Play, Plus, Trash2 } from "lucide-react";
import { startFocus } from "./Focus";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal } from "../../components/Modal";
import { Select } from "../../components/Select";
import { Button, cn, Dot, Field, IconButton, Input, SectionLabel } from "../../components/ui";
import type { PlanEvent, PlanEventKind, PlanTask } from "../../lib/api";
import { useNow } from "../../lib/hooks";
import { addDays, dayKey, dayStartOf, durInput, fmtDur, freeSlots, hhmm, hhmmOf, KIND_LABEL, MIN, minutesOf, missed, parseDur, PRIORITY, startOfWeek, type PlanPrefs, type PlanProject } from "../../lib/plan";
import { useUi } from "../../lib/store";
import { usePlanActions, usePlanData, usePlanPrefs } from "./usePlan";

const textarea = "w-full resize-y rounded-md border border-line bg-bg p-2.5 text-[13px] leading-relaxed text-fg placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none";

export function ProjectSelect({ value, onChange, projects, className, size }: { value: string | null; onChange: (key: string | null) => void; projects: PlanProject[]; className?: string; size?: "sm" | "md" }) {
  const options = useMemo(() => [{ value: "", label: "No project" }, ...projects.map((p) => ({ value: p.key, label: p.title, hint: p.module ?? undefined }))], [projects]);
  return <Select label="Project" className={className} size={size} value={value ?? ""} onChange={(v) => onChange(v || null)} options={options} placeholder="No project" />;
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<[T, string]>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-(--btn-radius) border border-white/8 p-0.5">
      {options.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)} className={cn("h-7 flex-1 rounded-[calc(var(--btn-radius)-3px)] px-2.5 text-xs whitespace-nowrap transition-colors duration-150", value === id ? "bg-raised text-fg" : "text-muted hover:text-fg")}>
          {text}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────────── calendar entry ─────────────────────────────

const KINDS: Array<[PlanEventKind, string]> = [["session", "Work session"], ["event", "Event"], ["reminder", "Reminder"]];

export function EventDialog() {
  const draft = useUi((s) => s.eventEdit);
  return draft ? <EventForm key={draft.id ?? `new-${draft.start}`} draft={draft} /> : null;
}

function EventForm({ draft }: { draft: Partial<PlanEvent> }) {
  const close = () => useUi.getState().editEvent(null);
  const { projects, state } = usePlanData();
  const act = usePlanActions();
  const start0 = (draft.start ?? Math.floor(Date.now() / 1000)) * 1000;
  const end0 = (draft.end ?? draft.start! + 3600) * 1000;
  const [kind, setKind] = useState<PlanEventKind>(draft.kind ?? "session");
  const [title, setTitle] = useState(draft.title ?? "");
  const [project, setProject] = useState<string | null>(draft.project ?? null);
  const [day, setDay] = useState(dayKey(start0));
  const [from, setFrom] = useState(hhmm(start0));
  const [to, setTo] = useState(hhmm(end0));
  const [notes, setNotes] = useState(draft.notes ?? "");
  const [done, setDone] = useState(draft.done ?? false);
  const [error, setError] = useState<string | null>(null);
  const task = draft.taskId ? state.tasks.find((t) => t.id === draft.taskId) : undefined;
  const isNew = !draft.id;
  const work = kind === "session" || kind === "task";
  const name = project ? projects.find((p) => p.key === project)?.title : undefined;

  const save = () => {
    const [a, b] = [minutesOf(from), minutesOf(to)];
    if (!day || a === null || b === null) return setError("Set a day, a start and an end.");
    const base = dayStartOf(day);
    const start = base + a * MIN;
    // An end before the start means "until that hour the next day".
    const end = b > a ? base + b * MIN : addDays(base, 1) + b * MIN;
    const label = title.trim() || (work ? name : "") || "";
    if (!label) return setError("Give it a title, or pick a project.");
    act.saveEvent.mutate({ ...draft, kind, title: label, project, notes, done, start: Math.floor(start / 1000), end: Math.floor(end / 1000) }, { onSuccess: close });
  };

  return (
    <Modal
      open
      onClose={close}
      title={isNew ? "New entry" : KIND_LABEL[kind]}
      width="w-[520px]"
      footer={
        <>
          {!isNew && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              icon={<Trash2 className="size-3.5" />}
              onClick={() => {
                act.removeEvent.mutate(draft.id!);
                close();
              }}
            >
              Delete
            </Button>
          )}
          {!isNew && work && !done && (
            <Button
              icon={<Play className="size-3.5" />}
              onClick={() => {
                close();
                startFocus({ title: draft.title ?? title, project, taskId: draft.taskId ?? null, eventId: draft.id!, plannedMin: Math.round(((draft.end ?? 0) - (draft.start ?? 0)) / 60) });
              }}
              title="Starts the timer and opens the project's workspace"
            >
              Start focus
            </Button>
          )}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Check className="size-3.5" />} busy={act.saveEvent.isPending} onClick={save}>
            {isNew ? "Add to calendar" : "Save"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {kind !== "task" && <Segmented label="Kind" value={kind} onChange={setKind} options={KINDS} />}
        <Input autoFocus aria-label="Title" placeholder={work ? (name ?? "What will you work on?") : kind === "reminder" ? "Remind me to…" : "Title"} value={title} onChange={(e) => setTitle(e.target.value)} />
        {task && <p className="-mt-1 text-xs text-faint">Holds the task “{task.title}”.</p>}
        <div className="grid grid-cols-[minmax(0,1fr)_110px_110px] gap-2">
          <Field label="Day">
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="From">
            <Input type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="time" step={900} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label="Project">
          <ProjectSelect value={project} onChange={setProject} projects={projects} />
        </Field>
        <Field label="Notes">
          <textarea className={cn(textarea, "h-20")} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {work && !isNew && (
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" className="accent-(--color-accent)" checked={done} onChange={(e) => setDone(e.target.checked)} /> Done
          </label>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ───────────────────────────── task ─────────────────────────────

export function TaskDialog() {
  const draft = useUi((s) => s.taskEdit);
  return draft ? <TaskForm key={draft.id ?? "new"} draft={draft} /> : null;
}

function TaskForm({ draft }: { draft: Partial<PlanTask> }) {
  const close = () => useUi.getState().editTask(null);
  const { projects, state, busy, prefs } = usePlanData();
  const act = usePlanActions();
  const toast = useUi((s) => s.toast);
  const [title, setTitle] = useState(draft.title ?? "");
  const [project, setProject] = useState<string | null>(draft.project ?? null);
  const [priority, setPriority] = useState(String(draft.priority ?? 0));
  const [estimate, setEstimate] = useState(durInput(draft.estimateMin ?? null));
  const [due, setDue] = useState(draft.dueDay ?? "");
  const [notes, setNotes] = useState(draft.notes ?? "");
  const [idea, setIdea] = useState(draft.kind === "idea");
  const [sub, setSub] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isNew = !draft.id;
  const children = draft.id ? state.tasks.filter((t) => t.parentId === draft.id) : [];

  const value = (): (Partial<PlanTask> & { title: string }) | null => {
    const minutes = estimate.trim() === "" ? null : parseDur(estimate);
    if (estimate.trim() !== "" && minutes === null) {
      setError("Estimate: write 2h, 1h30 or 45m.");
      return null;
    }
    if (!title.trim()) {
      setError("A title is required.");
      return null;
    }
    return { ...draft, title: title.trim(), project, priority: Number(priority), estimateMin: minutes, dueDay: due || null, notes, kind: idea ? "idea" : "task" };
  };
  const save = () => {
    const v = value();
    if (v) act.saveTask.mutate(v, { onSuccess: close });
  };
  /** Saves, then puts the task in the first free time that can hold it. */
  const plan = () => {
    const v = value();
    if (!v) return;
    act.saveTask.mutate(v, {
      onSuccess: (t) => {
        const minutes = t.estimateMin ?? prefs.sessionMinutes;
        const slot = freeSlots(busy, prefs, Date.now() + 10 * MIN, addDays(Date.now(), 14), Math.min(minutes, prefs.sessionMinutes))[0];
        if (!slot) return toast({ kind: "error", title: "No free time in the next two weeks", detail: "The task stays in the inbox." });
        const end = Math.min(slot.end, slot.start + Math.min(minutes, prefs.sessionMinutes) * MIN);
        act.saveEvent.mutate({ kind: "task", title: t.title, project: t.project, taskId: t.id, start: Math.floor(slot.start / 1000), end: Math.floor(end / 1000) });
        toast({ kind: "ok", title: "Planned", detail: `${new Date(slot.start).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}, ${hhmm(slot.start)} – ${hhmm(end)}` });
        close();
      },
    });
  };

  return (
    <Modal
      open
      onClose={close}
      title={isNew ? "New task" : "Task"}
      width="w-[520px]"
      footer={
        <>
          {!isNew && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              icon={<Trash2 className="size-3.5" />}
              onClick={() => {
                act.removeTask.mutate(draft.id!);
                close();
              }}
            >
              Delete
            </Button>
          )}
          {!idea && (
            <Button onClick={plan} title="Saves the task and places it in the first free time">
              Save and plan
            </Button>
          )}
          <Button variant="primary" icon={<Check className="size-3.5" />} busy={act.saveTask.isPending} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Input autoFocus aria-label="Title" placeholder="What needs to be done?" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Project">
            <ProjectSelect value={project} onChange={setProject} projects={projects} />
          </Field>
          <Field label="Priority">
            <Select label="Priority" value={priority} onChange={setPriority} options={PRIORITY.map((label, i) => ({ value: String(i), label }))} />
          </Field>
          <Field label="Estimate" hint="2h, 1h30, 45m">
            <Input placeholder="none" value={estimate} onChange={(e) => setEstimate(e.target.value)} />
          </Field>
          <Field label="Due">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea className={cn(textarea, "h-20")} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {!isNew && !idea && (
          <div>
            <SectionLabel className="mb-1.5">Sub-tasks</SectionLabel>
            <ul className="flex flex-col">
              {children.map((c) => (
                <li key={c.id} className="group flex h-8 items-center gap-2 text-[13px]">
                  <input type="checkbox" className="accent-(--color-accent)" checked={c.doneAt !== null} onChange={() => act.toggleTask(c)} />
                  <span className={cn("min-w-0 flex-1 truncate", c.doneAt !== null && "text-faint line-through")}>{c.title}</span>
                  <IconButton label="Delete sub-task" className="opacity-0 group-hover:opacity-100" onClick={() => act.removeTask.mutate(c.id)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
            <Input
              className="mt-1"
              placeholder="Add a sub-task and press Enter"
              value={sub}
              onChange={(e) => setSub(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (!sub.trim()) return;
                act.saveTask.mutate({ title: sub.trim(), parentId: draft.id, project });
                setSub("");
              }}
            />
          </div>
        )}
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" className="accent-(--color-accent)" checked={idea} onChange={(e) => setIdea(e.target.checked)} /> Just an idea — keep it in the inbox, never schedule it
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ───────────────────────────── quick capture ─────────────────────────────

/** One line, from any screen (Ctrl+I): lands in the inbox, to be sorted later. */
export function QuickCapture() {
  const open = useUi((s) => s.captureOpen);
  return open ? <CaptureForm /> : null;
}

function CaptureForm() {
  const close = () => useUi.getState().setCaptureOpen(false);
  const { projects } = usePlanData();
  const act = usePlanActions();
  const toast = useUi((s) => s.toast);
  const [title, setTitle] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [idea, setIdea] = useState(false);
  const save = (keep: boolean) => {
    if (!title.trim()) return;
    act.saveTask.mutate(
      { title: title.trim(), project, kind: idea ? "idea" : "task" },
      {
        onSuccess: () => {
          toast({ kind: "ok", title: idea ? "Idea kept" : "Added to the inbox" });
          if (keep) setTitle("");
          else close();
        },
      },
    );
  };
  return (
    <Modal open onClose={close} title="Quick capture" description="Enter saves it to the inbox. Ctrl+Enter saves and keeps this open for the next one." width="w-[520px]">
      <form
        className="flex flex-col gap-2 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
      >
        <Input
          autoFocus
          aria-label="Task or idea"
          className="h-10 text-sm"
          placeholder="A task, an idea, something not to forget…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              save(true);
            }
          }}
        />
        <div className="flex items-center gap-2">
          <ProjectSelect className="w-56" size="sm" value={project} onChange={setProject} projects={projects} />
          <button type="button" role="switch" aria-checked={idea} onClick={() => setIdea(!idea)} className={cn("flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors duration-150", idea ? "border-transparent bg-accent-soft text-accent-strong" : "border-white/8 text-muted hover:text-fg")}>
            <Lightbulb className="size-3.5" /> Idea
          </button>
          <Button className="ml-auto" size="sm" variant="primary" icon={<Plus className="size-3.5" />} busy={act.saveTask.isPending} onClick={() => save(false)}>
            Capture
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ───────────────────────────── preferences ─────────────────────────────

const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function PrefsDialog({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = usePlanPrefs();
  const [p, setP] = useState<PlanPrefs>(prefs);
  const [error, setError] = useState<string | null>(null);
  const num = (label: string, value: number, key: "maxMinutesPerDay" | "sessionMinutes" | "breakMinutes", hint: string) => (
    <Field label={label} hint={hint}>
      <Input
        defaultValue={durInput(value)}
        onBlur={(e) => {
          const m = parseDur(e.target.value, "min");
          if (m !== null) setP((x) => ({ ...x, [key]: m }));
        }}
      />
    </Field>
  );
  const save = () => {
    if (p.dayEnd - p.dayStart < 60) return setError("Working hours must span at least an hour.");
    if (p.sessionMinutes < 30 || p.maxMinutesPerDay < 30) return setError("A session and the daily maximum are at least 30 minutes.");
    if (p.workDays.length === 0) return setError("Pick at least one day.");
    setPrefs(p);
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Planning preferences"
      description="Used when TekBoard or Claude looks for free time. Your own entries can go anywhere."
      width="w-[520px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Work from">
            <Input type="time" step={900} value={hhmmOf(p.dayStart)} onChange={(e) => setP({ ...p, dayStart: minutesOf(e.target.value) ?? p.dayStart })} />
          </Field>
          <Field label="Until">
            <Input type="time" step={900} value={hhmmOf(p.dayEnd)} onChange={(e) => setP({ ...p, dayEnd: minutesOf(e.target.value) ?? p.dayEnd })} />
          </Field>
        </div>
        <Field label="Days work can be planned on">
          <div className="flex gap-1">
            {WEEK.map((d) => {
              const on = p.workDays.includes(d);
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => setP({ ...p, workDays: on ? p.workDays.filter((x) => x !== d) : [...p.workDays, d] })} className={cn("h-8 flex-1 rounded-md border text-xs capitalize transition-colors duration-150", on ? "border-transparent bg-accent-soft text-accent-strong" : "border-white/8 text-muted hover:text-fg")}>
                  {new Date(2024, 0, d === 0 ? 7 : d).toLocaleDateString(undefined, { weekday: "short" })}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          {num("Most work per day", p.maxMinutesPerDay, "maxMinutesPerDay", "4h, 5h30…")}
          {num("Session length", p.sessionMinutes, "sessionMinutes", "1h30, 2h…")}
          {num("Break between", p.breakMinutes, "breakMinutes", "15m, 30m…")}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" className="accent-(--color-accent)" checked={p.morningPlan} onChange={(e) => setP({ ...p, morningPlan: e.target.checked })} /> Offer a plan for the day on the dashboard when nothing is planned yet (computed here, no Claude)
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

// ───────────────────────────── weekly review ─────────────────────────────

export function ReviewDialog({ onClose }: { onClose: () => void }) {
  const { state, projects, items } = usePlanData();
  const now = useNow().getTime();
  const [offset, setOffset] = useState(0);
  const from = addDays(startOfWeek(now), offset * 7);
  const to = addDays(from, 7);
  const name = (key: string | null) => (key ? (projects.find((p) => p.key === key)?.title ?? key.split("/").pop() ?? key) : "No project");
  const color = (key: string | null) => projects.find((p) => p.key === key)?.color ?? "var(--color-faint)";

  const logged = state.log.filter((l) => l.startedAt * 1000 >= from && l.startedAt * 1000 < to);
  const perProject = new Map<string | null, number>();
  for (const l of logged) perProject.set(l.project, (perProject.get(l.project) ?? 0) + l.seconds / 60);
  const totalLogged = [...perProject.values()].reduce((a, b) => a + b, 0);
  const sessions = state.events.filter((e) => (e.kind === "session" || e.kind === "task") && e.start * 1000 >= from && e.start * 1000 < to);
  const plannedMin = sessions.reduce((s, e) => s + (e.end - e.start) / 60, 0);
  const past = sessions.filter((e) => e.end * 1000 <= now);
  const doneSessions = past.filter((e) => e.done).length;
  const doneTasks = state.tasks.filter((t) => t.doneAt !== null && t.doneAt * 1000 >= from && t.doneAt * 1000 < to);
  const open = state.tasks.filter((t) => t.doneAt === null && t.kind === "task" && t.parentId === null);
  const notDone = offset === 0 ? missed(state.events, now, 7) : past.filter((e) => !e.done);
  const handIns = items.filter((i) => i.kind === "deadline" && i.end >= to && i.end < addDays(to, 7));
  const max = Math.max(1, ...perProject.values());

  const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) => (
    <div className="rounded-lg border border-white/7 px-3 py-2.5">
      <p className="text-xs text-faint">{label}</p>
      <p className="display mt-0.5 text-xl font-medium">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );

  return (
    <Modal open onClose={onClose} title="Weekly review" width="w-[640px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-1">
          <IconButton label="Previous week" onClick={() => setOffset(offset - 1)}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <IconButton label="Next week" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>
            <ChevronRight className="size-4" />
          </IconButton>
          <span className="ml-1 text-[13px] text-muted">
            {new Date(from).toLocaleDateString(undefined, { day: "numeric", month: "long" })} – {new Date(addDays(to, -1)).toLocaleDateString(undefined, { day: "numeric", month: "long" })}
            {offset === 0 && " · this week"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Time worked" value={fmtDur(totalLogged)} sub={`${logged.length} focus session${logged.length === 1 ? "" : "s"} timed`} />
          <Stat label="Sessions done" value={`${doneSessions} / ${past.length}`} sub={`${fmtDur(plannedMin)} planned this week`} />
          <Stat label="Tasks finished" value={doneTasks.length} sub={`${open.length} still open`} />
        </div>
        {perProject.size > 0 && (
          <div>
            <SectionLabel className="mb-2">Time per project</SectionLabel>
            <ul className="flex flex-col gap-1.5">
              {[...perProject.entries()].sort((a, b) => b[1] - a[1]).map(([key, minutes]) => (
                <li key={key ?? "none"} className="grid grid-cols-[160px_minmax(0,1fr)_64px] items-center gap-3 text-[13px]">
                  <span className="truncate">{name(key)}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-white/6">
                    <span className="block h-full rounded-full" style={{ width: `${(minutes / max) * 100}%`, background: color(key) }} />
                  </span>
                  <span className="text-right font-mono text-xs text-muted">{fmtDur(minutes)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {totalLogged === 0 && <p className="text-[13px] text-muted">No time was recorded this week. Start a session with Focus to record what you really spend.</p>}
        {doneTasks.length > 0 && (
          <div>
            <SectionLabel className="mb-1">Finished</SectionLabel>
            <ul className="flex flex-col text-[13px]">
              {doneTasks.slice(0, 12).map((t) => (
                <li key={t.id} className="flex h-7 items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-ok" />
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <span className="shrink-0 text-xs text-faint">{t.project ? name(t.project) : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(notDone.length > 0 || handIns.length > 0) && (
          <div>
            <SectionLabel className="mb-1">Left to do</SectionLabel>
            <ul className="flex flex-col text-[13px]">
              {notDone.slice(0, 8).map((e) => (
                <li key={e.id} className="flex h-7 items-center gap-2">
                  <Dot tone="warn" />
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  <span className="shrink-0 text-xs text-faint">planned {new Date(e.start * 1000).toLocaleDateString(undefined, { weekday: "short" })}, not marked done</span>
                </li>
              ))}
              {handIns.map((i) => (
                <li key={i.id} className="flex h-7 items-center gap-2">
                  <Dot tone="danger" />
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className="shrink-0 text-xs text-faint">hand-in {new Date(i.end).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}</span>
                </li>
              ))}
            </ul>
            {offset === 0 && notDone.length > 0 && (
              <Button
                className="mt-2"
                size="sm"
                onClick={() => {
                  onClose();
                  useUi.getState().openAssistant({ text: "#reorganize" });
                }}
              >
                Reorganize what was not done
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Runs `fn` when Ctrl+I is pressed anywhere. */
export function useCaptureShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        useUi.getState().setCaptureOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
