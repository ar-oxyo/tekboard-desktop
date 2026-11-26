// Ctrl+/ : every keyboard shortcut TekBoard answers to, in one sheet.
import { Modal } from "../components/Modal";
import { Kbd } from "../components/ui";
import { useUi } from "../lib/store";
import { t } from "../lib/i18n";
import { SECTIONS } from "./sections";

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const close = () => useUi.setState({ shortcutsOpen: false });
  const groups: Array<{ title: string; rows: Array<[string, string]> }> = [
    {
      title: t("Partout"),
      rows: [
        ["Ctrl K", t("Rechercher, ouvrir un projet, lancer une action")],
        ["Ctrl I", t("Noter une idée, un bug, une commande (Brain Dump)")],
        ["Ctrl J", t("Ouvrir ou fermer Artix")],
        ["Ctrl Maj J", t("Nouvelle conversation avec Artix")],
        ["Ctrl N", t("Nouveau projet")],
        ["Ctrl B", t("Replier ou déplier la barre latérale")],
        ["Alt ← / Alt →", t("Écran précédent, écran suivant")],
        ["Ctrl /", t("Cette liste")],
        ["Échap", t("Fermer la fenêtre ouverte")],
      ],
    },
    { title: t("Aller à"), rows: SECTIONS.slice(0, 9).map((s, i) => [`Ctrl ${i + 1}`, s.label] as [string, string]) },
    {
      title: t("Capture et éditeurs"),
      rows: [
        ["Entrée", t("Enregistrer la capture")],
        ["Maj Entrée", t("Nouvelle ligne")],
        ["Ctrl Entrée", t("Enregistrer et garder la capture ouverte ; lancer le Playground")],
      ],
    },
  ];
  return (
    <Modal open={open} onClose={close} title={t("Raccourcis clavier")} width="w-[720px]">
      <div className="grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-2">
        {groups.map((g) => (
          <section key={g.title} className={g.rows.length > 6 ? "md:row-span-2" : undefined}>
            <h3 className="mb-1.5 text-xs text-faint">{g.title}</h3>
            <ul className="flex flex-col">
              {g.rows.map(([keys, what]) => (
                <li key={keys} className="flex min-h-8 items-center justify-between gap-4 border-b border-line py-1 last:border-b-0">
                  <span className="text-sm text-muted">{what}</span>
                  <span className="flex shrink-0 gap-1">{keys.split(" / ").map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
