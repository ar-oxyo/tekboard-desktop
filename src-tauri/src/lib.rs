pub mod ai;
pub mod arena;
pub mod analytics;
pub mod cdiag;
pub mod checker;
pub mod claude;
pub mod commands;
pub mod commands_ai;
pub mod commands_connect;
pub mod commands_app;
pub mod commands_dev;
pub mod commands_lab;
pub mod commands_lib;
pub mod commands_my;
pub mod commands_plan;
pub mod connect;
pub mod cozy;
pub mod cparse;
pub mod datamgmt;
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
pub mod logtime;
pub mod library;
pub mod moulinette;
pub mod mydata;
pub mod myepitech;
pub mod myres;
pub mod myview;
pub mod notify;
pub mod packager;
pub mod planner;
pub mod playground;
pub mod projects;
pub mod prompts;
pub mod readme;
pub mod runner;
pub mod scanner;
pub mod schedule;
pub mod settings;
pub mod skilltree;
pub mod subjects;
pub mod templates;
pub mod testing;
pub mod teklive;
pub mod testrepo;
pub mod toolenv;
pub mod updates;
pub mod workspace;

use commands::AppState;
use std::sync::Mutex;
use tauri::Manager;

/// Opens the data, then starts the background services. An error here is shown to the user.
fn start(app: &mut tauri::App) -> std::result::Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| format!("Dossier de données introuvable : {e}"))?;
    let unwritable = |e: std::io::Error| format!("Tekboard ne peut pas écrire dans {} ({e}). Vérifie que ce dossier t'appartient et qu'il reste de la place sur le disque.", data_dir.display());
    std::fs::create_dir_all(&data_dir).map_err(unwritable)?;
    restrict(&data_dir);
    let (conn, opened) = db::open_at_start(&data_dir.join("tekboard.db")).map_err(|e| e.to_string())?;
    let mut notices = Vec::new();
    if let db::Opened::Recovered(aside) = opened {
        notices.push(format!("La base de données était illisible : elle a été mise de côté ({}) et Tekboard repart de zéro.", aside.display()));
    }
    if settings::repair(&conn).unwrap_or(false) {
        notices.push("Des réglages illisibles ont été remis par défaut ; les autres sont gardés.".to_string());
    }
    let _ = settings::adopt_existing_setup(&conn);
    *app.state::<commands_app::StartupNotices>().0.lock().unwrap_or_else(|e| e.into_inner()) = notices;
    // Runs left open by a crash or by closing the app during a task.
    let _ = db::mark_interrupted(&conn);
    notify::init(app.handle().clone());
    // Programs are looked up like the user's terminal would: see `toolenv`.
    toolenv::set_override("claude", settings::load(&conn).ok().and_then(|s| s.claude_path).as_deref());
    toolenv::warm_up();
    if let Err(e) = templates::ensure_builtins(&data_dir.join("templates")) {
        eprintln!("TekBoard: built-in templates not installed: {e}");
    }
    let cache_dir = app.path().app_cache_dir().map_err(|e| format!("Dossier de cache introuvable : {e}"))?;
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("Tekboard ne peut pas écrire dans {} ({e}).", cache_dir.display()))?;
    restrict(&cache_dir);
    ai::secrets::init(&data_dir);
    ai::provider::set_current(&ai::chat::AiSettings::load(&conn));
    let db = std::sync::Arc::new(Mutex::new(conn));
    // Settings from before 0.7 get a provider (Claude Code when it answers). `claude --version`
    // can take seconds: not on the way of the window.
    let migrate_db = db.clone();
    std::thread::spawn(move || {
        if let Err(e) = ai::provider::migrate(&migrate_db, || claude::detect().state == "ready") {
            eprintln!("TekBoard: AI provider not set: {e}");
        }
    });
    // TekBoard Connect: identity loaded, and listening only if the user turned it on.
    if let Err(e) = connect::init(data_dir.clone(), cache_dir.clone(), db.clone()) {
        eprintln!("TekBoard: Connect unavailable: {e}");
    }
    app.manage(AppState { db, data_dir, cache_dir, jobs: jobs::Jobs::default(), my: Mutex::new(myepitech::Session::default()), my_syncing: Mutex::new(false) });
    commands_my::start_background(app.handle().clone());
    commands_ai::start_background(app.handle().clone());
    // Artix's tools, reachable by the Claude Code runs TekBoard starts (see ai::ipc).
    if let Err(e) = ai::ipc::serve(app.handle().clone()) {
        eprintln!("TekBoard: tools channel not opened: {e}");
    }
    Ok(())
}

/// Tekboard's folders are readable by their owner only (they hold the MY Epitech session).
fn restrict(dir: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Pending::default())
        .manage(commands_app::StartupNotices::default())
        .setup(|app| {
            if let Err(e) = start(app) {
                // No crash and no half-started window: the reason, then quit.
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
                let handle = app.handle().clone();
                app.dialog().message(e.to_string()).title("Tekboard ne peut pas démarrer").kind(MessageDialogKind::Error).show(move |_| handle.exit(1));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands_app::startup_notices,
            commands_app::data_locations,
            commands_app::data_open,
            commands_app::data_export,
            commands_app::data_inspect,
            commands_app::data_import,
            commands_app::data_clear_cache,
            commands_app::settings_reset,
            commands_app::app_reset_all,
            commands_app::app_restart,
            commands_app::update_info,
            commands_app::update_check,
            commands_app::update_install,
            commands_app::update_save_package,
            commands_app::update_open_releases,
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
            commands::subjects_associate,
            commands::subject_suggestion_decide,
            commands::project_set_visibility,
            commands::hidden_repos,
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
            commands_lab::playground_tools,
            commands_lab::playground_list,
            commands_lab::playground_create,
            commands_lab::playground_save,
            commands_lab::playground_set_open,
            commands_lab::playground_delete,
            commands_lab::playground_run,
            commands_lab::playground_import_library,
            commands_lab::playground_export_preview,
            commands_lab::playground_export,
            commands_connect::connect_state,
            commands_connect::connect_configure,
            commands_connect::connect_pair,
            commands_connect::connect_dial,
            commands_connect::connect_answer,
            commands_connect::connect_block,
            commands_connect::connect_forget,
            commands_connect::connect_diagnose,
            commands_connect::share_check,
            commands_connect::share_offer,
            commands_connect::share_list,
            commands_connect::share_answer,
            commands_connect::share_cancel,
            commands_connect::share_forget,
            commands_connect::share_open,
            commands_connect::share_import,
            commands_connect::live_setup,
            commands_connect::live_install,
            commands_connect::live_start,
            commands_connect::live_stop,
            commands_connect::live_state,
            commands_connect::live_invite,
            commands_connect::live_invitations,
            commands_connect::live_join,
            commands_connect::live_decline,
            commands_lab::arena_tools,
            commands_lab::arena_list,
            commands_lab::arena_save,
            commands_lab::arena_delete,
            commands_lab::arena_revisions,
            commands_lab::arena_run,
            commands_lab::arena_generate,
            commands_lab::arena_report,
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
            commands_my::my_sync_auto,
            commands_my::my_data,
            commands_my::my_forget,
            commands_my::my_overview,
            commands_my::my_apply_deadlines,
            commands_my::my_agenda,
            commands_my::my_documents,
            commands_my::my_import_subjects,
            commands_my::my_academic,
            commands_my::my_logtime,
            commands_my::my_free_slots,
            commands_plan::plan_state,
            commands_plan::plan_project_calendar,
            commands_plan::plan_categories,
            commands_plan::plan_category_save,
            commands_plan::plan_category_delete,
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
            commands_ai::ai_provider_status,
            commands_ai::ai_openrouter_key,
            commands_ai::ai_openrouter_key_set,
            commands_ai::ai_openrouter_models,
            commands_ai::ai_ollama_info,
            commands_ai::ai_ollama_pull,
            commands_ai::ai_provider_test,
            commands_app::open_help_url,
            commands_app::doctor_run,
            commands_app::doctor_fix,
            commands_app::doctor_export,
            commands_my::my_skill_tree,
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
                // Stop advertising and close the connections cleanly.
                // A TekLive session ends with TekBoard: its relay stops.
                let _ = teklive::stop();
                if let Some(c) = connect::service() {
                    tauri::async_runtime::block_on(c.stop());
                }
            }
        });
}
