// First-run assistant: five short steps, each optional one can be skipped. The step reached is
// saved in the settings, so closing Tekboard (or switching the language, which reloads the
// window) resumes there. Shown again from Settings → General → "Relancer l'assistant".
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, CalendarClock, CircleCheck, FolderGit2, GraduationCap, LineChart, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Select } from "../../components/Select";
import { Button, cn, ErrorNote, Field } from "../../components/ui";
import { api, asAppError, type MySyncReport, type Settings } from "../../lib/api";
import { keys, useSettings } from "../../lib/hooks";
import { applyLang, plural, t } from "../../lib/i18n";
import { useUi } from "../../lib/store";
import { useMySync } from "../myepitech/useMySync";
import { Onboarding as RootsPicker } from "../settings/Onboarding";
import { ThemePicker } from "../settings/SettingsPage";

const STEPS = ["welcome", "personalize", "my", "projects", "done"] as const;
type Step = (typeof STEPS)[number];
const CONSENT_KEY = "tekboard.my.consent";

export function OnboardingFlow() {
  const settings = useSettings();
  const qc = useQueryClient();
  const s = settings.data!;
  const step: Step = (STEPS as readonly string[]).includes(s.onboardingStep) ? (s.onboardingStep as Step) : "welcome";
  const index = STEPS.indexOf(step);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(patch: Partial<Settings>): Promise<Settings | null> {
    setError(null);
    try {
      const current = qc.getQueryData<Settings>(keys.settings) ?? s;
      const saved = await api.saveSettings({ ...current, ...patch });
      qc.setQueryData(keys.settings, saved);
      return saved;
    } catch (e) {
      setError(asAppError(e).message);
      return null;
    }
  }
  const go = (next: Step) => void save({ onboardingStep: next });
  const forward = () => go(STEPS[Math.min(index + 1, STEPS.length - 1)]);
  const back = () => go(STEPS[Math.max(index - 1, 0)]);

  async function finish() {
    setBusy(true);
    const saved = await save({ onboarded: true, onboardingStep: "done" });
    setBusy(false);
    if (saved) useUi.setState({ themeOverride: null, page: "overview" });
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-bg p-6">
      <div className="anim-rise w-full max-w-[640px]">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/tekboard.svg" alt="" className="size-7" />
            <span className="display text-[15px] font-medium">Tekboard</span>
          </div>
          {step !== "welcome" && (
            <span className="text-xs text-faint tabular-nums">{t("Étape {i} sur {n}", { i: index + 1, n: STEPS.length })}</span>
          )}
        </div>
        <div className="mb-6 flex gap-1.5" aria-hidden="true">
          {STEPS.map((id, i) => (
            <span key={id} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", i <= index ? "bg-accent" : "bg-white/8")} />
          ))}
        </div>

        <div className="rounded-(--radius-card) border border-line bg-surface p-6">
          {step === "welcome" && <Welcome />}
          {step === "personalize" && <Personalize s={s} save={save} />}
          {step === "my" && <MyStep />}
          {step === "projects" && <ProjectsStep s={s} save={save} onSaved={forward} />}
          {step === "done" && <Done s={s} />}
          {error && (
            <div className="mt-4">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div>
            {index > 0 && step !== "done" && (
              <Button variant="ghost" icon={<ArrowLeft className="size-3.5" />} onClick={back}>
                {t("Retour")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(step === "my" || step === "projects") && (
              <Button variant="ghost" onClick={forward}>
                {t("Passer")}
              </Button>
            )}
            {step === "welcome" && (
              <Button variant="primary" onClick={forward}>
                {t("Commencer")}
              </Button>
            )}
            {(step === "personalize" || step === "my") && (
              <Button variant="primary" onClick={forward}>
                {t("Continuer")}
              </Button>
            )}
            {step === "done" && (
              <Button variant="primary" busy={busy} onClick={() => void finish()}>
                {t("Ouvrir Tekboard")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Welcome() {
  const items = [
    { icon: FolderGit2, text: t("Organise tes projets Epitech : dépôts, rendus et état en un coup d'œil.") },
    { icon: LineChart, text: t("Suis ton travail : commits, tests, logtime de la semaine.") },
    { icon: CalendarClock, text: t("Planifie tes sessions dans un calendrier qui garde des pauses.") },
    { icon: GraduationCap, text: t("Synchronise MY Epitech : projets, dates, sujets, résultats.") },
    { icon: Bot, text: t("Artix, ton assistant, crée et range pour toi quand tu le lui demandes.") },
  ];
  return (
    <>
      <h1 className="display text-2xl font-medium">{t("Bienvenue sur Tekboard")}</h1>
      <p className="mt-1 text-[13px] text-muted">{t("Ton tableau de bord d'étudiant Epitech. Deux minutes pour le régler, tout se change ensuite dans les Réglages.")}</p>
      <ul className="mt-5 flex flex-col gap-3">
        {items.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-[13px]">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <Icon className="size-4" />
            </span>
            <span className="pt-1">{text}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Personalize({ s, save }: { s: Settings; save: (p: Partial<Settings>) => Promise<Settings | null> }) {
  const override = useUi((u) => u.themeOverride);
  const theme = override ?? s.theme;
  return (
    <>
      <h2 className="display text-lg font-medium">{t("À ton goût")}</h2>
      <p className="mt-1 text-[13px] text-muted">{t("Le changement s'affiche tout de suite.")}</p>
      <div className="mt-4 max-w-[260px]">
        <Field label={t("Langue")}>
          <Select
            label={t("Langue")}
            value={s.language}
            onChange={(v) => {
              // Saved first: the window reloads to apply the language and comes back here.
              void save({ language: v as Settings["language"], onboardingStep: "personalize" }).then((saved) => saved && applyLang(saved.language));
            }}
            options={[
              { value: "fr", label: "Français" },
              { value: "en", label: "English" },
            ]}
          />
        </Field>
      </div>
      <p className="mt-4 mb-[-8px] text-xs font-medium text-muted">{t("Apparence")}</p>
      <div className="-mx-4">
        <ThemePicker
          current={theme}
          onPick={(id) => {
            useUi.setState({ themeOverride: id });
            void save({ theme: id });
          }}
        />
      </div>
    </>
  );
}

function MyStep() {
  const status = useQuery({ queryKey: ["my-status"], queryFn: api.myStatus, refetchInterval: 3000, staleTime: 0 });
  const sync = useMySync();
  const [report, setReport] = useState<MySyncReport | null>(null);
  const [consent, setConsent] = useState(() => {
    try {
      return localStorage.getItem(CONSENT_KEY) === "yes";
    } catch {
      return false;
    }
  });
  const accept = (v: boolean) => {
    setConsent(v);
    try {
      localStorage.setItem(CONSENT_KEY, v ? "yes" : "no");
    } catch {
      /* not remembered */
    }
  };
  const connected = report !== null || (status.data?.lastSync ?? null) !== null;
  return (
    <>
      <h2 className="display text-lg font-medium">{t("Connecter MY Epitech")}</h2>
      <p className="mt-1 text-[13px] text-muted">{t("Tekboard récupère tes projets, leurs dates de rendu, tes sujets et ton logtime. Facultatif : tu pourras le faire plus tard depuis École.")}</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-faint">
        <li>{t("Tu te connectes sur le vrai site, dans une fenêtre à part (Microsoft et double authentification comme d'habitude). Tekboard ne voit jamais ton mot de passe.")}</li>
        <li>{t("Lecture seule, sur ton propre compte. La fenêtre se ferme seule une fois la synchronisation finie.")}</li>
      </ul>
      <label className="mt-4 flex items-center gap-2 text-[13px]">
        <input type="checkbox" className="accent-(--color-accent)" checked={consent} onChange={(e) => accept(e.target.checked)} />
        {t("J'accepte de garder une session MY Epitech dans TekBoard sur cet ordinateur")}
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant={connected ? "secondary" : "primary"}
          icon={<RefreshCw className={cn("size-3.5", sync.busy && "anim-spin")} />}
          disabled={!consent || sync.busy}
          disabledReason={!consent ? t("Coche d'abord l'accord ci-dessus") : null}
          onClick={() => void sync.sync().then((r) => r && setReport(r))}
        >
          {sync.busy ? sync.label : connected ? t("Synchroniser à nouveau") : t("Se connecter et synchroniser")}
        </Button>
        {connected && !sync.busy && (
          <span className="flex items-center gap-1.5 text-[13px] text-ok">
            <CircleCheck className="size-4" />
            {report ? [t("Synchronisé"), report.subjectsImported > 0 ? plural(report.subjectsImported, "{n} sujet récupéré", "{n} sujets récupérés") : null].filter(Boolean).join(" · ") : t("Déjà synchronisé")}
          </span>
        )}
      </div>
    </>
  );
}

function ProjectsStep({ s, save, onSaved }: { s: Settings; save: (p: Partial<Settings>) => Promise<Settings | null>; onSaved: () => void }) {
  return (
    <RootsPicker
      embedded
      onSaved={onSaved}
      extra={
        <label className="mt-4 flex items-start gap-3">
          <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={s.epitechOnly} onChange={(e) => void save({ epitechOnly: e.target.checked })} />
          <span>
            <span className="block text-[13px]">Epitech Projects Only</span>
            <span className="block text-xs text-faint">{t("Seuls les projets Epitech apparaissent dans les listes, le planning et pour Artix. Décoche pour voir aussi tes projets personnels.")}</span>
          </span>
        </label>
      }
    />
  );
}

function Done({ s }: { s: Settings }) {
  const status = useQuery({ queryKey: ["my-status"], queryFn: api.myStatus, staleTime: 0 });
  const rows = [
    [t("Langue"), s.language === "en" ? "English" : "Français"],
    [t("Apparence"), s.theme.charAt(0).toUpperCase() + s.theme.slice(1)],
    ["MY Epitech", status.data?.lastSync ? t("connecté") : t("plus tard (École → MY Epitech)")],
    [t("Dossiers de projets"), s.roots.length > 0 ? String(s.roots.length) : t("plus tard (Réglages → Général)")],
  ];
  return (
    <>
      <div className="flex items-center gap-2 text-ok">
        <CircleCheck className="size-6" />
        <h2 className="display text-2xl font-medium text-fg">{t("Tekboard est prêt !")}</h2>
      </div>
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-faint">{t("Ctrl+K ouvre la palette de commandes, Ctrl+J ouvre Artix.")}</p>
    </>
  );
}
