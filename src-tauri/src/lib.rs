//! Pulse — Tauri application entry point.

mod commands;
pub mod model;
pub mod net;
mod store;

use std::sync::Mutex;
use store::Db;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install rustls' ring crypto provider as the process default.
    let _ = rustls::crypto::ring::default_provider().install_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Open the SQLite database in the app data directory.
            let dir = app
                .path()
                .app_data_dir()
                .expect("resolving app data directory");
            std::fs::create_dir_all(&dir).expect("creating app data directory");
            let db_path = dir.join("pulse.db");
            let conn = store::open(&db_path).expect("opening pulse database");
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::send_request,
            commands::probe_request,
            commands::save_request,
            commands::list_saved,
            commands::delete_saved,
            commands::list_history,
            commands::clear_history,
            commands::new_id,
            commands::list_envs,
            commands::save_env,
            commands::delete_env,
            commands::get_active_env,
            commands::set_active_env,
            commands::list_collections,
            commands::save_collection,
            commands::delete_collection,
            commands::read_text_file,
            commands::geo_lookup,
            net::realtime::ws_connect,
            net::realtime::ws_send,
            net::realtime::ws_close,
            net::realtime::sse_connect,
            net::realtime::sse_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pulse");
}
