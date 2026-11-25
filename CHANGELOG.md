# Notes de version

Chaque version publiée a sa section ici ; la release GitHub reprend ce texte.

## 0.8.0

**Code Playground** (Labo → Playground, ou « Nouveau brouillon C » dans la palette)
- Écrire quelques lignes de C et les lancer tout de suite, sans projet, sans dépôt ni Makefile : éditeur avec coloration, numéros de ligne, autocomplétion légère (mots-clés, libc, identifiants du brouillon), plusieurs onglets et plusieurs fichiers par brouillon, sauvegarde automatique.
- Compiler et lancer en un clic ou avec Ctrl+Entrée ; choix de gcc, clang ou epiclang selon ce qui est installé, options de compilation, arguments et entrée standard du programme.
- Erreurs et avertissements du compilateur et de l'édition de liens listés, soulignés dans le code et cliquables ; stdout et stderr séparés.
- AddressSanitizer, UndefinedBehaviorSanitizer et Valgrind en un clic : chaque problème mémoire est lu (type, octets, pile d'appels) et renvoie à la ligne en cause.
- Chaque exécution est isolée dans le bac à sable (bubblewrap : pas de réseau, système en lecture seule, environnement vidé), annulable, et limitée en temps, en mémoire et en nombre de processus (cgroup systemd quand c'est possible).
- Historique des brouillons fermés et des exécutions, avec restauration du code d'une exécution passée.
- Import de fonctions depuis les bibliothèques de TekBoard (avec leurs dépendances), export d'un brouillon en vrai projet (Makefile, .gitignore, git init facultatif).
- Artix, sur demande seulement : expliquer une erreur, le comportement ou les problèmes mémoire, proposer des cas limites ou un petit environnement de test, suggérer une correction sans l'appliquer, expliquer une notion.
- Doctor : nouvelle catégorie Labo (bac à sable, limites mémoire, clang, perf, python3, outils de Valgrind).

**Algorithm Arena** (Labo → Arena)
- Mesure un projet, une branche ou un commit d'un projet, ou un brouillon du Playground, sur des données de taille croissante : temps réel, temps CPU et mémoire maximale (outil de mesure à la microseconde), plusieurs exécutions avec échauffement, médiane, écart robuste et exécutions atypiques signalées.
- Compare deux versions (deux branches, deux commits, le dossier de travail et un commit, deux brouillons) sur exactement les mêmes données, sans modifier ton dossier ni ton dépôt : chaque version est copiée (git archive pour une révision) et construite à part.
- Générateurs de données en Python ou en C (`gen N SEED SORTIE`), graines reproductibles, aperçu des données utilisées.
- Avec Valgrind : instructions comptées à chaque taille (Callgrind), fonctions les plus coûteuses, pic du tas (Massif) et nombre d'allocations (Memcheck). Sans Valgrind, ces mesures sont signalées comme absentes, jamais estimées.
- Complexité estimée expérimentalement (moindres carrés sur 1, log n, n, n log n, n², n³, 2ⁿ) avec un niveau de confiance explicite ; « indéterminée » quand les mesures ne permettent pas de conclure.
- Graphiques interactifs (temps, CPU, mémoire, instructions, échelles logarithmiques), tableau des résultats, historique et benchmarks enregistrés.
- Lecture du code sans IA : boucles imbriquées, allocations ou entrées/sorties dans une boucle, `strlen` dans une condition, récursion multiple, tris quadratiques — présentées comme des hypothèses, distinctes des mesures.
- Artix, sur demande : écrit les générateurs et scénarios en direct (chaque fichier apparaît dès qu'il est complet, rien n'est exécuté avant ton accord), puis rédige le rapport final à partir des seules mesures (ce qui ralentit, preuves, limites, optimisations, compromis), sans toucher au code.

**TekBoard Connect** (Connect → Personnes) — facultatif, désactivé par défaut
- Retrouve les autres TekBoard du même réseau local qui ont activé Connect, par découverte mDNS / DNS-SD : pseudonyme, avatar et statut (disponible, en train de coder, en session de travail, disponible pour aider, ne pas déranger, invisible).
- Connexions directes chiffrées en TLS 1.3 mutuel, chaque appareil étant identifié par l'empreinte de son certificat ; aucun serveur, aucun compte, rien ne passe par Internet.
- Première connexion à deux : les deux écrans affichent le même code à 6 chiffres à comparer avant d'accepter ; l'empreinte est ensuite épinglée et la reconnexion est automatique.
- Contacts de confiance, blocage, oubli ; messages limités en taille et en débit ; un appareil non appairé ne peut rien envoyer d'autre qu'une demande.
- Code d'invitation (`tb1:…`) et connexion par adresse quand la découverte ne marche pas, diagnostic réseau en clair (interface, mDNS, test d'une adresse) : quand le réseau de l'école isole les appareils, TekBoard l'explique sans chercher à le contourner (pas de scan, pas de relais, aucune modification du pare-feu).
- Doctor : catégorie Connect.

**TekShare** (avec TekBoard Connect)
- Partage direct, entre personnes appairées, de fichiers, dossiers, extraits de code, fonctions C des bibliothèques, bibliothèques, modèles, prompts d'Artix, jeux de tests, benchmarks de l'Arena, journaux, messages d'erreur, patches Git, notes, brouillons du Playground et réglages d'apparence. « Partager » se trouve là où sont ces ressources (Playground, Arena, bibliothèques, modèles, prompts, rapport de tests, menu des projets) et dans Connect.
- Le destinataire voit l'expéditeur, le type, un aperçu et la taille, puis accepte ou refuse ; rien n'arrive sans son accord. Historique des transferts, progression, annulation.
- TekShare comprend ce qu'il reçoit et propose la bonne destination : une fonction dans les bibliothèques ou le Playground, un brouillon dans le Playground, un modèle dans les modèles, un prompt dans les prompts, des tests dans un projet, un benchmark dans l'Arena, un patch vérifié (`git apply --check`) puis appliqué sur demande, un journal ou une erreur à Artix, le reste dans Téléchargements.
- Sécurité : secrets (clés, jetons, cookies) et fichiers sensibles bloqués à l'envoi, avertissement sur les règles pédagogiques pour le code d'un projet de l'école et refus d'envoyer un dépôt d'école entier ; à l'arrivée, quarantaine, vérification de la taille et de l'empreinte SHA-256, extraction refusant chemins absolus, `..`, liens et archives piégées ; rien n'est jamais exécuté ni écrasé ; offres et débit limités.

## 0.7.0

**Choisir son IA** (Réglages → Artix (IA), et au premier lancement)
- Trois fournisseurs au choix, ou aucun : Claude Code, OpenRouter (clé API gratuite, modèles gratuits recommandés, test de connexion) et une IA locale avec Ollama (modèles installés détectés, modèle recommandé selon la mémoire de l'ordinateur, téléchargement guidé).
- OpenRouter n'utilise jamais un modèle payant sans accord explicite : le prix du modèle est revérifié avant chaque requête, et aucun modèle de secours n'est envoyé.
- La clé OpenRouter est gardée à part, dans un fichier lisible par toi seul ; elle n'est jamais renvoyée à l'interface ni écrite dans les journaux.
- Chat, planning, lecture des sujets, analyse de projet et README fonctionnent avec les trois. La moulinette d'Artix et la génération de tests restent réservées à Claude Code, et l'interface le dit.
- Sans IA, chaque écran concerné l'indique et renvoie vers les réglages ; le reste de TekBoard fonctionne normalement.
- Une installation 0.6 garde Claude Code comme IA.

**Installation**
- `install.sh` : installation guidée en une commande (Ubuntu/Debian, Fedora, Arch), qui détecte ce qui est déjà là, installe TekBoard après vérification SHA-256, propose les outils optionnels (gh, epiclang et Banana depuis le PPA d'Epitech, valgrind, bubblewrap…), aide à `gh auth login` et peut être relancée sans risque. Options `--minimal`, `--dry-run`, `--dev`, `--uninstall`.

**TekBoard Doctor** (Réglages → Doctor)
- Vérifie les outils, GitHub, MY Epitech, l'IA, epiclang, la base de données, les permissions, les dossiers de projets et les mises à jour, avec un état clair, ce que chaque problème affecte et comment le résoudre.
- Réparations sans risque (permissions, sauvegarde puis optimisation de la base, retrait d'un dossier disparu après confirmation) et export d'un rapport anonymisé pour un ticket.
- Proposé au démarrage quand un problème bloquant est détecté, et montré pendant le premier lancement.

**Skill Tree** (École → Skill Tree)
- Ta progression en arbre interactif (zoom, déplacement, fiche détaillée) : blocs de compétences, unités, acquis d'apprentissage et projets, reliés par les relations officielles de MY Epitech.
- Crédits obtenus face à l'objectif, crédits assurés et atteignables, unités restant à valider, derniers jalons datés ; filtres par année, semestre, domaine et statut ; consultable hors ligne.
- Le domaine d'une unité (programmation, système…) est la seule déduction de TekBoard, toujours signalée comme estimation.

**Projets**
- Détection des dépôts dans les sous-dossiers jusqu'à 8 niveaux, y compris dans un dossier lui-même versionné ; les sous-modules, les `.git` vides, `node_modules` et les caches sont ignorés ; les liens symboliques sont suivis sans boucle ni doublon.
- Un dépôt déjà cloné ailleurs dans tes dossiers n'est plus recloné.

## 0.6.1

- Nouveau logo, sombre comme l'application : un T violet dans un anneau de progression, repris dans l'icône, la barre latérale et l'écran de lancement (l'anneau se remplit au démarrage).
- Le README et l'assistant de premier lancement précisent que TekBoard est un projet personnel et indépendant, sans lien avec Epitech.

## 0.6.0

Première version publique.

**Installation et premier lancement**
- Paquets `.deb` (Ubuntu, Debian) et AppImage (autres distributions) attachés à chaque release, signés.
- Écran de lancement discret, qui disparaît dès que l'application est prête.
- Assistant de premier lancement : langue et apparence, connexion MY Epitech, dossiers de projets. Chaque étape facultative se passe ; il reprend où tu l'as laissé et se relance depuis Réglages → Général.

**Mises à jour et données**
- Réglages → Mises à jour : version installée, recherche de la dernière release, notes, installation en un clic (AppImage sans mot de passe, `.deb` par la demande de mot de passe du système), vérification automatique quotidienne désactivable.
- Réglages → Données : emplacement des fichiers, export et restauration d'une sauvegarde, vidage du cache, réinitialisation des réglages ou de tout Tekboard. Les dépôts ne sont jamais touchés.
- Démarrage robuste : base illisible mise de côté, réglages abîmés réparés, base d'une version plus récente laissée intacte.

**Artix** (anciennement Tika)
- Nouveau nom, petit robot animé (attente, réflexion, action, succès, erreur).
- Comprend les demandes implicites (« RDV jeudi 14 h » crée l'événement), demande seulement ce qui manque, confirme ce qui est destructif. Réponses beaucoup plus courtes.
- Une action lancée depuis un écran (décomposer, planifier) ouvre sa propre conversation.
- Décomposition séparée de la planification : « Accepter » ou « Accepter et planifier ».

**École**
- Logtime : heures restantes sur les 30 h de la semaine, progression, jours, semaines précédentes.
- Sync MY Epitech en un bouton : ouvre MY si besoin, attend la connexion, synchronise, referme la fenêtre qu'il a ouverte.
- Sujets associés automatiquement aux projets (identifiant MY, puis nom exact) ; les cas incertains demandent une validation.

**Projets et calendrier**
- Masquer, archiver, restaurer un projet ; les copies d'un même dépôt sont signalées.
- Projets exclus du calendrier (par exemple Student Engagement) ; catégories d'événements personnalisées.
- Option « Epitech Projects Only », activée par défaut.
- Interface en français ou en anglais.

**Corrections**
- Listes déroulantes de nouveau cliquables à la souris.
- Les fenêtres et dialogues ne glissent plus depuis le coin de l'écran à l'ouverture.
- Onglet Library retiré de la fiche projet ; « Tout sélectionner » dans Bibliothèques.
