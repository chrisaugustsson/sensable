mod commands;

use commands::worktree;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            worktree::open_repo,
            worktree::create_worktree,
            worktree::remove_worktree,
            worktree::get_worktree_diff,
            worktree::list_worktrees,
        ])
        .run(tauri::generate_context!())
        .expect("error while running forge");
}
