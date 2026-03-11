use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

use serde::Deserialize;

use super::stream::parse_stream_line;
use super::types::{AgentEvent, AgentStatus, Question, ScopedAgentEvent};

/// Helper for deserializing AskUserQuestion tool input.
#[derive(Deserialize)]
struct UserQuestionPayload {
    questions: Vec<Question>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImageData {
    pub base64: String,
    pub media_type: String,
}

/// Shared handles to a running agent's mutable state.
/// Clone-able so the async stdout reader task can hold references.
#[derive(Clone)]
struct InstanceHandles {
    child: Arc<Mutex<Option<tokio::process::Child>>>,
    stdin: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
    session_id: Arc<Mutex<Option<String>>>,
    status: Arc<Mutex<AgentStatus>>,
}

/// An entry in the agent registry, representing one agent context.
struct AgentEntry {
    handles: InstanceHandles,
    #[allow(dead_code)]
    context_key: String,
    #[allow(dead_code)]
    project_path: String,
}

/// Find the sensable-mcp binary. Checks:
/// 1. Same directory as the running executable (works for dev and bundled)
/// 2. Falls back to PATH lookup via `which`
fn find_mcp_binary() -> Result<PathBuf, String> {
    // Try next to current executable first
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("sensable-mcp");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // Fall back to PATH
    let which = std::process::Command::new("which")
        .arg("sensable-mcp")
        .output();
    if let Ok(output) = which {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    Err("sensable-mcp binary not found. Ensure the workspace is built with `cargo build`.".into())
}

/// Write MCP config JSON for a specific agent context. Returns the path to the config file.
fn write_mcp_config(
    project_path: &str,
    mcp_binary: &Path,
    approval_port: u16,
    context_key: &str,
    env_overrides: &HashMap<String, String>,
) -> Result<PathBuf, String> {
    let sensable_dir = Path::new(project_path).join(".sensable");
    std::fs::create_dir_all(&sensable_dir)
        .map_err(|e| format!("Failed to create .sensable dir: {}", e))?;

    // Unique config file per agent context
    let slug = context_key.replace(':', "-");
    let config_path = sensable_dir.join(format!(".mcp-config-{}.json", slug));

    let mut env = serde_json::Map::new();
    env.insert(
        "SENSABLE_PROJECT_PATH".into(),
        serde_json::Value::String(project_path.to_string()),
    );
    env.insert(
        "SENSABLE_APPROVAL_PORT".into(),
        serde_json::Value::String(approval_port.to_string()),
    );
    for (k, v) in env_overrides {
        env.insert(k.clone(), serde_json::Value::String(v.clone()));
    }

    let config = serde_json::json!({
        "mcpServers": {
            "sensable": {
                "command": mcp_binary.to_string_lossy(),
                "env": env
            }
        }
    });

    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .map_err(|e| format!("Failed to write MCP config: {}", e))?;

    Ok(config_path)
}

/// Registry holding multiple concurrent agent instances, keyed by context.
pub struct AgentRegistry {
    instances: Arc<Mutex<HashMap<String, AgentEntry>>>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start an agent for the given context key. If already running, returns Ok.
    pub async fn start(
        &self,
        context_key: String,
        app: AppHandle,
        project_path: String,
        system_prompt: String,
        approval_port: u16,
        mcp_env_overrides: HashMap<String, String>,
    ) -> Result<(), String> {
        // Check if already running for this key
        {
            let instances = self.instances.lock().await;
            if let Some(entry) = instances.get(&context_key) {
                let child = entry.handles.child.lock().await;
                if child.is_some() {
                    return Ok(());
                }
            }
        }

        // Check that claude CLI is available
        let claude_check = std::process::Command::new("which")
            .arg("claude")
            .output();
        if claude_check.is_err() || !claude_check.unwrap().status.success() {
            return Err(
                "Claude CLI not found. Install it from https://claude.ai/download".to_string(),
            );
        }

        // Get or create instance handles (reuses session_id for crash recovery)
        let handles = {
            let instances = self.instances.lock().await;
            if let Some(entry) = instances.get(&context_key) {
                entry.handles.clone()
            } else {
                InstanceHandles {
                    child: Arc::new(Mutex::new(None)),
                    stdin: Arc::new(Mutex::new(None)),
                    session_id: Arc::new(Mutex::new(None)),
                    status: Arc::new(Mutex::new(AgentStatus::Stopped)),
                }
            }
        };

        // Update status to Starting
        {
            let mut status = handles.status.lock().await;
            *status = AgentStatus::Starting;
        }
        let _ = app.emit(
            "agent:status-change",
            ScopedAgentEvent {
                context_key: context_key.clone(),
                event: AgentEvent::StatusChange {
                    status: AgentStatus::Starting,
                },
            },
        );

        // Find MCP binary and write config
        let mcp_binary = find_mcp_binary()?;
        let mcp_config_path = write_mcp_config(
            &project_path,
            &mcp_binary,
            approval_port,
            &context_key,
            &mcp_env_overrides,
        )?;

        // Build command — long-running process with stdin input
        let mut cmd = Command::new("claude");
        cmd.arg("-p")
            .arg("--output-format")
            .arg("stream-json")
            .arg("--input-format")
            .arg("stream-json")
            .arg("--include-partial-messages")
            .arg("--verbose");

        // Point to MCP config so claude can use sensable tools
        cmd.arg("--mcp-config")
            .arg(mcp_config_path.to_string_lossy().as_ref());

        // Auto-approve read-only built-in tools + all sensable MCP tools
        // Write operations go through MCP approval server, not CLI permissions
        cmd.arg("--allowedTools")
            .arg("Read,Glob,Grep,WebSearch,WebFetch,mcp__sensable__*");

        // Add system prompt
        if !system_prompt.is_empty() {
            cmd.arg("--append-system-prompt").arg(&system_prompt);
        }

        // Resume session if we have one from a crashed process
        {
            let session = handles.session_id.lock().await;
            if let Some(ref id) = *session {
                cmd.arg("--resume").arg(id);
            }
        }

        // Set working directory to project path
        cmd.current_dir(&project_path);

        // Pipe stdin, stdout, stderr
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        // Spawn
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout".to_string())?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture stdin".to_string())?;

        // Store handles
        {
            let mut child_lock = handles.child.lock().await;
            *child_lock = Some(child);
        }
        {
            let mut stdin_lock = handles.stdin.lock().await;
            *stdin_lock = Some(stdin);
        }
        {
            let mut status = handles.status.lock().await;
            *status = AgentStatus::Running;
        }
        let _ = app.emit(
            "agent:status-change",
            ScopedAgentEvent {
                context_key: context_key.clone(),
                event: AgentEvent::StatusChange {
                    status: AgentStatus::Running,
                },
            },
        );

        // Insert/update registry entry
        {
            let mut instances = self.instances.lock().await;
            instances.insert(
                context_key.clone(),
                AgentEntry {
                    handles: handles.clone(),
                    context_key: context_key.clone(),
                    project_path,
                },
            );
        }

        // Spawn async task to read stdout and emit events
        let reader_handles = handles;
        let reader_key = context_key;
        let app_clone = app;

        tauri::async_runtime::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut full_text = String::new();
            let mut ask_tool_index: Option<u64> = None;
            let mut tool_input_buffer = String::new();

            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if let Some(event) = parse_stream_line(&line) {
                            match &event {
                                AgentEvent::MessageStart { session_id } => {
                                    let mut session =
                                        reader_handles.session_id.lock().await;
                                    *session = Some(session_id.clone());

                                    // Agent is now processing a response
                                    {
                                        let mut status =
                                            reader_handles.status.lock().await;
                                        *status = AgentStatus::Thinking;
                                    }
                                    let _ = app_clone.emit(
                                        "agent:status-change",
                                        ScopedAgentEvent {
                                            context_key: reader_key.clone(),
                                            event: AgentEvent::StatusChange {
                                                status: AgentStatus::Thinking,
                                            },
                                        },
                                    );
                                }
                                AgentEvent::ContentDelta { text } => {
                                    full_text.push_str(text);
                                }
                                AgentEvent::TextBlockStart { .. } => {
                                    // Text block start — emitted to frontend, no special handling
                                }
                                AgentEvent::ToolUse {
                                    index, tool_name, ..
                                } => {
                                    if tool_name == "AskUserQuestion" {
                                        ask_tool_index = Some(*index);
                                        tool_input_buffer.clear();
                                    }
                                }
                                AgentEvent::ToolInputDelta {
                                    index, partial_json,
                                } => {
                                    if ask_tool_index == Some(*index) {
                                        tool_input_buffer.push_str(partial_json);
                                    }
                                }
                                AgentEvent::ContentBlockStop { index } => {
                                    if ask_tool_index == Some(*index) {
                                        if let Ok(payload) =
                                            serde_json::from_str::<UserQuestionPayload>(
                                                &tool_input_buffer,
                                            )
                                        {
                                            let _ = app_clone.emit(
                                                "agent:user-question",
                                                ScopedAgentEvent {
                                                    context_key: reader_key.clone(),
                                                    event: AgentEvent::UserQuestion {
                                                        questions: payload.questions,
                                                    },
                                                },
                                            );
                                        }
                                        ask_tool_index = None;
                                        tool_input_buffer.clear();
                                    }
                                }
                                AgentEvent::MessageEnd {
                                    session_id,
                                    result_text,
                                    usage: _usage,
                                } => {
                                    // Use accumulated streaming text, or fall back to result text
                                    let final_text = if full_text.is_empty() {
                                        result_text.clone()
                                    } else {
                                        full_text.clone()
                                    };

                                    // Emit content complete
                                    let _ = app_clone.emit(
                                        "agent:content-complete",
                                        ScopedAgentEvent {
                                            context_key: reader_key.clone(),
                                            event: AgentEvent::ContentComplete {
                                                full_text: final_text,
                                            },
                                        },
                                    );
                                    full_text.clear();

                                    // Update session ID
                                    let mut session =
                                        reader_handles.session_id.lock().await;
                                    *session = Some(session_id.clone());

                                    // Turn complete — process is idle, ready for next message
                                    {
                                        let mut status =
                                            reader_handles.status.lock().await;
                                        *status = AgentStatus::Running;
                                    }
                                    let _ = app_clone.emit(
                                        "agent:status-change",
                                        ScopedAgentEvent {
                                            context_key: reader_key.clone(),
                                            event: AgentEvent::StatusChange {
                                                status: AgentStatus::Running,
                                            },
                                        },
                                    );
                                }
                                _ => {}
                            }

                            // Emit the event to the frontend
                            // Skip ToolInputDelta — too noisy for UI
                            let event_name = match &event {
                                AgentEvent::MessageStart { .. } => "agent:message-start",
                                AgentEvent::ContentDelta { .. } => "agent:content-delta",
                                AgentEvent::ContentComplete { .. } => {
                                    "agent:content-complete"
                                }
                                AgentEvent::TextBlockStart { .. } => {
                                    "agent:text-block-start"
                                }
                                AgentEvent::ToolUse { .. } => "agent:tool-use",
                                AgentEvent::ToolInputDelta { .. } => continue,
                                AgentEvent::ToolResult { .. } => "agent:tool-result",
                                AgentEvent::ContentBlockStop { .. } => continue,
                                AgentEvent::UserQuestion { .. } => continue,
                                AgentEvent::MessageEnd { .. } => "agent:message-end",
                                AgentEvent::Error { .. } => "agent:error",
                                AgentEvent::StatusChange { .. } => {
                                    "agent:status-change"
                                }
                            };

                            let _ = app_clone.emit(
                                event_name,
                                ScopedAgentEvent {
                                    context_key: reader_key.clone(),
                                    event,
                                },
                            );
                        }
                    }
                    Ok(None) => {
                        // EOF — process exited (crash or clean shutdown)
                        break;
                    }
                    Err(e) => {
                        let _ = app_clone.emit(
                            "agent:error",
                            ScopedAgentEvent {
                                context_key: reader_key.clone(),
                                event: AgentEvent::Error {
                                    message: format!(
                                        "Error reading agent output: {}",
                                        e
                                    ),
                                },
                            },
                        );
                        break;
                    }
                }
            }

            // Clean up handles
            {
                let mut stdin_lock = reader_handles.stdin.lock().await;
                *stdin_lock = None;
            }
            {
                let mut child_lock = reader_handles.child.lock().await;
                *child_lock = None;
            }
            {
                let mut status = reader_handles.status.lock().await;
                *status = AgentStatus::Stopped;
            }
            let _ = app_clone.emit(
                "agent:status-change",
                ScopedAgentEvent {
                    context_key: reader_key.clone(),
                    event: AgentEvent::StatusChange {
                        status: AgentStatus::Stopped,
                    },
                },
            );
        });

        Ok(())
    }

    /// Send a user message to a running agent process via stdin.
    /// If images are provided, constructs multi-part content blocks.
    pub async fn send_message(
        &self,
        key: &str,
        message: String,
        images: Option<Vec<ImageData>>,
    ) -> Result<(), String> {
        let handles = {
            let instances = self.instances.lock().await;
            instances
                .get(key)
                .ok_or_else(|| format!("No agent for context: {}", key))?
                .handles
                .clone()
        };

        let mut stdin_lock = handles.stdin.lock().await;
        let stdin = stdin_lock
            .as_mut()
            .ok_or_else(|| "Agent not running".to_string())?;

        let content = match images {
            Some(imgs) if !imgs.is_empty() => {
                let mut blocks = Vec::new();
                // Add text block first (if non-empty)
                if !message.is_empty() {
                    blocks.push(serde_json::json!({
                        "type": "text",
                        "text": message
                    }));
                }
                // Add image blocks
                for img in imgs {
                    blocks.push(serde_json::json!({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": img.media_type,
                            "data": img.base64
                        }
                    }));
                }
                serde_json::Value::Array(blocks)
            }
            _ => serde_json::Value::String(message),
        };

        let msg = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": content
            }
        });
        let line = format!("{}\n", serde_json::to_string(&msg).unwrap());
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write to agent stdin: {}", e))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("Failed to flush agent stdin: {}", e))?;

        Ok(())
    }

    /// Stop an agent by context key.
    pub async fn stop(&self, key: &str) -> Result<(), String> {
        let handles = {
            let instances = self.instances.lock().await;
            match instances.get(key) {
                Some(entry) => entry.handles.clone(),
                None => return Ok(()),
            }
        };
        // Drop stdin first to signal EOF to the child process
        {
            let mut stdin = handles.stdin.lock().await;
            *stdin = None;
        }
        // Then kill the process
        let mut child = handles.child.lock().await;
        if let Some(ref mut c) = *child {
            c.kill()
                .await
                .map_err(|e| format!("Failed to kill agent process: {}", e))?;
            *child = None;
        }
        Ok(())
    }

    /// Stop all running agents.
    pub async fn stop_all(&self) -> Result<(), String> {
        let keys: Vec<String> = {
            let instances = self.instances.lock().await;
            instances.keys().cloned().collect()
        };
        for key in keys {
            self.stop(&key).await?;
        }
        Ok(())
    }

    /// Get the status of a specific agent.
    pub async fn status(&self, key: &str) -> AgentStatus {
        let instances = self.instances.lock().await;
        if let Some(entry) = instances.get(key) {
            let status = entry.handles.status.lock().await;
            status.clone()
        } else {
            AgentStatus::Stopped
        }
    }

    /// List all agent contexts and their statuses.
    pub async fn list_statuses(&self) -> Vec<(String, AgentStatus)> {
        let instances = self.instances.lock().await;
        let mut result = Vec::new();
        for (key, entry) in instances.iter() {
            let status = entry.handles.status.lock().await;
            result.push((key.clone(), status.clone()));
        }
        result
    }

    /// Clear the stored session ID for a context (for "new session" functionality).
    /// Used after phase transitions to ensure the next start gets a fresh Claude session.
    pub async fn clear_session(&self, key: &str) {
        let instances = self.instances.lock().await;
        if let Some(entry) = instances.get(key) {
            let mut session = entry.handles.session_id.lock().await;
            *session = None;
        }
    }
}
