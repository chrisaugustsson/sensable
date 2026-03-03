mod agent;
mod approval;
mod commands;
mod prototype;

use agent::process::AgentRegistry;
use approval::ApprovalServer;
use commands::{agent as agent_commands, project};
use prototype::PrototypeServerManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AgentRegistry::new())
        .manage(ApprovalServer::new())
        .manage(PrototypeServerManager::new())
        .setup(|app| {
            let handle = app.handle().clone();
            let approval_server = app.state::<ApprovalServer>();
            approval_server.set_app_handle(handle.clone());
            tauri::async_runtime::spawn(async move {
                let server = handle.state::<ApprovalServer>();
                if let Err(e) = server.start().await {
                    eprintln!("Failed to start approval server: {}", e);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            project::create_project,
            project::open_project,
            project::check_project_exists,
            project::create_feature,
            project::update_feature,
            project::delete_feature,
            project::set_view,
            project::list_artifacts,
            project::read_artifact,
            project::write_artifact,
            project::update_project,
            project::advance_onboarding,
            project::read_design_system_tokens,
            project::sync_design_system,
            project::list_wireframes,
            project::read_wireframe,
            project::choose_wireframe,
            agent_commands::start_agent,
            agent_commands::send_agent_message,
            agent_commands::stop_agent,
            agent_commands::get_agent_status,
            agent_commands::stop_all_agents,
            agent_commands::list_agent_statuses,
            agent_commands::respond_to_approval,
            prototype::setup_prototype_server,
            prototype::start_prototype_server,
            prototype::stop_prototype_server,
            prototype::get_prototype_server_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running sensable");
}
