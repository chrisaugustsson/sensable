import { invoke } from "@tauri-apps/api/core";

export interface CreateWorktreeResult {
  id: string;
  branch: string;
  worktree_path: string;
}

export async function openRepo(): Promise<string | null> {
  return invoke<string | null>("open_repo");
}

export async function createWorktree(
  repoPath: string,
  name: string,
): Promise<CreateWorktreeResult> {
  return invoke<CreateWorktreeResult>("create_worktree", {
    repoPath,
    name,
  });
}

export async function removeWorktree(
  repoPath: string,
  name: string,
): Promise<void> {
  return invoke<void>("remove_worktree", { repoPath, name });
}

export async function getWorktreeDiff(worktreePath: string): Promise<string> {
  return invoke<string>("get_worktree_diff", { worktreePath });
}

export async function listWorktrees(
  repoPath: string,
): Promise<CreateWorktreeResult[]> {
  return invoke<CreateWorktreeResult[]>("list_worktrees", { repoPath });
}
