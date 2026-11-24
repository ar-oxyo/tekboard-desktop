//! Updates from the official GitHub releases. The release publishes `latest.json` (written by
//! the release workflow) with, for each package format, the file and its signature. A package
//! is installed only once its signature matches the public key built into this version
//! (`plugins.updater.pubkey` in `tauri.conf.json`): a file changed on the way is refused.
//!
//! How it installs depends on how Tekboard was installed:
//! - AppImage: the file is replaced in place, no password;
//! - .deb: `dpkg -i` through the system's password prompt (pkexec), since it is a system package;
//!   without a graphical prompt, the verified .deb is saved in Downloads to open by hand;
//! - built by hand (`cargo`, `tauri dev`): checking works, installing is not offered.
//! User data lives outside the package and is never touched.

use crate::error::{AppError, Result};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const RELEASES_URL: &str = "https://github.com/ar-oxyo/tekboard-desktop/releases";

/// The update found by the last check, kept for "Install".
#[derive(Default)]
pub struct Pending(pub Mutex<Option<Update>>);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallKind {
    Appimage,
    Deb,
    /// Built from the sources: nothing to install over.
    Manual,
}

pub fn install_kind() -> InstallKind {
    use tauri::utils::config::BundleType;
    match tauri::utils::platform::bundle_type() {
        Some(BundleType::AppImage) if std::env::var_os("APPIMAGE").is_some() => InstallKind::Appimage,
        Some(BundleType::Deb) => InstallKind::Deb,
        _ => InstallKind::Manual,
    }
}

/// A graphical password prompt the .deb install can go through.
fn can_elevate() -> bool {
    ["pkexec", "zenity", "kdialog"].iter().any(|p| crate::toolenv::which(p).is_some())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub install: InstallKind,
    /// Tekboard can install the update itself.
    pub can_install: bool,
    /// The install asks for the system password (system package).
    pub needs_password: bool,
    pub releases_url: &'static str,
}

pub fn info<R: Runtime>(app: &AppHandle<R>) -> UpdateInfo {
    let install = install_kind();
    let can_install = match install {
        InstallKind::Appimage => true,
        InstallKind::Deb => can_elevate(),
        InstallKind::Manual => false,
    };
    UpdateInfo { version: app.package_info().version.to_string(), install, can_install, needs_password: install == InstallKind::Deb, releases_url: RELEASES_URL }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    pub version: String,
    pub current: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// Turns the updater's errors into something a student can act on.
fn explain(e: tauri_plugin_updater::Error) -> AppError {
    use tauri_plugin_updater::Error as E;
    match e {
        E::Reqwest(_) | E::Network(_) => AppError::new("update_offline", "GitHub ne répond pas. Vérifie ta connexion Internet, puis réessaie."),
        E::ReleaseNotFound => AppError::new("update_no_release", "Aucune version publiée n'a été trouvée sur GitHub."),
        E::TargetNotFound(_) | E::TargetsNotFound(_) => AppError::new("update_no_package", "La dernière version ne propose pas de paquet pour ce format d'installation. Télécharge-la depuis la page des versions."),
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) => AppError::new("update_signature", "La signature du paquet téléchargé ne correspond pas : il n'a pas été installé. Réessaie plus tard ou télécharge la version depuis GitHub."),
        other => AppError::new("update_failed", format!("La mise à jour n'a pas abouti : {other}. Tekboard n'a pas été modifié.")),
    }
}

fn updater<R: Runtime>(app: &AppHandle<R>) -> Result<tauri_plugin_updater::Updater> {
    let mut b = app.updater_builder().timeout(std::time::Duration::from_secs(30));
    // A local test server (the signature is still checked against the built-in key).
    if let Some(url) = std::env::var("TEKBOARD_UPDATE_URL").ok().filter(|u| !u.is_empty()) {
        let url = url.parse().map_err(|_| AppError::new("update_failed", "TEKBOARD_UPDATE_URL n'est pas une adresse valide"))?;
        b = b.endpoints(vec![url]).map_err(explain)?;
    }
    b.build().map_err(explain)
}

pub async fn check<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Available>> {
    let found = updater(app)?.check().await.map_err(explain)?;
    let out = found.as_ref().map(|u| Available { version: u.version.clone(), current: u.current_version.clone(), notes: u.body.clone(), date: u.date.map(|d| d.to_string()) });
    *app.state::<Pending>().0.lock().unwrap_or_else(|e| e.into_inner()) = found;
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    phase: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

fn pending<R: Runtime>(app: &AppHandle<R>) -> Result<Update> {
    app.state::<Pending>().0.lock().unwrap_or_else(|e| e.into_inner()).clone().ok_or_else(|| AppError::new("update_none", "Recherche d'abord une mise à jour."))
}

/// Downloads, checks the signature and installs. The app restarts afterwards (see the command).
pub async fn install<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let info = info(app);
    if !info.can_install {
        return Err(AppError::new("update_unsupported", "Cette installation ne peut pas se mettre à jour toute seule : télécharge la nouvelle version depuis GitHub."));
    }
    let update = pending(app)?;
    let mut done = 0u64;
    let emitter = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                done += chunk as u64;
                let _ = emitter.emit("update-progress", Progress { phase: "download", downloaded: done, total });
            },
            || (),
        )
        .await
        .map_err(|e| {
            let e = explain(e);
            if info.install == InstallKind::Deb && e.code() == "update_failed" {
                AppError::new("update_failed", "Le paquet n'a pas été installé (mot de passe refusé ou annulé). Tekboard n'a pas été modifié.")
            } else {
                e
            }
        })?;
    let _ = app.emit("update-progress", Progress { phase: "installed", downloaded: done, total: Some(done) });
    Ok(())
}

/// For a .deb without a graphical password prompt: the verified package goes to Downloads.
pub async fn save_package<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let update = pending(app)?;
    let bytes = update.download(|_, _| (), || ()).await.map_err(explain)?;
    let dir = app.path().download_dir().unwrap_or_else(|_| std::env::temp_dir());
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("TekBoard_{}_amd64.deb", update.version));
    std::fs::write(&path, bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

/// `0.5.0 < 0.5.1 < 0.10.0`, prereleases before their release. The updater compares with the
/// same rules (semver); this is what the UI uses to label versions.
pub fn newer(candidate: &str, current: &str) -> bool {
    match (semver::Version::parse(candidate.trim_start_matches('v')), semver::Version::parse(current.trim_start_matches('v'))) {
        (Ok(a), Ok(b)) => a > b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_as_numbers() {
        assert!(newer("0.5.1", "0.5.0"));
        assert!(newer("0.10.0", "0.9.3"));
        assert!(newer("v1.0.0", "0.99.0"));
        assert!(newer("0.6.0", "0.6.0-beta.2"));
        assert!(!newer("0.5.0", "0.5.0"));
        assert!(!newer("0.4.2", "0.5.0"));
        assert!(!newer("garbage", "0.5.0"));
    }

    #[test]
    fn a_build_from_the_sources_is_not_offered_an_install() {
        assert_eq!(install_kind(), InstallKind::Manual);
    }
}
