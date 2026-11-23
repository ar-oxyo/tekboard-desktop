// Live jobs. The backend sends `job-progress` (with the job id) whenever a job changes; the
// window then fetches only what is new (log after the bytes it has, activity entries after
// the ones it has) and merges it into the query cache. No polling loop per screen.
import { listen } from "@tauri-apps/api/event";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api, type JobView } from "./api";

export const jobKey = (id: number | null) => ["job", id] as const;

/** A job, kept current by `job-progress` events. A slow poll covers a missed event. */
export function useJob(id: number | null) {
  return useQuery({
    queryKey: jobKey(id),
    queryFn: () => api.jobGet(id!),
    enabled: id !== null,
    staleTime: Infinity,
    retry: false,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== "running" ? false : 5000),
  });
}

const inflight = new Set<number>();
const again = new Set<number>();

/** Merges a delta answer into the job already in the cache. Exported for the tests. */
export function mergeJob(prev: JobView, d: JobView): JobView {
  const log = d.logReset ? d.log : prev.log + d.log;
  const events = d.eventsFrom >= prev.events.length ? [...prev.events, ...d.events] : [...prev.events.slice(0, d.eventsFrom), ...d.events];
  return { ...d, log, events, logReset: false, eventsFrom: 0 };
}

async function refresh(qc: QueryClient, id: number) {
  if (inflight.has(id)) {
    again.add(id);
    return;
  }
  inflight.add(id);
  try {
    do {
      again.delete(id);
      const prev = qc.getQueryData<JobView>(jobKey(id));
      if (!prev) return;
      // Entries already seen may still change (a tool call getting its result): re-read from the first one still running.
      const firstOpen = prev.events.findIndex((e) => (e as { status?: string }).status === "running");
      const eventsFrom = firstOpen >= 0 ? firstOpen : prev.events.length;
      const d = await api.jobGetSince(id, prev.logTotal, eventsFrom);
      const cur = qc.getQueryData<JobView>(jobKey(id)) ?? prev;
      qc.setQueryData(jobKey(id), mergeJob(cur, d));
    } while (again.has(id));
  } catch {
    // The job left memory: the next full read will say so.
  } finally {
    inflight.delete(id);
  }
}

/** Installs the listener once for the whole app. */
export function listenJobs(qc: QueryClient) {
  return listen<number>("job-progress", (e) => void refresh(qc, e.payload));
}
