pub mod ai;
pub mod analytics;
pub mod checker;
pub mod claude;
pub mod commands;
pub mod commands_ai;
pub mod commands_dev;
pub mod commands_lib;
pub mod commands_my;
pub mod commands_plan;
pub mod cozy;
pub mod cparse;
pub mod db;
pub mod deadlines;
pub mod doctor;
pub mod epitech;
pub mod focus;
pub mod error;
pub mod git;
pub mod github;
pub mod jobs;
pub mod launcher;
pub mod library;
pub mod moulinette;
pub mod mydata;
pub mod myepitech;
pub mod myres;
pub mod myview;
pub mod notify;
pub mod packager;
pub mod planner;
pub mod projects;
pub mod prompts;
pub mod readme;
pub mod runner;
pub mod scanner;
pub mod schedule;
pub mod settings;
pub mod subjects;
pub mod templates;
pub mod testing;
pub mod testrepo;
pub mod toolenv;
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
            // Runs left open by a crash or by closing the app during a task.
            let _ = db::mark_interrupted(&conn);
            notify::init(app.handle().clone());
            // Programs are looked up like the user's terminal would: see `toolenv`.
            toolenv::set_override("claude", settings::load(&conn).ok().and_then(|s| s.claude_path).as_deref());
            toolenv::warm_up();
            templates::ensure_builtins(&data_dir.join("templates"))?;
            let cache_dir = app.path().app_cache_dir()?;
            std::fs::create_dir_all(&cache_dir)?;
            app.manage(AppState { db: std::sync::Arc::new(Mutex::new(conn)), data_dir, cache_dir, jobs: jobs::Jobs::default(), my: Mutex::new(myepitech::Session::default()), my_syncing: Mutex::new(false) });
            commands_my::start_background(app.handle().clone());
            commands_ai::start_background(app.handle().clone());
            // Tika's tools, reachable by the Claude Code runs TekBoard starts (see ai::ipc).
            if let Err(e) = ai::ipc::serve(app.handle().clone()) {
                eprintln!("TekBoard: tools channel not opened: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::ui_prefs_get,
            commands::ui_prefs_set,
            commands::deadline_board,
            commands::open_remote,
            commands::project_run_info,
            commands::project_launch,
            commands_dev::quick_run,
            commands_dev::quick_history,
            commands_dev::quick_forget,
            commands_dev::job_active,
            commands_dev::claude_info,
            commands_dev::claude_check,
            commands_dev::analysis_start,
            commands_dev::prompts_list,
            commands_dev::prompt_save,
            commands_dev::prompt_delete,
            commands_dev::prompt_activate,
            commands_dev::prompt_preview,
            commands::project_set_status,
            commands::project_set_kind,
            commands::project_set_my,
            commands::project_deadline_from_my,
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
            commands_my::my_agenda,
            commands_my::my_documents,
            commands_my::my_import_subjects,
            commands_my::my_academic,
            commands_my::my_free_slots,
            commands_plan::plan_state,
            commands_plan::plan_task_save,
            commands_plan::plan_task_delete,
            commands_plan::plan_event_save,
            commands_plan::plan_event_delete,
            commands_plan::plan_project_set,
            commands_plan::plan_log_add,
            commands_plan::plan_apply,
            commands_plan::assistant_start,
            commands_ai::ai_send,
            commands_ai::ai_threads,
            commands_ai::ai_thread,
            commands_ai::ai_thread_delete,
            commands_ai::ai_context_preview,
            commands_ai::ai_settings_get,
            commands_ai::ai_settings_set,
            commands_ai::memory_list,
            commands_ai::memory_add,
            commands_ai::memory_update,
            commands_ai::memory_delete,
            commands_ai::ai_undo,
            commands_ai::ai_actions,
            commands_ai::ai_proposals,
            commands_ai::ai_proposal_decide,
            commands_ai::ai_tool,
            commands_ai::subject_analyze,
            commands_ai::subject_briefs,
            commands_ai::insights_list,
            commands_ai::insight_set,
            commands_ai::insights_refresh,
            commands_ai::focus_get,
            commands_ai::focus_start,
            commands_ai::focus_pause,
            commands_ai::focus_resume,
            commands_ai::focus_extend,
            commands_ai::focus_stop,
            commands_ai::focus_discard,
            commands_ai::focus_stats,
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
            commands_dev::gen_tests_apply,
            commands_dev::moulinette_ai_start,
            commands_dev::sandbox_check,
            commands_dev::package_preview,
            commands_dev::package_create,
            commands_dev::package_reveal,
            commands_dev::readme_draft,
            commands_dev::readme_diff,
            commands_dev::readme_write,
            commands_dev::readme_ai_start,
        ])
        .build(tauri::generate_context!())
        .expect("error while building TekBoard")
        .run(|app, event| {
            // Closing the app stops what it started: no `claude` or `make` left running orphaned.
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    state.jobs.cancel_all();
                }
            }
        });
}
