// TekShare on the screen side: words for kinds, statuses and destinations, and who can receive.
import type { PeerView, Transfer } from "./api";
import { t } from "./i18n";

export const KIND_LABEL: Record<string, string> = {
  file: t("Fichier"),
  folder: t("Dossier"),
  snippet: t("Extrait de code"),
  cfunction: t("Fonction C"),
  library: t("Bibliothèque"),
  template: t("Modèle"),
  prompt: t("Prompt Artix"),
  tests: t("Jeu de tests"),
  arena: t("Rapport de benchmark"),
  log: t("Journal"),
  error: t("Message d'erreur"),
  patch: t("Patch Git"),
  note: t("Note"),
  draft: t("Brouillon du Playground"),
  config: t("Réglages TekBoard"),
  board: t("Tableau blanc"),
};

export const STATUS_LABEL: Record<Transfer["status"], string> = {
  offered: t("En attente de réponse"),
  sending: t("Envoi…"),
  sent: t("Envoyé"),
  receiving: t("Réception…"),
  received: t("Reçu, à ranger"),
  imported: t("Rangé"),
  declined: t("Refusé"),
  failed: t("Échec"),
  cancelled: t("Annulé"),
  expired: t("Expiré"),
};

export const DEST_LABEL: Record<string, string> = {
  playground: t("Ouvrir dans le Playground"),
  library: t("Ajouter aux bibliothèques"),
  template: t("Ajouter aux modèles"),
  prompt: t("Ajouter aux prompts"),
  project: t("Copier dans un projet"),
  patch: t("Appliquer à un projet"),
  arena: t("Ouvrir dans l'Arena"),
  artix: t("Faire analyser par Artix"),
  downloads: t("Enregistrer dans Téléchargements"),
  config: t("Appliquer à mes réglages"),
  board: t("Ajouter à mes tableaux"),
};

/** Paired people connected right now, who can receive (not the invisible or busy ones last). */
export function recipients(peers: PeerView[]): PeerView[] {
  const rank = (p: PeerView) => (p.profile.status === "dnd" ? 1 : 0);
  return peers.filter((p) => p.trusted && p.online && !p.blocked).sort((a, b) => rank(a) - rank(b) || a.profile.nick.localeCompare(b.profile.nick));
}

export function percent(tr: Transfer): number {
  return tr.size > 0 ? Math.min(100, Math.round((tr.progress / tr.size) * 100)) : 0;
}

export const ACTIVE: Transfer["status"][] = ["offered", "sending", "receiving"];
