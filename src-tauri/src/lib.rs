pub mod analytics;
pub mod commands;
pub mod cozy;
pub mod db;
pub mod doctor;
pub mod epitech;
pub mod error;
pub mod git;
pub mod github;
pub mod launcher;
pub mod scanner;
pub mod settings;
pub mod subjects;
pub mod templates;
pub mod workspace;

use commands::AppState;
use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let conn = db::open(&data_dir.join("tekboard.db"))?;
            templates::ensure_builtins(&data_dir.join("templates"))?;
            app.manage(AppState { db: Mutex::new(conn), data_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::suggest_roots,
            commands::env_status,
            commands::test_github_ssh,
            commands::scan_repos,
            commands::set_favorite,
            commands::recent_activity,
            commands::open_ide,
            commands::open_terminal,
            commands::open_workspace,
            commands::reveal_in_files,
            commands::github_status,
            commands::launch_candidates,
            commands::clone_project,
            commands::default_vars,
            commands::templates_list,
            commands::template_sources,
            commands::template_files,
            commands::template_read_file,
            commands::template_import,
            commands::template_duplicate,
            commands::template_delete,
            commands::template_edit,
            commands::template_plan,
            commands::template_apply,
            commands::stage_files,
            commands::commit_staged,
            commands::project_get,
            commands::project_save,
            commands::project_build,
            commands::subjects_list,
            commands::subjects_scan,
            commands::subjects_import,
            commands::subject_link,
            commands::subject_remove,
            commands::subject_open,
            commands::git_detail,
            commands::git_diff,
            commands::git_unstage,
            commands::git_sync,
            commands::git_create_branch,
            commands::git_switch_branch,
            commands::analytics,
            commands::cozy_status,
            commands::cozy_update,
            commands::cozy_send,
            commands::cozy_restore,
            commands::startup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TekBoard");
}
