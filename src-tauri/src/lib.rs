pub mod analytics;
pub mod checker;
pub mod claude;
pub mod commands;
pub mod commands_dev;
pub mod commands_lib;
pub mod commands_my;
pub mod cozy;
pub mod cparse;
pub mod db;
pub mod doctor;
pub mod epitech;
pub mod error;
pub mod git;
pub mod github;
pub mod jobs;
pub mod launcher;
pub mod library;
pub mod moulinette;
pub mod myepitech;
pub mod myview;
pub mod packager;
pub mod readme;
pub mod scanner;
pub mod settings;
pub mod subjects;
pub mod templates;
pub mod testing;
pub mod testrepo;
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
            let cache_dir = app.path().app_cache_dir()?;
            std::fs::create_dir_all(&cache_dir)?;
            app.manage(AppState { db: std::sync::Arc::new(Mutex::new(conn)), data_dir, cache_dir, jobs: jobs::Jobs::default(), my: Mutex::new(myepitech::Session::default()), my_syncing: Mutex::new(false) });
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
            commands_lib::library_list,
            commands_lib::library_suggestions,
            commands_lib::library_add,
            commands_lib::library_unregister,
            commands_lib::library_catalog,
            commands_lib::library_read,
            commands_lib::library_set_meta,
            commands_lib::library_presets,
            commands_lib::library_preset_save,
            commands_lib::library_preset_delete,
            commands_lib::library_project,
            commands_lib::library_plan,
            commands_lib::library_apply,
            commands_lib::library_diff,
            commands_lib::library_backups,
            commands_lib::library_restore,
            commands_lib::library_build,
            commands_lib::library_import_analyze,
            commands_lib::library_import,
            commands_lib::library_reveal,
            commands_my::my_status,
            commands_my::my_connect,
            commands_my::my_sync,
            commands_my::my_data,
            commands_my::my_forget,
            commands_my::my_overview,
            commands_my::my_apply_deadlines,
            commands_dev::project_config_get,
            commands_dev::project_config_set,
            commands_dev::job_get,
            commands_dev::job_cancel,
            commands_dev::runs_list,
            commands_dev::run_get,
            commands_dev::testing_info,
            commands_dev::tests_run,
            commands_dev::banana_run,
            commands_dev::testrepo_start,
            commands_dev::testrepo_envs,
            commands_dev::testrepo_env_delete,
            commands_dev::testrepo_env_open,
            commands_dev::moulinette_start,
            commands_dev::claude_brief,
            commands_dev::gen_tests_start,
            commands_dev::package_preview,
            commands_dev::package_create,
            commands_dev::package_reveal,
            commands_dev::readme_draft,
            commands_dev::readme_diff,
            commands_dev::readme_write,
            commands_dev::readme_ai_start,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TekBoard");
}
