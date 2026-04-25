use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct WorktreeInfo {
    pub id: String,
    pub branch: String,
    pub worktree_path: String,
}

/// Normalize a workspace name into a valid branch/directory name.
fn normalize_name(name: &str) -> String {
    name.trim()
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

/// Get the `.forge` directory inside the repo for storing worktrees.
fn forge_dir(repo_path: &str) -> PathBuf {
    PathBuf::from(repo_path).join(".forge").join("worktrees")
}

#[tauri::command]
pub async fn open_repo(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dialog = app.dialog().file();
    let folder = dialog.blocking_pick_folder();
    match folder {
        Some(path) => {
            let path_str = path
                .as_path()
                .ok_or("Invalid path")?
                .to_string_lossy()
                .to_string();

            // Verify it's a git repo
            let output = Command::new("git")
                .args(["rev-parse", "--git-dir"])
                .current_dir(&path_str)
                .output()
                .map_err(|e| format!("Failed to run git: {}", e))?;

            if !output.status.success() {
                return Err("Selected folder is not a git repository".to_string());
            }

            Ok(Some(path_str))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn create_worktree(repo_path: String, name: String) -> Result<WorktreeInfo, String> {
    let normalized = normalize_name(&name);
    if normalized.is_empty() {
        return Err("Invalid workspace name".to_string());
    }

    let id = Uuid::new_v4().to_string()[..8].to_string();
    let branch = format!("forge/{}", normalized);
    let worktree_dir = forge_dir(&repo_path).join(&normalized);

    // Create the .forge/worktrees directory if needed
    std::fs::create_dir_all(forge_dir(&repo_path))
        .map_err(|e| format!("Failed to create forge directory: {}", e))?;

    let worktree_path = worktree_dir.to_string_lossy().to_string();

    // Create a new branch and worktree
    let output = Command::new("git")
        .args([
            "worktree",
            "add",
            "-b",
            &branch,
            &worktree_path,
        ])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to create worktree: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Git worktree creation failed: {}", stderr));
    }

    Ok(WorktreeInfo {
        id,
        branch,
        worktree_path,
    })
}

#[tauri::command]
pub async fn remove_worktree(repo_path: String, name: String) -> Result<(), String> {
    let normalized = normalize_name(&name);
    let worktree_dir = forge_dir(&repo_path).join(&normalized);
    let worktree_path = worktree_dir.to_string_lossy().to_string();
    let branch = format!("forge/{}", normalized);

    // Remove the worktree
    let output = Command::new("git")
        .args(["worktree", "remove", &worktree_path, "--force"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to remove worktree: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to remove worktree: {}", stderr));
    }

    // Delete the branch
    let _ = Command::new("git")
        .args(["branch", "-D", &branch])
        .current_dir(&repo_path)
        .output();

    Ok(())
}

#[tauri::command]
pub async fn get_worktree_diff(worktree_path: String) -> Result<String, String> {
    // Get both staged and unstaged changes
    let output = Command::new("git")
        .args(["diff", "HEAD"])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| format!("Failed to get diff: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to get diff: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub async fn list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to list worktrees: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to list worktrees: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let forge_prefix = forge_dir(&repo_path);
    let mut worktrees = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;

    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            current_path = Some(path.to_string());
            current_branch = None;
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            current_branch = Some(branch.to_string());
        } else if line.is_empty() {
            if let (Some(path), Some(branch)) = (&current_path, &current_branch) {
                // Only include forge-managed worktrees
                if PathBuf::from(path).starts_with(&forge_prefix) {
                    worktrees.push(WorktreeInfo {
                        id: Uuid::new_v4().to_string()[..8].to_string(),
                        branch: branch.clone(),
                        worktree_path: path.clone(),
                    });
                }
            }
            current_path = None;
            current_branch = None;
        }
    }

    Ok(worktrees)
}
