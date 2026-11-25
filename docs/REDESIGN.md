# Refonte graphique : suivi

Branche `redesign/tekboard-ui`. Document de travail, absorbé par `DESIGN.md` à la fin.

## Outils
- Captures : `npx vite` (port 1420), puis Playwright WebKit (installé hors du dépôt, dans le scratchpad de session) : `node shots.mjs <dossier> <page,…> <dark,light> <1280x800,…> [query]`. Le faux backend est `src/dev/` (paramètres `?page=&theme=&mode=&empty=1&fail=cmd`).
- Impeccable : `~/.claude/skills/impeccable/scripts/impeccable` (détecteur : `detect --json --changed`).

## Audit (avant)
- **Boîtes partout** : chaque bloc dans une `Card` bordée, des cartes dans des cartes (Aujourd'hui), titre de page en 24px plus sous-titre plus onglets, soit trois bandes empilées avant le contenu.
- **Navigation** : 7 entrées à plat, plus Artix et Inbox coincés entre elles, Modèles et Réglages en pied, deux lignes d'état. Aucun accès direct aux projets favoris, et aucune liste des raccourcis.
- **Thèmes** : 5 designs, tous sombres, avec 197 blancs translucides et 314 tailles en px dispersés (migrés vers les jetons). Dégradés sur les titres et les boutons (Neon, Cozy).
- **Accent** : violet générique, plusieurs boutons d'accent sur un même écran (Sujets, Modèles).
- **i18n** : textes anglais en dur dans `overview/Today.tsx` et `overview/OverviewPage.tsx` (« Needs time in your calendar », « No hand-in date is known… »).
- **Profils** : le nouveau venu voit beaucoup d'explications et de boîtes ; l'étudiant au quotidien n'a pas ses projets en cours à un clic ; le développeur n'a ni rail compact ni historique de navigation, et les raccourcis ne se découvrent pas.

## Avancement
| Groupe | Écrans | État |
|---|---|---|
| G0 | Faux backend + captures | fait |
| G1 | Jetons (texte, ink, well), mode clair/sombre/système | en cours |
| G2 | Composants partagés | à faire |
| G3 | Coque, barre latérale, palette, raccourcis | à faire |
| G4 | Aujourd'hui, Projets, fiche projet | à faire |
| G5 | Git, Tests, Bibliothèques, Modèles, outils, lanceur | à faire |
| G6 | Planning | à faire |
| G7 | MY Epitech, Logtime, Skill Tree, Sujets, Stats | à faire |
| G8 | Playground, Arena, Tableaux | à faire |
| G9 | Connect, TekLive, TekSpace | à faire |
| G10 | Artix, Brain Dump (capture, Inbox) | à faire |
| G11 | Réglages, Prompts, Cozy Fox, onboarding, démarrage | à faire |
| G12 | Mouvement | à faire |
| G13 | Validation | à faire |
| G14 | Documentation | à faire |
