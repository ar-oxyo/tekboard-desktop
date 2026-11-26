// Widgets added in 1.0, built on data TekBoard already has (shared queries, no new request):
// the credit scenario, the Skill Tree blocks, the Inbox.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Meter, Section } from "../../components/ui";
import { api } from "../../lib/api";
import { evaluate, readScenario, unitsOf } from "../../lib/credits";
import { timeAgo } from "../../lib/format";
import { usePref } from "../../lib/hooks";
import { t } from "../../lib/i18n";
import { useUi } from "../../lib/store";

const more = (label: string, go: () => void) => (
  <button type="button" onClick={go} className="text-xs text-accent hover:underline">{label}</button>
);

export function CreditsWidget() {
  const tree = useQuery({ queryKey: ["my", "skill-tree"], queryFn: api.mySkillTree, staleTime: 60_000 });
  const list = useQuery({ queryKey: ["credit-scenarios"], queryFn: api.creditScenarios });
  const [current] = usePref<number | null>("credits.current", null);
  const row = (list.data ?? []).find((s) => s.id === current) ?? list.data?.[0] ?? null;
  const r = useMemo(() => evaluate(readScenario(row?.data), unitsOf(tree.data?.nodes ?? [])), [row, tree.data]);
  return (
    <Section title={t("Simulation de crédits")} action={more(t("Ouvrir"), () => useUi.getState().setPage("credits"))}>
      <div className="space-y-2 pt-3">
        <p className="leading-none">
          <span className="display text-2xl font-bold tabular-nums">{r.projected}</span>
          <span className="ml-1 text-muted tabular-nums">/ {r.objective}</span>
          <span className="ml-2 text-xs text-muted">{row ? row.name : t("prévus")}</span>
        </p>
        <Meter value={r.projected} max={r.objective} tone={r.missing > 0 ? "warn" : "ok"} label={t("{p} crédits prévus sur {o}", { p: r.projected, o: r.objective })} />
        <p className="text-xs text-muted">{t("{o} officiels · {s} simulés", { o: r.official, s: r.simulated })}{r.short.length > 0 && <span className="text-warn"> · {t("{n} UE sous le minimum", { n: r.short.length })}</span>}</p>
      </div>
    </Section>
  );
}

export function SkillWidget() {
  const tree = useQuery({ queryKey: ["my", "skill-tree"], queryFn: api.mySkillTree, staleTime: 60_000 });
  const branches = (tree.data?.branches ?? []).filter((b) => b.threshold);
  return (
    <Section title="Skill Tree" action={more(t("Ouvrir"), () => useUi.getState().setPage("skilltree"))}>
      {branches.length === 0 ? (
        <p className="pt-3 text-xs text-muted">{t("Synchronise MY Epitech pour voir tes blocs de compétences.")}</p>
      ) : (
        <ul className="space-y-2 pt-3">
          {branches.slice(0, 6).map((b) => (
            <li key={b.id} className="text-xs">
              <p className="mb-1 flex justify-between gap-2"><span className="truncate text-fg">{b.name}</span><span className="font-mono text-muted tabular-nums">{b.secure ?? 0}/{b.threshold}</span></p>
              <Meter value={b.secure ?? 0} max={b.threshold ?? 1} label={b.name} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function InboxWidget() {
  const list = useQuery({ queryKey: ["brain", "widget"], queryFn: () => api.brainList({ view: "inbox", limit: 5 }), staleTime: 30_000 });
  const items = list.data ?? [];
  return (
    <Section title="Inbox" action={more(t("Tout voir"), () => useUi.getState().openInbox())}>
      {items.length === 0 ? (
        <p className="pt-3 text-xs text-muted">{t("Rien à trier. Ctrl+I pour noter une idée.")}</p>
      ) : (
        <ul className="pt-2">
          {items.slice(0, 5).map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => useUi.getState().openInbox({ focus: c.id })} className="ink-row flex w-full items-baseline gap-2 rounded-(--btn-radius) px-1 py-1.5 text-left text-sm">
                <span className="min-w-0 flex-1 truncate">{c.title || c.text}</span>
                <span className="shrink-0 text-2xs text-faint">{timeAgo(c.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
