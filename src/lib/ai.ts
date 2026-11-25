// What the AI in use allows, in words the screens show as they are. One place, so every
// button says the same thing when a feature is not available.
import type { AiProviderStatus } from "./api";
import { t } from "./i18n";

export interface AiGate {
  /** A provider is chosen and set up. */
  ready: boolean;
  /** Conversation, planning, subject reading. */
  text: boolean;
  /** Reading a project (analysis, README, subject check). */
  read: boolean;
  /** Agents that edit files and run commands (moulinette, test generation). */
  agents: boolean;
  /** Why nothing AI works, or null. */
  why: string | null;
  /** Why the agents do not work, or null. */
  agentWhy: string | null;
  /** "Claude Code", "OpenRouter · model"… */
  name: string;
  /** Where what is read goes, for the privacy notes; null when it stays on this computer. */
  sendsTo: string | null;
}

const NAMES: Record<AiProviderStatus["provider"], string> = { none: t("Aucune IA"), claude: "Claude Code", openrouter: "OpenRouter", ollama: t("IA locale") };

export function aiGate(s: AiProviderStatus | undefined): AiGate {
  if (!s) return { ready: false, text: false, read: false, agents: false, why: t("Recherche de l'IA…"), agentWhy: t("Recherche de l'IA…"), name: "…", sendsTo: null };
  const name = s.model && s.provider !== "claude" ? `${NAMES[s.provider]} · ${s.model}` : NAMES[s.provider];
  const sendsTo = s.provider === "claude" ? "Anthropic" : s.provider === "openrouter" ? t("OpenRouter et l'hébergeur du modèle") : null;
  const why = s.provider === "none" ? t("Aucune IA n'est configurée : choisis-en une dans Réglages → Artix (IA).") : !s.configured ? (s.detail ?? t("L'IA choisie n'est pas prête : voir Réglages → Artix (IA).")) : null;
  const ready = why === null;
  const agentWhy = why ?? (s.caps.agents ? null : t("Nécessite Claude Code : cet agent modifie des fichiers et lance des commandes dans un bac à sable, ce que {name} ne sait pas faire de façon fiable.", { name: NAMES[s.provider] }));
  return { ready, text: ready && s.caps.text, read: ready && s.caps.readFiles, agents: ready && s.caps.agents, why, agentWhy, name, sendsTo };
}
