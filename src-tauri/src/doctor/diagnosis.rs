//! TekBoard Doctor: everything TekBoard depends on, checked in one place, each with a clear
//! state, what it affects, how to fix it and, when it is safe, a fix TekBoard applies itself.
//!
//! Nothing here deletes or rewrites user data. The fixes are limited to: permissions of
//! TekBoard's own folders, a database backup followed by `VACUUM`/`REINDEX`, removing a
//! project folder that no longer exists from the settings (asked first: the folder itself is
//! never touched).

use super::anonymize::anonymize;
use crate::ai::provider::{self, Kind};
use crate::commands::AppState;
use crate::error::{AppError, Result};
use crate::github::GhStatus;
use serde::Serialize;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Ok,
    Warn,
    Error,
    /// Optional and not set up: nothing is wrong, a feature is just off.
    Unconfigured,
}

/// What the user can do about a check.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    /// `fix:<id>` (TekBoard does it, `doctor_fix`), `open:<settings tab>`, `my-connect`.
    pub id: String,
    pub label: String,
    /// Asked before anything is done (the text of the question).
    pub confirm: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: String,
    pub category: &'static str,
    pub title: String,
    pub status: Status,
    pub detail: String,
    /// The features that depend on it.
    pub affects: Option<String>,
    /// What to type, when the user has to do it.
    pub command: Option<String>,
    pub action: Option<Action>,
}

fn check(id: impl Into<String>, category: &'static str, title: impl Into<String>, status: Status, detail: impl Into<String>) -> Check {
    Check { id: id.into(), category, title: title.into(), status, detail: detail.into(), affects: None, command: None, action: None }
}

impl Check {
    fn affects(mut self, a: &str) -> Self {
        self.affects = Some(a.into());
        self
    }
    fn command(mut self, c: impl Into<String>) -> Self {
        self.command = Some(c.into());
        self
    }
    fn action(mut self, id: impl Into<String>, label: impl Into<String>, confirm: Option<String>) -> Self {
        self.action = Some(Action { id: id.into(), label: label.into(), confirm });
        self
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub at: i64,
    pub version: String,
    pub system: String,
    pub checks: Vec<Check>,
}

/// Facts the command gathers before (they need the window or the network).
pub struct Facts {
    pub version: String,
    pub my_connected: bool,
    pub my_last_sync: Option<i64>,
    pub my_stored: bool,
    /// `Ok(Some(v))`: version v is available; `Ok(None)`: up to date; `Err`: not checked.
    pub update: std::result::Result<Option<String>, String>,
    pub update_enabled: bool,
    /// Ask the AI a real question (slower).
    pub deep: bool,
}

/// Package to install a tool with, on the distribution TekBoard runs on.
fn install_cmd(tool: &str) -> String {
    let (apt, dnf, pacman) = match tool {
        "ssh" => ("openssh-client", "openssh-clients", "openssh"),
        "pdftotext" => ("poppler-utils", "poppler-utils", "poppler"),
        "bwrap" => ("bubblewrap", "bubblewrap", "bubblewrap"),
        "gh" => ("gh", "gh", "github-cli"),
        t => (t, t, t),
    };
    if crate::toolenv::which("apt-get").is_some() {
        format!("sudo apt install {apt}")
    } else if crate::toolenv::which("dnf").is_some() {
        format!("sudo dnf install {dnf}")
    } else if crate::toolenv::which("pacman").is_some() {
        format!("sudo pacman -S {pacman}")
    } else {
        "./install.sh".into()
    }
}

/// Tools: name, what for, what depends on it, required.
const TOOLS: &[(&str, &str, &str, bool)] = &[
    ("git", "Gestion de versions", "toute la liste des projets, l'état git, le clonage", true),
    ("ssh", "Accès aux dépôts en SSH", "clonage et push des dépôts Epitech", true),
    ("make", "Compilation", "compilation, tests, simulation de rendu, vérifications rapides", true),
    ("gcc", "Compilateur C", "compilation des projets C", false),
    ("valgrind", "Fuites mémoire", "vérification mémoire des vérifications rapides", false),
    ("gdb", "Débogueur", "débogage", false),
    ("gcovr", "Couverture de code", "rapport de couverture des tests", false),
    ("pdftotext", "Lecture des PDF", "lecture des sujets par l'IA", false),
];

fn version_of(bin: &str) -> Option<String> {
    let path = crate::settings::which(bin)?;
    let arg = match bin {
        "ssh" => "-V",
        "pdftotext" => "-v",
        _ => "--version",
    };
    crate::toolenv::first_line(&path, &[arg], std::time::Duration::from_secs(5)).ok().map(|l| l.chars().take(60).collect())
}

fn tools(out: &mut Vec<Check>) {
    for (bin, what, affects, required) in TOOLS {
        let c = match version_of(bin) {
            Some(v) => check(format!("tool.{bin}"), "Outils", *bin, Status::Ok, v),
            None if crate::settings::which(bin).is_some() => check(format!("tool.{bin}"), "Outils", *bin, Status::Warn, format!("{what} : installé mais ne répond pas à --version.")),
            None => check(format!("tool.{bin}"), "Outils", *bin, if *required { Status::Error } else { Status::Unconfigured }, format!("{what} : absent.")).command(install_cmd(bin)),
        };
        out.push(c.affects(affects));
    }
    // git 2.25 brings `git switch`/`restore` and sparse defaults TekBoard relies on.
    if let Some(v) = version_of("git") {
        let n: Vec<u32> = v.split_whitespace().nth(2).unwrap_or("").split('.').filter_map(|x| x.parse().ok()).collect();
        if n.len() >= 2 && (n[0], n[1]) < (2, 25) {
            out.push(check("tool.git.version", "Outils", "Version de git", Status::Warn, format!("{v} est ancien : certaines actions git peuvent échouer.")).command(install_cmd("git")).affects("actions git"));
        }
    }
    let ident = (crate::git::config_get(None, "user.name"), crate::git::config_get(None, "user.email"));
    out.push(match ident {
        (Some(_), Some(_)) => check("git.identity", "Outils", "Identité git", Status::Ok, "Nom et e-mail configurés."),
        _ => check("git.identity", "Outils", "Identité git", Status::Warn, "Nom ou e-mail git manquant : tes commits seront refusés.").command("git config --global user.name \"Prénom Nom\" && git config --global user.email prenom.nom@epitech.eu").affects("commits"),
    });
}

fn github(out: &mut Vec<Check>) {
    let c = match crate::github::status() {
        GhStatus::Ready { login } => check("github", "GitHub", "GitHub CLI", Status::Ok, format!("Connecté{}", login.map(|l| format!(" ({l})")).unwrap_or_default())),
        GhStatus::LoggedOut => check("github", "GitHub", "GitHub CLI", Status::Warn, "Installé, mais pas connecté à ton compte.").command("gh auth login"),
        GhStatus::Missing => check("github", "GitHub", "GitHub CLI", Status::Unconfigured, "Non installé.").command(install_cmd("gh")),
        GhStatus::Error { message } => check("github", "GitHub", "GitHub CLI", Status::Warn, format!("La vérification a échoué : {message}")),
    };
    out.push(c.affects("liste de tes dépôts GitHub, clonage depuis TekBoard"));
    let agent = std::env::var_os("SSH_AUTH_SOCK").map(|s| Path::new(&s).exists()).unwrap_or(false);
    out.push(if agent { check("ssh.agent", "GitHub", "Agent SSH", Status::Ok, "Disponible : tes clés SSH servent sans mot de passe.") } else { check("ssh.agent", "GitHub", "Agent SSH", Status::Warn, "Aucun agent SSH : un clonage SSH peut demander la phrase de passe de ta clé, ou échouer.").command("eval \"$(ssh-agent -s)\" && ssh-add").affects("clonage et push en SSH") });
}

fn my_epitech(out: &mut Vec<Check>, f: &Facts, now: i64) {
    let c = if f.my_connected {
        check("my", "MY Epitech", "Connexion MY Epitech", Status::Ok, "Session active.")
    } else {
        match f.my_last_sync {
            None => check("my", "MY Epitech", "Connexion MY Epitech", Status::Unconfigured, "Jamais connecté.").action("my-connect", "Se connecter", None),
            Some(_) => check("my", "MY Epitech", "Connexion MY Epitech", Status::Warn, if f.my_stored { "Session expirée : reconnecte-toi (une fenêtre s'ouvre)." } else { "Session fermée : reconnecte-toi." }).action("my-connect", "Se reconnecter", None),
        }
    };
    out.push(c.affects("projets, rendus, agenda, sujets, Skill Tree"));
    if let Some(at) = f.my_last_sync {
        let days = (now - at) / 86_400;
        out.push(if days > 7 { check("my.sync", "MY Epitech", "Dernière synchronisation", Status::Warn, format!("Il y a {days} jours : les données affichées peuvent être dépassées.")).action("my-connect", "Synchroniser", None) } else { check("my.sync", "MY Epitech", "Dernière synchronisation", Status::Ok, if days == 0 { "Aujourd'hui.".to_string() } else { format!("Il y a {days} jour(s).") }) });
    }
}

fn ai(out: &mut Vec<Check>, deep: bool) {
    let s = provider::status();
    let mut c = match (s.provider, s.configured) {
        (Kind::None, _) => check("ai", "IA", "Fournisseur d'IA", Status::Unconfigured, "Aucune IA choisie : TekBoard fonctionne sans, les fonctions d'Artix sont désactivées."),
        (k, false) => check("ai", "IA", "Fournisseur d'IA", Status::Error, format!("{} : {}", k.name(), s.detail.unwrap_or_default())),
        (k, true) => check("ai", "IA", "Fournisseur d'IA", Status::Ok, format!("{}{}", k.name(), s.model.map(|m| format!(" · {m}")).unwrap_or_default())),
    };
    if deep && c.status == Status::Ok && matches!(s.provider, Kind::OpenRouter | Kind::Ollama) {
        let t = crate::commands_ai::ai_provider_test();
        if !t.ok {
            c.status = Status::Error;
            c.detail = format!("{} — le test a échoué : {}", c.detail, t.detail);
        } else {
            c.detail = format!("{} — répond ({:.1} s)", c.detail, t.ms as f64 / 1000.0);
        }
    }
    out.push(c.affects("Artix, analyse des sujets et des projets, README").action("open:ai", "Réglages de l'IA", None));
    if s.provider == Kind::Claude {
        let bwrap = crate::ai::sandbox::check();
        out.push(match bwrap {
            Ok(()) => check("ai.sandbox", "IA", "Bac à sable des agents (bubblewrap)", Status::Ok, "Fonctionne."),
            Err(e) => check("ai.sandbox", "IA", "Bac à sable des agents (bubblewrap)", Status::Warn, e).command(install_cmd("bwrap")),
        }.affects("moulinette d'Artix, génération de tests"));
    }
}

fn epitech_tools(out: &mut Vec<Check>) {
    let c = crate::checker::detect();
    let ppa = "sudo add-apt-repository ppa:epitech/ppa && sudo apt install epiclang banana-coding-style-checker";
    let item = match (&c.epiclang, c.plugin, &c.repo_checker) {
        (Some(_), true, Some(_)) => check("epiclang", "Epitech", "epiclang et Banana", Status::Ok, format!("Installés{}", c.version.map(|v| format!(" (Banana {v})")).unwrap_or_default())),
        (None, _, None) => check("epiclang", "Epitech", "epiclang et Banana", Status::Unconfigured, "Non installés (publiés par Epitech pour Ubuntu).").command(ppa),
        (Some(_), false, _) => check("epiclang", "Epitech", "epiclang et Banana", Status::Warn, "epiclang est là mais pas son plugin Banana : les règles de style ne sont pas vérifiées.").command(ppa),
        _ => check("epiclang", "Epitech", "epiclang et Banana", Status::Warn, "Installation partielle : il manque epiclang ou banana-check-repo.").command(ppa),
    };
    out.push(item.affects("vérification Banana (style et fichiers du rendu)"));
}

fn mode(p: &Path) -> Option<u32> {
    std::fs::metadata(p).ok().map(|m| m.permissions().mode() & 0o777)
}

fn data(out: &mut Vec<Check>, state: &AppState) {
    let conn = state.conn();
    let integrity: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0)).unwrap_or_else(|e| e.to_string());
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap_or(-1);
    let size = std::fs::metadata(state.data_dir.join("tekboard.db")).map(|m| m.len()).unwrap_or(0);
    drop(conn);
    let expected = crate::db::schema_version() as i64;
    out.push(if integrity == "ok" && version == expected {
        check("db", "Données", "Base de données", Status::Ok, format!("Intacte · schéma {version} · {:.1} Mo", size as f64 / 1e6)).action("fix:db_optimize", "Optimiser", Some("TekBoard fait d'abord une copie de sauvegarde de la base, puis la compacte. Aucune donnée n'est retirée. Continuer ?".into()))
    } else if integrity != "ok" {
        check("db", "Données", "Base de données", Status::Error, format!("Le contrôle d'intégrité signale un problème : {integrity}. Exporte tes données (Réglages → Données) avant tout.")).action("open:data", "Réglages → Données", None)
    } else {
        check("db", "Données", "Base de données", Status::Warn, format!("Schéma {version}, attendu {expected} : redémarre TekBoard pour terminer la mise à jour."))
    });
    let mut bad = Vec::new();
    for (dir, want) in [(&state.data_dir, 0o700), (&state.cache_dir, 0o700)] {
        if mode(dir).is_some_and(|m| m & 0o077 != 0) {
            bad.push(format!("{} ({:o}, attendu {want:o})", dir.display(), mode(dir).unwrap_or(0)));
        }
    }
    if let Some(sec) = crate::ai::secrets::file().filter(|p| p.exists()) {
        if mode(&sec).is_some_and(|m| m & 0o077 != 0) {
            bad.push(format!("{} (lisible par d'autres comptes)", sec.display()));
        }
    }
    out.push(if bad.is_empty() { check("perms", "Données", "Permissions", Status::Ok, "Dossiers de TekBoard et clé API lisibles par toi seul.") } else { check("perms", "Données", "Permissions", Status::Warn, format!("Trop ouverts : {}", bad.join(", "))).action("fix:permissions", "Corriger", None) });
}

fn projects(out: &mut Vec<Check>, state: &AppState) {
    let Ok(settings) = state.settings() else { return };
    if settings.roots.is_empty() {
        out.push(check("roots", "Projets", "Dossiers de projets", Status::Unconfigured, "Aucun dossier choisi : TekBoard ne voit pas encore tes projets.").action("open:general", "Choisir un dossier", None));
        return;
    }
    for (i, root) in settings.roots.iter().enumerate() {
        let p = Path::new(root);
        let c = if !p.exists() {
            check(format!("root.{i}"), "Projets", format!("Dossier {}", i + 1), Status::Warn, format!("{root} n'existe plus (déplacé, ou disque non monté).")).action(format!("fix:remove_root:{i}"), "Retirer des réglages", Some(format!("Retirer {root} de la liste des dossiers suivis ? Le dossier lui-même n'est pas touché (il n'existe plus de toute façon).")))
        } else if std::fs::read_dir(p).is_err() {
            check(format!("root.{i}"), "Projets", format!("Dossier {}", i + 1), Status::Error, format!("{root} existe mais ne peut pas être lu (permissions)."))
        } else {
            check(format!("root.{i}"), "Projets", format!("Dossier {}", i + 1), Status::Ok, root.clone())
        };
        out.push(c);
    }
    match crate::commands::load_repos_all(state) {
        Ok((repos, _)) => {
            let broken = repos.iter().filter(|r| r.error.is_some()).count();
            let dups = repos.iter().filter(|r| r.duplicate_of.is_some()).count();
            let mut c = if broken == 0 { check("repos", "Projets", "Dépôts", Status::Ok, format!("{} dépôt(s) trouvé(s), tous lisibles", repos.len())) } else { check("repos", "Projets", "Dépôts", Status::Warn, format!("{broken} dépôt(s) sur {} illisibles par git (voir la liste des projets).", repos.len())) };
            if dups > 0 {
                c.detail.push_str(&format!(" · {dups} copie(s) en double repérée(s), rien n'est supprimé"));
            }
            out.push(c);
        }
        Err(e) => out.push(check("repos", "Projets", "Dépôts", Status::Error, e.to_string())),
    }
}

fn updates(out: &mut Vec<Check>, f: &Facts) {
    out.push(match (&f.update, f.update_enabled) {
        (Ok(None), _) => check("update", "Mises à jour", "TekBoard", Status::Ok, format!("{} : à jour", f.version)),
        (Ok(Some(v)), _) => check("update", "Mises à jour", "TekBoard", Status::Warn, format!("{} installé, {v} disponible.", f.version)).action("open:updates", "Mettre à jour", None),
        (Err(e), true) => check("update", "Mises à jour", "TekBoard", Status::Warn, format!("{} · la vérification a échoué : {e}", f.version)),
        (Err(_), false) => check("update", "Mises à jour", "TekBoard", Status::Unconfigured, format!("{} · vérification automatique désactivée", f.version)).action("open:updates", "Réglages", None),
    });
}

pub fn system() -> String {
    let distro = std::fs::read_to_string("/etc/os-release").ok().and_then(|t| t.lines().find_map(|l| l.strip_prefix("PRETTY_NAME=").map(|v| v.trim_matches('"').to_string()))).unwrap_or_else(|| "Linux".into());
    format!("{distro} · {}", std::env::consts::ARCH)
}

static LAST: std::sync::Mutex<Option<Report>> = std::sync::Mutex::new(None);

/// The last report, for the export.
pub fn last() -> Option<Report> {
    LAST.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

pub fn run(state: &AppState, f: &Facts) -> Report {
    let r = run_checks(state, f);
    *LAST.lock().unwrap_or_else(|e| e.into_inner()) = Some(r.clone());
    r
}

fn run_checks(state: &AppState, f: &Facts) -> Report {
    let now = chrono::Utc::now().timestamp();
    let mut checks = Vec::new();
    tools(&mut checks);
    github(&mut checks);
    my_epitech(&mut checks, f, now);
    ai(&mut checks, f.deep);
    epitech_tools(&mut checks);
    data(&mut checks, state);
    projects(&mut checks, state);
    updates(&mut checks, f);
    Report { at: now, version: f.version.clone(), system: system(), checks }
}

/// What was done, in words.
pub fn fix(state: &AppState, id: &str) -> Result<String> {
    match id {
        "permissions" => {
            for d in [&state.data_dir, &state.cache_dir] {
                std::fs::set_permissions(d, std::fs::Permissions::from_mode(0o700))?;
            }
            if let Some(sec) = crate::ai::secrets::file().filter(|p| p.exists()) {
                std::fs::set_permissions(&sec, std::fs::Permissions::from_mode(0o600))?;
            }
            Ok("Permissions corrigées : dossiers en 0700, clé API en 0600.".into())
        }
        "db_optimize" => {
            let dir = state.data_dir.join("backups");
            std::fs::create_dir_all(&dir)?;
            let dest = dir.join(format!("tekboard-{}.db", chrono::Local::now().format("%Y%m%d-%H%M%S")));
            let conn = state.conn();
            conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().as_ref()])?;
            std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o600))?;
            conn.execute_batch("REINDEX; VACUUM;")?;
            Ok(format!("Sauvegarde faite ({}), puis base compactée.", dest.display()))
        }
        other if other.starts_with("remove_root:") => {
            let i: usize = other["remove_root:".len()..].parse().map_err(|_| AppError::new("invalid_fix", "Réparation inconnue"))?;
            let conn = state.conn();
            let mut s = crate::settings::load(&conn)?;
            let root = s.roots.get(i).cloned().ok_or_else(|| AppError::new("invalid_fix", "Ce dossier n'est plus dans les réglages."))?;
            if Path::new(&root).exists() {
                return Err(AppError::new("invalid_fix", "Ce dossier existe de nouveau : il est gardé."));
            }
            s.roots.remove(i);
            if s.clone_dir.as_deref() == Some(root.as_str()) {
                s.clone_dir = None;
            }
            // Written as is: `settings::save` refuses missing folders, and others may be missing too.
            crate::db::set_setting(&conn, "app", &serde_json::to_string(&s)?)?;
            drop(conn);
            crate::commands::forget_scan();
            Ok(format!("{root} retiré des dossiers suivis."))
        }
        _ => Err(AppError::new("invalid_fix", "Réparation inconnue")),
    }
}

/// The report as Markdown, without anything that identifies the user.
pub fn export(state: &AppState, r: &Report) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let user = std::env::var("USER").or_else(|_| std::env::var("LOGNAME")).unwrap_or_default();
    let mut personal: Vec<(String, String)> = Vec::new();
    if let Ok(s) = state.settings() {
        for (i, root) in s.roots.iter().enumerate() {
            personal.push((root.clone(), format!("<dossier {}>", i + 1)));
        }
    }
    if !home.is_empty() {
        personal.push((home, "~".into()));
    }
    if user.len() >= 3 {
        personal.push((user, "<utilisateur>".into()));
    }
    if let GhStatus::Ready { login: Some(l) } = crate::github::status() {
        personal.push((l, "<compte GitHub>".into()));
    }
    for k in ["user.name", "user.email"] {
        if let Some(v) = crate::git::config_get(None, k) {
            personal.push((v, format!("<{k}>")));
        }
    }
    let mut md = format!("## Rapport TekBoard Doctor\n\n- TekBoard {}\n- {}\n- Généré le {}\n\n| | Vérification | État | Détail |\n|---|---|---|---|\n", r.version, r.system, chrono::DateTime::from_timestamp(r.at, 0).map(|d| d.format("%Y-%m-%d %H:%M UTC").to_string()).unwrap_or_default());
    for c in &r.checks {
        let (icon, word) = match c.status {
            Status::Ok => ("✅", "fonctionnel"),
            Status::Warn => ("⚠️", "avertissement"),
            Status::Error => ("❌", "erreur"),
            Status::Unconfigured => ("➖", "non configuré"),
        };
        md.push_str(&format!("| {icon} | {} · {} | {word} | {} |\n", c.category, c.title, c.detail.replace('|', "/").replace('\n', " ")));
    }
    md.push_str("\n_Rapport anonymisé : chemins personnels, comptes, e-mails, clés et jetons sont masqués._\n");
    crate::ai::secrets::scrub(&anonymize(&md, &personal))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn state() -> (tempfile::TempDir, AppState) {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("data")).unwrap();
        let conn = crate::db::open(&d.path().join("data/tekboard.db")).unwrap();
        let s = AppState::for_tests(Arc::new(Mutex::new(conn)), d.path().join("data"), d.path().join("cache"));
        (d, s)
    }

    fn facts() -> Facts {
        Facts { version: "0.7.0".into(), my_connected: false, my_last_sync: None, my_stored: false, update: Ok(None), update_enabled: true, deep: false }
    }

    #[test]
    fn every_check_has_a_state_and_the_report_is_anonymous() {
        let (_d, s) = state();
        let mut settings = crate::settings::load(&s.conn()).unwrap();
        settings.roots = vec!["/nonexistent/jdupont/Epitech".into()];
        crate::db::set_setting(&s.conn(), "app", &serde_json::to_string(&settings).unwrap()).unwrap();
        let r = run(&s, &facts());
        let ids: Vec<&str> = r.checks.iter().map(|c| c.id.as_str()).collect();
        for want in ["tool.git", "github", "my", "ai", "epiclang", "db", "perms", "root.0", "update"] {
            assert!(ids.contains(&want), "{want} missing in {ids:?}");
        }
        let root = r.checks.iter().find(|c| c.id == "root.0").unwrap();
        assert_eq!(root.status, Status::Warn);
        assert!(root.action.as_ref().unwrap().confirm.is_some(), "removing a root is asked first");
        assert_eq!(r.checks.iter().find(|c| c.id == "db").unwrap().status, Status::Ok);
        let md = export(&s, &r);
        assert!(!md.contains("jdupont") && md.contains("<dossier 1>"), "{md}");
    }

    #[test]
    fn fixes_keep_the_data() {
        let (d, s) = state();
        s.conn().execute("INSERT INTO activity (ts, kind) VALUES (1, 'kept')", []).unwrap();
        std::fs::set_permissions(&s.data_dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        fix(&s, "permissions").unwrap();
        assert_eq!(mode(&s.data_dir), Some(0o700));
        let said = fix(&s, "db_optimize").unwrap();
        assert!(said.contains("Sauvegarde"));
        assert_eq!(std::fs::read_dir(d.path().join("data/backups")).unwrap().count(), 1);
        let mut settings = crate::settings::load(&s.conn()).unwrap();
        settings.roots = vec!["/nonexistent/gone".into(), d.path().to_string_lossy().into_owned(), "/nonexistent/other".into()];
        crate::db::set_setting(&s.conn(), "app", &serde_json::to_string(&settings).unwrap()).unwrap();
        assert!(fix(&s, "remove_root:1").is_err(), "an existing folder is never removed");
        fix(&s, "remove_root:0").unwrap();
        assert_eq!(crate::settings::load(&s.conn()).unwrap().roots.len(), 2, "works even when another folder is missing too");
        assert!(fix(&s, "rm -rf").is_err());
        let kept: i64 = s.conn().query_row("SELECT COUNT(*) FROM activity WHERE kind = 'kept'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 1, "optimising keeps every row");
    }
}
