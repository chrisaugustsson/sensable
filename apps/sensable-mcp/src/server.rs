use rmcp::{
    handler::server::{tool::ToolRouter, wrapper::Parameters},
    model::*,
    tool, tool_handler, tool_router,
    ErrorData as McpError, ServerHandler,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Immutable context for this MCP server instance, derived from env vars set by the Tauri host.
/// Each MCP process serves exactly one agent, so this never changes after construction.
#[derive(Clone, Debug)]
struct AgentContext {
    /// "onboarding", "feature", or "app". None means env vars were not set (backward compat).
    context_type: Option<String>,
    /// Feature UUID. Only set when context_type == "feature".
    feature_id: Option<String>,
    /// Current phase name (e.g., "discover", "project-spec", "design-system").
    phase: Option<String>,
    /// App view name (e.g., "project", "architect", "design-system"). Only when context_type == "app".
    app_view: Option<String>,
}

#[derive(Clone)]
pub struct SensableMcpServer {
    project_path: PathBuf,
    approval_port: Option<u16>,
    agent_context: AgentContext,
    tool_router: ToolRouter<Self>,
}

// --- Approval types (match Tauri approval server) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalRequest {
    request_id: String,
    tool_name: String,
    phase: String,
    artifact_type: String,
    title: String,
    preview: serde_json::Value,
    action: String,
    existing: Option<serde_json::Value>,
    feature_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalResponse {
    approved: bool,
    reason: Option<String>,
    edited_data: Option<serde_json::Value>,
}

// --- Tool parameter types ---

#[derive(Deserialize, JsonSchema)]
pub struct ListArtifactsParams {
    /// Optional feature UUID. Required for feature-level phases (discover, define, develop, deliver). Omit for app-level phases (architect, build).
    feature_id: Option<String>,
    /// The phase name: discover, define, develop, deliver, architect, or build
    phase: String,
    /// The artifact type within the phase (e.g., research-notes, interviews, insights, opportunity-areas, problem-statements, requirements, constraints)
    artifact_type: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct ReadArtifactParams {
    /// Optional feature UUID. Required for feature-level phases.
    feature_id: Option<String>,
    /// The phase name
    phase: String,
    /// The artifact type within the phase
    artifact_type: String,
    /// The artifact UUID
    id: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct SearchArtifactsParams {
    /// Search query string to match against artifact content
    query: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct CreateArtifactParams {
    /// Optional feature UUID. Required for feature-level phases (discover, define, develop, deliver). Omit for app-level phases (architect, build).
    feature_id: Option<String>,
    /// The phase name: discover, define, develop, deliver, architect, or build
    phase: String,
    /// The artifact type within the phase (e.g., research-notes, interviews, insights)
    artifact_type: String,
    /// Human-readable title shown in the approval dialog
    title: String,
    /// Complete artifact JSON data. Fields id, createdAt, updatedAt are generated automatically.
    data: serde_json::Value,
}

#[derive(Deserialize, JsonSchema)]
pub struct UpdateArtifactParams {
    /// Optional feature UUID. Required for feature-level phases.
    feature_id: Option<String>,
    /// The phase name
    phase: String,
    /// The artifact type within the phase
    artifact_type: String,
    /// The artifact UUID to update
    id: String,
    /// The complete updated artifact JSON data. The updatedAt field is refreshed automatically.
    data: serde_json::Value,
}

#[derive(Deserialize, JsonSchema)]
pub struct DeleteArtifactParams {
    /// Optional feature UUID. Required for feature-level phases.
    feature_id: Option<String>,
    /// The phase name
    phase: String,
    /// The artifact type within the phase
    artifact_type: String,
    /// The artifact UUID to delete
    id: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct TransitionPhaseParams {
    /// Optional feature UUID. When provided, transitions that feature's phase. When omitted, transitions app-level phases.
    feature_id: Option<String>,
    /// Target phase to transition to. For features: discover, define, develop, deliver. For app-level: architect, build.
    to_phase: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct CreateFeatureParams {
    /// Human-readable name for the feature
    name: String,
    /// Description of the feature
    description: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct ListProjectFilesParams {
    /// Relative directory path within the project (defaults to project root if omitted)
    path: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct ReadProjectFileParams {
    /// Relative file path within the project folder
    path: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct WriteProjectFileParams {
    /// Relative file path within the project folder
    path: String,
    /// File content to write
    content: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct ExecuteCommandParams {
    /// The program to run (e.g., "npm", "git", "cargo", "ls")
    command: String,
    /// Optional array of arguments to pass to the command
    args: Option<Vec<String>>,
    /// Optional relative working directory within the project (defaults to project root)
    working_directory: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct SaveMemoryParams {
    /// Markdown content to save as the memory file for the current context. This overwrites the previous memory.
    content: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct SubmitPlanParams {
    /// Title for the plan
    title: String,
    /// Markdown content of the plan (may include mermaid code blocks for diagrams)
    content: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct SearchDesignKnowledgeParams {
    /// Search query keywords (e.g., "glassmorphism dark mode", "saas dashboard", "animation accessibility")
    query: String,
    /// Specific domain to search in. Available: style, color, typography, ux, product, chart, landing, reasoning, icon. If omitted, searches across all key domains.
    domain: Option<String>,
    /// Search stack-specific guidelines instead of domains. Available: react, nextjs, vue, svelte, angular, flutter, react-native, swiftui, shadcn, html-tailwind, astro, nuxtjs, nuxt-ui, laravel, threejs, jetpack-compose.
    stack: Option<String>,
    /// Maximum results to return (default: 5)
    max_results: Option<usize>,
}

#[tool_router]
impl SensableMcpServer {
    pub fn new(project_path: String, approval_port: Option<u16>) -> Self {
        let agent_context = AgentContext {
            context_type: std::env::var("SENSABLE_CONTEXT_TYPE").ok(),
            feature_id: std::env::var("SENSABLE_FEATURE_ID").ok(),
            phase: std::env::var("SENSABLE_PHASE").ok(),
            app_view: std::env::var("SENSABLE_APP_VIEW").ok(),
        };

        Self {
            project_path: PathBuf::from(project_path),
            approval_port,
            agent_context,
            tool_router: Self::tool_router(),
        }
    }

    fn sensable_dir(&self) -> PathBuf {
        self.project_path.join(".sensable")
    }

    /// Resolve the base directory for artifacts, scoped by optional feature_id.
    fn artifact_dir(&self, feature_id: Option<&str>, phase: &str, artifact_type: &str) -> PathBuf {
        match feature_id {
            Some(fid) => self
                .sensable_dir()
                .join("features")
                .join(fid)
                .join(phase)
                .join(artifact_type),
            None => self.sensable_dir().join(phase).join(artifact_type),
        }
    }

    /// Send an approval request to the Tauri approval server and wait for a response.
    async fn request_approval(&self, request: ApprovalRequest) -> Result<ApprovalResponse, McpError> {
        let port = self.approval_port.ok_or_else(|| {
            McpError::internal_error(
                "Approval server not configured (SENSABLE_APPROVAL_PORT not set)".to_string(),
                None,
            )
        })?;

        let client = reqwest::Client::new();
        let resp = client
            .post(format!("http://127.0.0.1:{}/approval-request", port))
            .json(&request)
            .timeout(std::time::Duration::from_secs(310))
            .send()
            .await
            .map_err(|e| {
                McpError::internal_error(
                    format!("Failed to reach approval server: {}", e),
                    None,
                )
            })?;

        if !resp.status().is_success() {
            return Err(McpError::internal_error(
                format!("Approval server returned status {}", resp.status()),
                None,
            ));
        }

        resp.json::<ApprovalResponse>().await.map_err(|e| {
            McpError::internal_error(
                format!("Invalid approval response: {}", e),
                None,
            )
        })
    }

    // --- Read Tools ---

    #[tool(
        name = "get_project_state",
        description = "Get the current project state including name, description, features, current view, and phase statuses. Call this first to understand where the project is."
    )]
    async fn get_project_state(&self) -> Result<CallToolResult, McpError> {
        let path = self.sensable_dir().join("project.json");
        let content = fs::read_to_string(&path).map_err(|e| {
            McpError::internal_error(format!("Failed to read project.json: {}", e), None)
        })?;
        Ok(CallToolResult::success(vec![Content::text(content)]))
    }

    #[tool(
        name = "list_features",
        description = "List all features in the project with their id, name, currentPhase, and phase statuses."
    )]
    async fn list_features(&self) -> Result<CallToolResult, McpError> {
        let path = self.sensable_dir().join("project.json");
        let content = fs::read_to_string(&path).map_err(|e| {
            McpError::internal_error(format!("Failed to read project.json: {}", e), None)
        })?;
        let project: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
            McpError::internal_error(format!("Failed to parse project.json: {}", e), None)
        })?;

        let features = project
            .get("features")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));

        let json = serde_json::to_string_pretty(&features)
            .unwrap_or_else(|_| "[]".to_string());
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    #[tool(
        name = "list_artifacts",
        description = "List all artifacts of a specific type within a phase. Returns an array of artifact summaries with id and title. Use feature_id for feature-level phases (discover/define/develop/deliver), omit for app-level phases (architect/build)."
    )]
    async fn list_artifacts(
        &self,
        params: Parameters<ListArtifactsParams>,
    ) -> Result<CallToolResult, McpError> {
        let params = params.0;
        let dir = self.artifact_dir(
            params.feature_id.as_deref(),
            &params.phase,
            &params.artifact_type,
        );

        if !dir.exists() {
            return Ok(CallToolResult::success(vec![Content::text("[]")]));
        }

        let mut artifacts = Vec::new();

        let entries = fs::read_dir(&dir).map_err(|e| {
            McpError::internal_error(format!("Failed to read directory: {}", e), None)
        })?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                if let Ok(contents) = fs::read_to_string(&path) {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&contents) {
                        let summary = serde_json::json!({
                            "id": value.get("id").and_then(|v| v.as_str()).unwrap_or("unknown"),
                            "title": value.get("title").and_then(|v| v.as_str())
                                .or_else(|| value.get("statement").and_then(|v| v.as_str()))
                                .or_else(|| value.get("name").and_then(|v| v.as_str()))
                                .unwrap_or("Untitled"),
                        });
                        artifacts.push(summary);
                    }
                }
            }
        }

        let json =
            serde_json::to_string_pretty(&artifacts).unwrap_or_else(|_| "[]".to_string());
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    #[tool(
        name = "read_artifact",
        description = "Read the full content of a specific artifact by its ID. Use feature_id for feature-level phases."
    )]
    async fn read_artifact(
        &self,
        params: Parameters<ReadArtifactParams>,
    ) -> Result<CallToolResult, McpError> {
        let params = params.0;
        let path = self
            .artifact_dir(
                params.feature_id.as_deref(),
                &params.phase,
                &params.artifact_type,
            )
            .join(format!("{}.json", params.id));

        if !path.exists() {
            return Err(McpError::invalid_params(
                format!("Artifact not found: {}", params.id),
                None,
            ));
        }

        let content = fs::read_to_string(&path).map_err(|e| {
            McpError::internal_error(format!("Failed to read artifact: {}", e), None)
        })?;
        Ok(CallToolResult::success(vec![Content::text(content)]))
    }

    #[tool(
        name = "search_artifacts",
        description = "Search across all artifacts (all features + app-level phases) for a query string. Returns matching artifacts with feature_id, phase, type, id, and title."
    )]
    async fn search_artifacts(
        &self,
        params: Parameters<SearchArtifactsParams>,
    ) -> Result<CallToolResult, McpError> {
        let query = params.0.query.to_lowercase();
        let sensable = self.sensable_dir();
        let mut results = Vec::new();

        // Search app-level phases
        for phase in &["architect", "build"] {
            self.search_phase_dir(&sensable.join(phase), phase, None, &query, &mut results);
        }

        // Search feature-level phases
        let features_dir = sensable.join("features");
        if features_dir.exists() {
            if let Ok(feature_entries) = fs::read_dir(&features_dir) {
                for feature_entry in feature_entries.flatten() {
                    if !feature_entry.file_type().map_or(false, |t| t.is_dir()) {
                        continue;
                    }
                    let feature_id = feature_entry.file_name().to_string_lossy().to_string();

                    for phase in &["discover", "define", "develop", "deliver"] {
                        let phase_dir = feature_entry.path().join(phase);
                        self.search_phase_dir(
                            &phase_dir,
                            phase,
                            Some(&feature_id),
                            &query,
                            &mut results,
                        );
                    }
                }
            }
        }

        let json =
            serde_json::to_string_pretty(&results).unwrap_or_else(|_| "[]".to_string());
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    /// Helper to search artifacts within a phase directory.
    fn search_phase_dir(
        &self,
        phase_dir: &std::path::Path,
        phase: &str,
        feature_id: Option<&str>,
        query: &str,
        results: &mut Vec<serde_json::Value>,
    ) {
        if !phase_dir.exists() {
            return;
        }

        if let Ok(type_entries) = fs::read_dir(phase_dir) {
            for type_entry in type_entries.flatten() {
                if !type_entry.file_type().map_or(false, |t| t.is_dir()) {
                    continue;
                }
                let artifact_type = type_entry.file_name().to_string_lossy().to_string();

                if let Ok(file_entries) = fs::read_dir(type_entry.path()) {
                    for file_entry in file_entries.flatten() {
                        let path = file_entry.path();
                        if !path.extension().is_some_and(|ext| ext == "json") {
                            continue;
                        }

                        if let Ok(contents) = fs::read_to_string(&path) {
                            if contents.to_lowercase().contains(query) {
                                if let Ok(value) =
                                    serde_json::from_str::<serde_json::Value>(&contents)
                                {
                                    let mut result = serde_json::json!({
                                        "phase": phase,
                                        "artifact_type": artifact_type,
                                        "id": value.get("id").and_then(|v| v.as_str()).unwrap_or("unknown"),
                                        "title": value.get("title").and_then(|v| v.as_str())
                                            .or_else(|| value.get("statement").and_then(|v| v.as_str()))
                                            .or_else(|| value.get("name").and_then(|v| v.as_str()))
                                            .unwrap_or("Untitled"),
                                    });
                                    if let Some(fid) = feature_id {
                                        result["feature_id"] =
                                            serde_json::Value::String(fid.to_string());
                                    }
                                    results.push(result);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // --- Project File Tools ---

    /// Validate and resolve a relative path to an absolute path within the project folder.
    fn resolve_safe_path(&self, relative_path: &str) -> Result<PathBuf, McpError> {
        if relative_path.is_empty() {
            return Err(McpError::invalid_params("Path cannot be empty".to_string(), None));
        }

        let joined = self.project_path.join(relative_path);

        let resolved = if joined.exists() {
            joined.canonicalize().map_err(|e| {
                McpError::internal_error(format!("Failed to resolve path: {}", e), None)
            })?
        } else {
            let parent = joined.parent().ok_or_else(|| {
                McpError::invalid_params("Invalid path".to_string(), None)
            })?;
            if parent.exists() {
                let canon_parent = parent.canonicalize().map_err(|e| {
                    McpError::internal_error(format!("Failed to resolve parent: {}", e), None)
                })?;
                canon_parent.join(joined.file_name().ok_or_else(|| {
                    McpError::invalid_params("Invalid file name".to_string(), None)
                })?)
            } else {
                let mut normalized = self.project_path.clone();
                for component in std::path::Path::new(relative_path).components() {
                    match component {
                        std::path::Component::Normal(c) => normalized.push(c),
                        std::path::Component::ParentDir => {
                            return Err(McpError::invalid_params(
                                "Path cannot contain '..' components".to_string(),
                                None,
                            ));
                        }
                        std::path::Component::CurDir => {}
                        _ => {
                            return Err(McpError::invalid_params(
                                "Invalid path component".to_string(),
                                None,
                            ));
                        }
                    }
                }
                normalized
            }
        };

        let canon_project = self.project_path.canonicalize().map_err(|e| {
            McpError::internal_error(format!("Failed to resolve project path: {}", e), None)
        })?;
        if !resolved.starts_with(&canon_project) {
            return Err(McpError::invalid_params(
                "Path escapes the project folder".to_string(),
                None,
            ));
        }

        Ok(resolved)
    }

    /// Validate that a resolved write path doesn't cross into another feature's directory.
    /// When SENSABLE_FEATURE_ID is set, writes to .sensable/features/{OTHER_ID}/ are rejected.
    /// Writes to own feature dir, source files, and app-level .sensable dirs are allowed.
    fn validate_feature_scope(&self, resolved_path: &std::path::Path) -> Result<(), McpError> {
        let own_feature_id = match self.agent_context.feature_id.as_deref() {
            Some(fid) => fid,
            None => return Ok(()), // No feature scoping active
        };

        let features_dir = self.sensable_dir().join("features");

        let canon_features = match features_dir.canonicalize() {
            Ok(p) => p,
            Err(_) => return Ok(()), // features dir doesn't exist yet, nothing to guard
        };

        if !resolved_path.starts_with(&canon_features) {
            return Ok(()); // Not inside .sensable/features/, always allowed
        }

        // Inside .sensable/features/ — check it's our own feature dir
        let relative = resolved_path.strip_prefix(&canon_features).map_err(|_| {
            McpError::internal_error("Path prefix stripping failed".to_string(), None)
        })?;

        let target_feature_id = relative
            .components()
            .next()
            .and_then(|c| match c {
                std::path::Component::Normal(s) => s.to_str(),
                _ => None,
            })
            .unwrap_or("");

        if target_feature_id != own_feature_id {
            return Err(McpError::invalid_params(
                format!(
                    "Feature scope violation: this agent serves feature {} but attempted to write to feature {}'s directory",
                    own_feature_id, target_feature_id
                ),
                None,
            ));
        }

        Ok(())
    }

    /// Validate that writes stay inside `.sensable/` unless the agent is in the deliver phase.
    /// This prevents agents from accidentally modifying real project source files.
    fn validate_sensable_scope(&self, resolved_path: &std::path::Path) -> Result<(), McpError> {
        // Only enforce when we know the context (phase is set)
        let phase = match self.agent_context.phase.as_deref() {
            Some(p) => p,
            None => return Ok(()), // No phase info — don't enforce (backward compat)
        };

        // Deliver phase is allowed to write outside .sensable/
        if phase == "deliver" {
            return Ok(());
        }

        let sensable_dir = self.sensable_dir();
        let canon_sensable = match sensable_dir.canonicalize() {
            Ok(p) => p,
            Err(_) => return Ok(()), // .sensable doesn't exist yet, let init create it
        };

        if !resolved_path.starts_with(&canon_sensable) {
            return Err(McpError::invalid_params(
                format!(
                    "Workspace boundary violation: in the '{}' phase, you may only write files inside .sensable/. \
                     To modify project source files, the feature must be in the Deliver phase.",
                    phase
                ),
                None,
            ));
        }

        Ok(())
    }

    /// Validate that an artifact operation's feature_id matches this agent's context.
    /// When SENSABLE_FEATURE_ID is set, operations targeting a different feature are rejected.
    fn validate_artifact_feature_id(&self, param_feature_id: Option<&str>) -> Result<(), McpError> {
        let own_feature_id = match self.agent_context.feature_id.as_deref() {
            Some(fid) => fid,
            None => return Ok(()), // No feature scoping active
        };

        match param_feature_id {
            Some(requested_fid) if requested_fid != own_feature_id => {
                Err(McpError::invalid_params(
                    format!(
                        "Feature scope violation: this agent serves feature {} but tried to access feature {}'s artifacts",
                        own_feature_id, requested_fid
                    ),
                    None,
                ))
            }
            _ => Ok(()), // Matches own feature_id, or app-level (None)
        }
    }

    #[tool(
        name = "list_project_files",
        description = "List files and directories at a path relative to the project root. Returns name, type (file/dir), and size. Defaults to project root if path is omitted."
    )]
    async fn list_project_files(
        &self,
        params: Parameters<ListProjectFilesParams>,
    ) -> Result<CallToolResult, McpError> {
        let dir = match &params.0.path {
            Some(p) if !p.is_empty() => self.resolve_safe_path(p)?,
            _ => self.project_path.canonicalize().map_err(|e| {
                McpError::internal_error(format!("Failed to resolve project path: {}", e), None)
            })?,
        };

        if !dir.is_dir() {
            return Err(McpError::invalid_params(
                format!("Not a directory: {}", params.0.path.as_deref().unwrap_or(".")),
                None,
            ));
        }

        let entries = fs::read_dir(&dir).map_err(|e| {
            McpError::internal_error(format!("Failed to read directory: {}", e), None)
        })?;

        let mut files = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();

            if params.0.path.is_none() && name == ".sensable" {
                continue;
            }

            let file_type = entry.file_type().ok();
            let metadata = entry.metadata().ok();

            files.push(serde_json::json!({
                "name": name,
                "type": if file_type.as_ref().is_some_and(|t| t.is_dir()) { "dir" } else { "file" },
                "size": metadata.as_ref().map(|m| m.len()).unwrap_or(0),
            }));
        }

        let json = serde_json::to_string_pretty(&files).unwrap_or_else(|_| "[]".to_string());
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    #[tool(
        name = "read_project_file",
        description = "Read a file from the project folder. Path is relative to the project root. Returns file content as text. Max 1MB."
    )]
    async fn read_project_file(
        &self,
        params: Parameters<ReadProjectFileParams>,
    ) -> Result<CallToolResult, McpError> {
        let path = self.resolve_safe_path(&params.0.path)?;

        if !path.is_file() {
            return Err(McpError::invalid_params(
                format!("Not a file: {}", params.0.path),
                None,
            ));
        }

        let metadata = fs::metadata(&path).map_err(|e| {
            McpError::internal_error(format!("Failed to read file metadata: {}", e), None)
        })?;

        if metadata.len() > 1_048_576 {
            return Err(McpError::invalid_params(
                format!("File too large ({} bytes, max 1MB)", metadata.len()),
                None,
            ));
        }

        let content = fs::read_to_string(&path).map_err(|e| {
            McpError::internal_error(
                format!("Failed to read file (may be binary): {}", e),
                None,
            )
        })?;

        Ok(CallToolResult::success(vec![Content::text(content)]))
    }

    #[tool(
        name = "write_project_file",
        description = "Write a file to the project folder. Requires user approval. Path is relative to the project root. Creates parent directories if needed."
    )]
    async fn write_project_file(
        &self,
        params: Parameters<WriteProjectFileParams>,
    ) -> Result<CallToolResult, McpError> {
        let params = params.0;
        let path = self.resolve_safe_path(&params.path)?;
        self.validate_feature_scope(&path)?;
        self.validate_sensable_scope(&path)?;

        let is_update = path.exists();

        let preview_content = if params.content.len() > 5000 {
            format!("{}...\n\n(truncated, {} bytes total)", &params.content[..5000], params.content.len())
        } else {
            params.content.clone()
        };

        let existing = if is_update {
            let current = fs::read_to_string(&path).unwrap_or_default();
            let truncated = if current.len() > 5000 {
                format!("{}...\n\n(truncated, {} bytes total)", &current[..5000], current.len())
            } else {
                current
            };
            Some(serde_json::json!({ "path": params.path, "content": truncated }))
        } else {
            None
        };

        let approval = self
            .request_approval(ApprovalRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                tool_name: "write_project_file".to_string(),
                phase: String::new(),
                artifact_type: String::new(),
                title: params.path.clone(),
                preview: serde_json::json!({ "path": params.path, "content": preview_content }),
                action: if is_update { "update".to_string() } else { "create".to_string() },
                existing,
                feature_id: None,
            })
            .await?;

        if !approval.approved {
            let reason = approval
                .reason
                .unwrap_or_else(|| "User rejected the action".to_string());
            return Ok(CallToolResult::success(vec![Content::text(format!(
                "Action rejected: {}",
                reason
            ))]));
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                McpError::internal_error(format!("Failed to create directories: {}", e), None)
            })?;
        }

        fs::write(&path, &params.content).map_err(|e| {
            McpError::internal_error(format!("Failed to write file: {}", e), None)
        })?;

        let action = if is_update { "Updated" } else { "Created" };
        Ok(CallToolResult::success(vec![Content::text(format!(
            "{} file: {}",
            action, params.path
        ))]))
    }

    #[tool(
        name = "execute_command",
        description = "Execute a shell command in the project folder. Requires user approval. The user will see the command before it runs. Use for builds, tests, linting, git operations, package management, etc."
    )]
    async fn execute_command(
        &self,
        params: Parameters<ExecuteCommandParams>,
    ) -> Result<CallToolResult, McpError> {
        let params = params.0;

        let work_dir = match &params.working_directory {
            Some(dir) if !dir.is_empty() => self.resolve_safe_path(dir)?,
            _ => self.project_path.canonicalize().map_err(|e| {
                McpError::internal_error(format!("Failed to resolve project path: {}", e), None)
            })?,
        };

        if !work_dir.is_dir() {
            return Err(McpError::invalid_params(
                format!(
                    "Not a directory: {}",
                    params.working_directory.as_deref().unwrap_or(".")
                ),
                None,
            ));
        }

        let args = params.args.clone().unwrap_or_default();
        let display_command = if args.is_empty() {
            params.command.clone()
        } else {
            format!("{} {}", params.command, args.join(" "))
        };

        let preview = serde_json::json!({
            "command": params.command,
            "args": args,
            "display": display_command,
            "workingDirectory": params.working_directory.as_deref().unwrap_or("."),
        });

        let approval = self
            .request_approval(ApprovalRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                tool_name: "execute_command".to_string(),
                phase: String::new(),
                artifact_type: String::new(),
                title: display_command.clone(),
                preview,
                action: "create".to_string(),
                existing: None,
                feature_id: None,
            })
            .await?;

        if !approval.approved {
            let reason = approval
                .reason
                .unwrap_or_else(|| "User rejected the action".to_string());
            return Ok(CallToolResult::success(vec![Content::text(format!(
                "Command rejected: {}",
                reason
            ))]));
        }

        let output = std::process::Command::new(&params.command)
            .args(&args)
            .current_dir(&work_dir)
            .output()
            .map_err(|e| {
                McpError::internal_error(
                    format!("Failed to execute command '{}': {}", params.command, e),
                    None,
                )
            })?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let exit_code = output.status.code().unwrap_or(-1);

        let result = if output.status.success() {
            if stderr.is_empty() {
                format!("{}", stdout)
            } else {
                format!("{}\n\nstderr:\n{}", stdout, stderr)
            }
        } else {
            format!(
                "Command failed (exit code {}):\n\nstdout:\n{}\n\nstderr:\n{}",
                exit_code, stdout, stderr
            )
        };

        let result = if result.len() > 50000 {
            format!(
                "{}...\n\n(output truncated, {} bytes total)",
                &result[..50000],
                result.len()
            )
        } else {
            result
        };

        Ok(CallToolResult::success(vec![Content::text(result)]))
    }

    // --- Write Tools (require user approval) ---

    #[tool(
        name = "create_feature",
        description = "Create a new feature in the project. Requires user approval. Each feature has its own pipeline: discover → define → develop → deliver."
    )]
    async fn create_feature(
        &self,
        params: Parameters<CreateFeatureParams>,
    ) -> Result<CallToolResult, McpError> {
        let params = params.0;

        let approval = self
            .request_approval(ApprovalRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                tool_name: "create_feature".to_string(),
                phase: String::new(),
                artifact_type: String::new(),
                title: params.name.clone(),
                preview: serde_json::json!({
                    "name": params.name,
                    "description": params.description,
                }),
                action: "create".to_string(),
                existing: None,
                feature_id: None,
            })
            .await?;

        if !approval.approved {
            let reason = approval
                .reason
                .unwrap_or_else(|| "User rejected the action".to_string());
            return Ok(CallToolResult::success(vec![Content::text(format!(
                "Action rejected: {}",
                reason
            ))]));
        }

        // Read current project
        let project_path = self.sensable_dir().join("project.json");
        let project_str = fs::read_to_string(&project_path).map_err(|e| {
            McpError::internal_error(format!("Failed to read project.json: {}", e), None)
        })?;
        let mut project: serde_json::Value =
            serde_json::from_str(&project_str).map_err(|e| {
                McpError::internal_error(format!("Failed to parse project.json: {}", e), None)
            })?;

        let feature_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Create feature directories
        let feature_dir = self.sensable_dir().join("features").join(&feature_id);
        let dirs = [
            "discover/research-notes",
            "discover/interviews",
            "discover/insights",
            "discover/opportunity-areas",
            "discover/inspiration",
            "define/problem-statements",
            "define/requirements",
            "define/constraints",
            "develop",
            "deliver/implementation-notes",
        ];
        for dir in &dirs {
            fs::create_dir_all(feature_dir.join(dir)).map_err(|e| {
                McpError::internal_error(format!("Failed to create directory: {}", e), None)
            })?;
        }

        // Build feature JSON
        let feature = serde_json::json!({
            "id": feature_id,
            "name": params.name,
            "description": params.description,
            "createdAt": now,
            "updatedAt": now,
            "currentPhase": "discover",
            "phases": {
                "discover": { "status": "in-progress" },
                "define": { "status": "not-started" },
                "develop": { "status": "not-started" },
                "deliver": { "status": "not-started" },
            }
        });

        // Add to project features array
        if let Some(features) = project.get_mut("features").and_then(|v| v.as_array_mut()) {
            features.push(feature);
        }

        // Update timestamp
        if let Some(obj) = project.as_object_mut() {
            obj.insert(
                "updatedAt".to_string(),
                serde_json::Value::String(now),
            );
        }

        // Write back
        let json = serde_json::to_string_pretty(&project)
            .map_err(|e| McpError::internal_error(format!("Failed to serialize: {}", e), None))?;
        fs::write(&project_path, json).map_err(|e| {
            McpError::internal_error(format!("Failed to write project.json: {}", e), None)
        })?;

        Ok(CallToolResult::success(vec![Content::text(format!(
            "Created feature \"{}\" (id: {})",
            params.name, feature_id
        ))]))
    }

    #[tool(
        name = "create_artifact",
        description = "Create a new artifact. Requires user approval. Use feature_id for feature-level phases (discover/define/develop/deliver), omit for app-level phases (architect/build). Fields id, createdAt, updatedAt are generated automatically."
    )]
    async fn create_artifact(
        &self,
        params: Parameters<CreateArtifactParams>,
    ) -> Result<CallToolResult, McpError> {
        let params = params.0;
        self.validate_artifact_feature_id(params.feature_id.as_deref())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let mut artifact = params.data.clone();
        if let Some(obj) = artifact.as_object_mut() {
            obj.insert("id".to_string(), serde_json::Value::String(id.clone()));
            obj.insert(
                "createdAt".to_string(),
                serde_json::Value::String(now.clone()),
            );
            obj.insert("updatedAt".to_string(), serde_json::Value::String(now));
            if !obj.contains_key("tags") {
                obj.insert(
                    "tags".to_string(),
                    serde_json::Value::Array(Vec::new()),
                );
            }
        }

        let approval = self
            .request_approval(ApprovalRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                tool_name: "create_artifact".to_string(),
                phase: params.phase.clone(),
                artifact_type: params.artifact_type.clone(),
                title: params.title.clone(),
                preview: artifact.clone(),
                action: "create".to_string(),
                existing: None,
                feature_id: params.feature_id.clone(),
            })
            .await?;

        if !approval.approved {
            let reason = approval
                .reason
                .unwrap_or_else(|| "User rejected the action".to_string());
            return Ok(CallToolResult::success(vec![Content::text(format!(
                "Action rejected: {}",
                reason
            ))]));
        }

        let final_data = approval.edited_data.unwrap_or(artifact);

        let dir = self.artifact_dir(
            params.feature_id.as_deref(),
            &params.phase,
            &params.artifact_type,
        );
        fs::create_dir_all(&dir).map_err(|e| {
            McpError::internal_error(format!("Failed to create directory: {}", e), None)
        })?;

        let path = dir.join(format!("{}.json", id));
        let json = serde_json::to_string_pretty(&final_data)
            .map_err(|e| McpError::internal_error(format!("Failed to serialize: {}", e), None))?;
        fs::write(&path, json).map_err(|e| {
            McpError::internal_error(format!("Failed to write artifact: {}", e), None)
        })?;

        let context = match &params.feature_id {
            Some(fid) => format!("feature {} / {}/{}", fid, params.phase, params.artifact_type),
            None => format!("{}/{}", params.phase, params.artifact_type),
        };
        Ok(CallToolResult::success(vec![Content::text(format!(
            "Created artifact {} in {}",
            id, context
        ))]))
    }

    #[tool(
        name = "update_artifact",
        description = "Update an existing artifact. Requires user approval. Use feature_id for feature-level phases. The updatedAt timestamp is refreshed automatically."
    )]
    async fn update_artifact(
        &self,
        params: Parameters<UpdateArtifactParams>,
    ) -> Result<CallToolResult, McpError> {
        let params = params.0;
        self.validate_artifact_feature_id(params.feature_id.as_deref())?;
        let path = self
            .artifact_dir(
                params.feature_id.as_deref(),
                &params.phase,
                &params.artifact_type,
            )
            .join(format!("{}.json", params.id));

        if !path.exists() {
            return Err(McpError::invalid_params(
                format!("Artifact not found: {}", params.id),
                None,
            ));
        }

        let existing_str = fs::read_to_string(&path).map_err(|e| {
            McpError::internal_error(format!("Failed to read existing artifact: {}", e), None)
        })?;
        let existing: serde_json::Value = serde_json::from_str(&existing_str).map_err(|e| {
            McpError::internal_error(format!("Failed to parse existing artifact: {}", e), None)
        })?;

        let mut updated = params.data.clone();
        if let Some(obj) = updated.as_object_mut() {
            obj.insert(
                "id".to_string(),
                serde_json::Value::String(params.id.clone()),
            );
            if let Some(created) = existing.get("createdAt") {
                obj.insert("createdAt".to_string(), created.clone());
            }
            obj.insert(
                "updatedAt".to_string(),
                serde_json::Value::String(chrono::Utc::now().to_rfc3339()),
            );
        }

        let title = updated
            .get("title")
            .and_then(|v| v.as_str())
            .or_else(|| updated.get("statement").and_then(|v| v.as_str()))
            .or_else(|| updated.get("name").and_then(|v| v.as_str()))
            .unwrap_or("Untitled")
            .to_string();

        let approval = self
            .request_approval(ApprovalRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                tool_name: "update_artifact".to_string(),
                phase: params.phase.clone(),
                artifact_type: params.artifact_type.clone(),
                title,
                preview: updated.clone(),
                action: "update".to_string(),
                existing: Some(existing),
                feature_id: params.feature_id.clone(),
            })
            .await?;

        if !approval.approved {
            let reason = approval
                .reason
                .unwrap_or_else(|| "User rejected the action".to_string());
            return Ok(CallToolResult::success(vec![Content::text(format!(
                "Action rejected: {}",
                reason
            ))]));
        }

        let final_data = approval.edited_data.unwrap_or(updated);

        let json = serde_json::to_string_pretty(&final_data)
            .map_err(|e| McpError::internal_error(format!("Failed to serialize: {}", e), None))?;
        fs::write(&path, json).map_err(|e| {
            McpError::internal_error(format!("Failed to write artifact: {}", e), None)
        })?;

        Ok(CallToolResult::success(vec![Content::text(format!(
            "Updated artifact {} in {}/{}",
            params.id, params.phase, params.artifact_type
        ))]))
    }

    #[tool(
        name = "delete_artifact",
        description = "Delete an artifact permanently. Requires user approval. Use feature_id for feature-level phases."
    )]
    async fn delete_artifact(
        &self,
        params: Parameters<DeleteArtifactParams>,
    ) -> Result<CallToolResult, McpError> {
        let params = params.0;
        self.validate_artifact_feature_id(params.feature_id.as_deref())?;
        let path = self
            .artifact_dir(
                params.feature_id.as_deref(),
                &params.phase,
                &params.artifact_type,
            )
            .join(format!("{}.json", params.id));

        if !path.exists() {
            return Err(McpError::invalid_params(
                format!("Artifact not found: {}", params.id),
                None,
            ));
        }

        let existing_str = fs::read_to_string(&path).map_err(|e| {
            McpError::internal_error(format!("Failed to read artifact: {}", e), None)
        })?;
        let existing: serde_json::Value = serde_json::from_str(&existing_str).map_err(|e| {
            McpError::internal_error(format!("Failed to parse artifact: {}", e), None)
        })?;

        let title = existing
            .get("title")
            .and_then(|v| v.as_str())
            .or_else(|| existing.get("statement").and_then(|v| v.as_str()))
            .or_else(|| existing.get("name").and_then(|v| v.as_str()))
            .unwrap_or("Untitled")
            .to_string();

        let approval = self
            .request_approval(ApprovalRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                tool_name: "delete_artifact".to_string(),
                phase: params.phase.clone(),
                artifact_type: params.artifact_type.clone(),
                title,
                preview: existing.clone(),
                action: "delete".to_string(),
                existing: None,
                feature_id: params.feature_id.clone(),
            })
            .await?;

        if !approval.approved {
            let reason = approval
                .reason
                .unwrap_or_else(|| "User rejected the action".to_string());
            return Ok(CallToolResult::success(vec![Content::text(format!(
                "Action rejected: {}",
                reason
            ))]));
        }

        fs::remove_file(&path).map_err(|e| {
            McpError::internal_error(format!("Failed to delete artifact: {}", e), None)
        })?;

        Ok(CallToolResult::success(vec![Content::text(format!(
            "Deleted artifact {} from {}/{}",
            params.id, params.phase, params.artifact_type
        ))]))
    }

    #[tool(
        name = "transition_phase",
        description = "Transition to a new phase. Requires user approval. When feature_id is provided, transitions that feature's phase (discover/define/develop/deliver). When omitted, transitions app-level phases (architect/build)."
    )]
    async fn transition_phase(
        &self,
        params: Parameters<TransitionPhaseParams>,
    ) -> Result<CallToolResult, McpError> {
        let to_phase = params.0.to_phase.clone();
        let feature_id = params.0.feature_id.clone();

        // Validate feature scope: a feature agent can only transition its own feature
        if let Some(ref requested_fid) = feature_id {
            if let Some(ref own_fid) = self.agent_context.feature_id {
                if requested_fid != own_fid {
                    return Err(McpError::invalid_params(
                        format!(
                            "Feature scope violation: this agent serves feature {} but tried to transition feature {}",
                            own_fid, requested_fid
                        ),
                        None,
                    ));
                }
            }
        }

        let valid_phases = if feature_id.is_some() {
            vec!["discover", "define", "develop", "deliver"]
        } else {
            vec!["architect", "build"]
        };

        if !valid_phases.contains(&to_phase.as_str()) {
            return Err(McpError::invalid_params(
                format!(
                    "Invalid phase: {}. Must be one of: {}",
                    to_phase,
                    valid_phases.join(", ")
                ),
                None,
            ));
        }

        let project_path = self.sensable_dir().join("project.json");
        let project_str = fs::read_to_string(&project_path).map_err(|e| {
            McpError::internal_error(format!("Failed to read project.json: {}", e), None)
        })?;
        let mut project: serde_json::Value =
            serde_json::from_str(&project_str).map_err(|e| {
                McpError::internal_error(format!("Failed to parse project.json: {}", e), None)
            })?;

        let current_phase = if let Some(ref fid) = feature_id {
            // Find the feature and get its current phase
            project
                .get("features")
                .and_then(|v| v.as_array())
                .and_then(|features| features.iter().find(|f| {
                    f.get("id").and_then(|v| v.as_str()) == Some(fid)
                }))
                .and_then(|f| f.get("currentPhase").and_then(|v| v.as_str()))
                .unwrap_or("unknown")
                .to_string()
        } else {
            // App-level: derive from appPhases, fall back to onboarding status
            let app_phases = project.get("appPhases").and_then(|v| v.as_object());
            app_phases
                .and_then(|phases| {
                    phases.iter().find(|(_, v)| {
                        v.get("status").and_then(|s| s.as_str()) == Some("in-progress")
                    })
                })
                .map(|(name, _)| name.clone())
                .unwrap_or_else(|| {
                    // During onboarding, use onboarding status as current phase
                    project
                        .get("onboarding")
                        .and_then(|o| o.get("status"))
                        .and_then(|s| s.as_str())
                        .unwrap_or("unknown")
                        .to_string()
                })
        };

        if current_phase == to_phase {
            return Ok(CallToolResult::success(vec![Content::text(format!(
                "Already in {} phase",
                to_phase
            ))]));
        }

        // Enforce sequential phase order for features
        if feature_id.is_some() {
            let phase_order = ["discover", "define", "develop", "deliver"];
            let current_idx = phase_order.iter().position(|p| *p == current_phase);
            let target_idx = phase_order.iter().position(|p| *p == to_phase);
            if let (Some(ci), Some(ti)) = (current_idx, target_idx) {
                if ti != ci + 1 {
                    return Err(McpError::invalid_params(
                        format!(
                            "Cannot transition from {} to {} — phases must go in order: discover → define → develop → deliver. The next phase after {} is {}.",
                            current_phase,
                            to_phase,
                            current_phase,
                            phase_order.get(ci + 1).unwrap_or(&"(none)")
                        ),
                        None,
                    ));
                }
            }
        }

        let preview = serde_json::json!({
            "currentPhase": current_phase,
            "targetPhase": to_phase,
            "featureId": feature_id,
        });

        let approval = self
            .request_approval(ApprovalRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                tool_name: "transition_phase".to_string(),
                phase: current_phase.clone(),
                artifact_type: String::new(),
                title: format!("{} → {}", current_phase, to_phase),
                preview,
                action: "transition".to_string(),
                existing: None,
                feature_id: feature_id.clone(),
            })
            .await?;

        if !approval.approved {
            let reason = approval
                .reason
                .unwrap_or_else(|| "User rejected the action".to_string());
            return Ok(CallToolResult::success(vec![Content::text(format!(
                "Action rejected: {}",
                reason
            ))]));
        }

        if let Some(ref fid) = feature_id {
            // Transition feature phase
            if let Some(features) = project.get_mut("features").and_then(|v| v.as_array_mut()) {
                if let Some(feature) = features.iter_mut().find(|f| {
                    f.get("id").and_then(|v| v.as_str()) == Some(fid)
                }) {
                    if let Some(obj) = feature.as_object_mut() {
                        obj.insert(
                            "currentPhase".to_string(),
                            serde_json::Value::String(to_phase.clone()),
                        );
                        if let Some(phases) = obj.get_mut("phases").and_then(|v| v.as_object_mut()) {
                            if let Some(old) = phases.get_mut(&current_phase) {
                                if let Some(o) = old.as_object_mut() {
                                    o.insert("status".to_string(), serde_json::Value::String("complete".to_string()));
                                }
                            }
                            if let Some(new) = phases.get_mut(&to_phase) {
                                if let Some(n) = new.as_object_mut() {
                                    n.insert("status".to_string(), serde_json::Value::String("in-progress".to_string()));
                                }
                            }
                        }
                        obj.insert(
                            "updatedAt".to_string(),
                            serde_json::Value::String(chrono::Utc::now().to_rfc3339()),
                        );
                    }
                }
            }

            // Auto-navigate: update currentView to the new phase so the UI follows
            if let Some(obj) = project.as_object_mut() {
                let new_view = serde_json::json!({
                    "type": "feature",
                    "featureId": fid,
                    "phase": to_phase
                });
                obj.insert("currentView".to_string(), new_view);
            }
        } else {
            // Transition app-level phase
            if let Some(app_phases) = project.get_mut("appPhases").and_then(|v| v.as_object_mut()) {
                if let Some(old) = app_phases.get_mut(&current_phase) {
                    if let Some(o) = old.as_object_mut() {
                        o.insert("status".to_string(), serde_json::Value::String("complete".to_string()));
                    }
                }
                if let Some(new) = app_phases.get_mut(&to_phase) {
                    if let Some(n) = new.as_object_mut() {
                        n.insert("status".to_string(), serde_json::Value::String("in-progress".to_string()));
                    }
                }
            }
        }

        // Update timestamp
        if let Some(obj) = project.as_object_mut() {
            obj.insert(
                "updatedAt".to_string(),
                serde_json::Value::String(chrono::Utc::now().to_rfc3339()),
            );
        }

        let json = serde_json::to_string_pretty(&project)
            .map_err(|e| McpError::internal_error(format!("Failed to serialize: {}", e), None))?;
        fs::write(&project_path, json).map_err(|e| {
            McpError::internal_error(format!("Failed to write project.json: {}", e), None)
        })?;

        let context = match feature_id {
            Some(fid) => format!("feature {}", fid),
            None => "app-level".to_string(),
        };
        Ok(CallToolResult::success(vec![Content::text(format!(
            "Transitioned {} from {} to {}",
            context, current_phase, to_phase
        ))]))
    }

    // --- No-approval tools ---

    /// Resolve the memory file path from agent context env vars.
    /// Falls back to reading currentView from project.json when env vars are absent.
    fn resolve_memory_path(&self) -> Result<PathBuf, McpError> {
        let sensable = self.sensable_dir();
        let ctx = &self.agent_context;

        match ctx.context_type.as_deref() {
            Some("onboarding") => {
                let phase = ctx.phase.as_deref().unwrap_or("project-spec");
                match phase {
                    "project-spec" => Ok(sensable.join("project").join("specs").join("memory.md")),
                    "design-system" => Ok(sensable.join("design-system").join("memory.md")),
                    _ => Err(McpError::invalid_params(
                        format!("No memory context for onboarding phase: {}", phase),
                        None,
                    )),
                }
            }
            Some("feature") => {
                let feature_id = ctx.feature_id.as_deref().ok_or_else(|| {
                    McpError::internal_error(
                        "SENSABLE_CONTEXT_TYPE=feature but SENSABLE_FEATURE_ID not set".to_string(),
                        None,
                    )
                })?;
                let phase = ctx.phase.as_deref().ok_or_else(|| {
                    McpError::internal_error(
                        "SENSABLE_CONTEXT_TYPE=feature but SENSABLE_PHASE not set".to_string(),
                        None,
                    )
                })?;
                Ok(sensable.join("features").join(feature_id).join(phase).join("memory.md"))
            }
            Some("app") => {
                let view = ctx.app_view.as_deref().unwrap_or("overview");
                match view {
                    "project" => Ok(sensable.join("project").join("specs").join("memory.md")),
                    "architect" => Ok(sensable.join("architect").join("memory.md")),
                    "design-system" => Ok(sensable.join("design-system").join("memory.md")),
                    _ => Err(McpError::invalid_params(
                        format!("No memory context for app view: {}", view),
                        None,
                    )),
                }
            }
            Some(other) => Err(McpError::invalid_params(
                format!("Unknown SENSABLE_CONTEXT_TYPE: {}", other),
                None,
            )),
            None => self.resolve_memory_path_legacy(),
        }
    }

    /// Legacy fallback: resolve memory path from project.json's currentView.
    /// Used when SENSABLE_CONTEXT_TYPE env var is not set (backward compatibility).
    fn resolve_memory_path_legacy(&self) -> Result<PathBuf, McpError> {
        let project_path = self.sensable_dir().join("project.json");
        let project_str = fs::read_to_string(&project_path).map_err(|e| {
            McpError::internal_error(format!("Failed to read project.json: {}", e), None)
        })?;
        let project: serde_json::Value =
            serde_json::from_str(&project_str).map_err(|e| {
                McpError::internal_error(format!("Failed to parse project.json: {}", e), None)
            })?;

        let sensable = self.sensable_dir();

        let onboarding_status = project
            .get("onboarding")
            .and_then(|o| o.get("status"))
            .and_then(|s| s.as_str());

        match onboarding_status {
            Some("project-spec") => return Ok(sensable.join("project").join("specs").join("memory.md")),
            Some("design-system") => return Ok(sensable.join("design-system").join("memory.md")),
            _ => {}
        }

        let current_view = project.get("currentView");

        let view_type = current_view
            .and_then(|v| v.get("type"))
            .and_then(|t| t.as_str())
            .unwrap_or("app");

        match view_type {
            "feature" => {
                let feature_id = current_view
                    .and_then(|v| v.get("featureId"))
                    .and_then(|f| f.as_str())
                    .ok_or_else(|| {
                        McpError::internal_error("Feature view missing featureId".to_string(), None)
                    })?;
                let phase = current_view
                    .and_then(|v| v.get("phase"))
                    .and_then(|p| p.as_str())
                    .ok_or_else(|| {
                        McpError::internal_error("Feature view missing phase".to_string(), None)
                    })?;
                Ok(sensable.join("features").join(feature_id).join(phase).join("memory.md"))
            }
            "app" => {
                let view = current_view
                    .and_then(|v| v.get("view"))
                    .and_then(|w| w.as_str())
                    .unwrap_or("overview");

                match view {
                    "project" => Ok(sensable.join("project").join("specs").join("memory.md")),
                    "architect" => Ok(sensable.join("architect").join("memory.md")),
                    "design-system" => Ok(sensable.join("design-system").join("memory.md")),
                    _ => Err(McpError::invalid_params(
                        format!("No memory context for app view: {}", view),
                        None,
                    )),
                }
            }
            _ => Err(McpError::invalid_params(
                format!("Unknown view type: {}", view_type),
                None,
            )),
        }
    }

    #[tool(
        name = "save_memory",
        description = "Save context memory for the current session. This overwrites the memory file for the current context (feature+phase, project spec, or design system). The memory persists across sessions and is injected into the system prompt. Use this to record key decisions, progress, and context before finishing a conversation."
    )]
    async fn save_memory(
        &self,
        params: Parameters<SaveMemoryParams>,
    ) -> Result<CallToolResult, McpError> {
        let memory_path = self.resolve_memory_path()?;

        if let Some(parent) = memory_path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                McpError::internal_error(format!("Failed to create directories: {}", e), None)
            })?;
        }

        fs::write(&memory_path, &params.0.content).map_err(|e| {
            McpError::internal_error(format!("Failed to write memory file: {}", e), None)
        })?;

        let relative = memory_path
            .strip_prefix(&self.sensable_dir())
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| memory_path.display().to_string());

        Ok(CallToolResult::success(vec![Content::text(format!(
            "Memory saved to .sensable/{}",
            relative
        ))]))
    }

    #[tool(
        name = "submit_plan",
        description = "Submit a plan for user review and approval. The plan content is markdown and may include mermaid code blocks for diagrams. The user will see the rendered plan in a dialog and can approve or reject it with feedback. Use this before starting implementation to get user buy-in on your approach."
    )]
    async fn submit_plan(
        &self,
        params: Parameters<SubmitPlanParams>,
    ) -> Result<CallToolResult, McpError> {
        let params = params.0;

        let approval = self
            .request_approval(ApprovalRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                tool_name: "submit_plan".to_string(),
                phase: self.agent_context.phase.clone().unwrap_or_default(),
                artifact_type: "plan".to_string(),
                title: params.title.clone(),
                preview: serde_json::json!({
                    "content": params.content,
                }),
                action: "plan".to_string(),
                existing: None,
                feature_id: self.agent_context.feature_id.clone(),
            })
            .await?;

        if !approval.approved {
            let reason = approval
                .reason
                .unwrap_or_else(|| "User rejected the plan".to_string());
            return Ok(CallToolResult::success(vec![Content::text(format!(
                "Plan rejected: {}",
                reason
            ))]));
        }

        Ok(CallToolResult::success(vec![Content::text(
            "Plan approved. Proceed with implementation.",
        )]))
    }

    #[tool(
        name = "advance_onboarding",
        description = "Advance the onboarding to the next step. Transitions project-spec → design-system → complete. Call this when you have finished guiding the user through the current onboarding step."
    )]
    async fn advance_onboarding(&self) -> Result<CallToolResult, McpError> {
        let project_path = self.sensable_dir().join("project.json");
        let project_str = fs::read_to_string(&project_path).map_err(|e| {
            McpError::internal_error(format!("Failed to read project.json: {}", e), None)
        })?;
        let mut project: serde_json::Value =
            serde_json::from_str(&project_str).map_err(|e| {
                McpError::internal_error(format!("Failed to parse project.json: {}", e), None)
            })?;

        let current_status = project
            .get("onboarding")
            .and_then(|o| o.get("status"))
            .and_then(|s| s.as_str())
            .unwrap_or("complete")
            .to_string();

        let next_status = match current_status.as_str() {
            "project-spec" => "design-system",
            "design-system" => "complete",
            _ => {
                return Ok(CallToolResult::success(vec![Content::text(
                    "Onboarding already complete",
                )]));
            }
        };

        // Update onboarding status
        if let Some(obj) = project.as_object_mut() {
            obj.insert(
                "onboarding".to_string(),
                serde_json::json!({ "status": next_status }),
            );
            obj.insert(
                "updatedAt".to_string(),
                serde_json::Value::String(chrono::Utc::now().to_rfc3339()),
            );

            // When onboarding completes, automatically transition to architect phase
            if next_status == "complete" {
                if let Some(app_phases) =
                    obj.get_mut("appPhases").and_then(|v| v.as_object_mut())
                {
                    if let Some(architect) =
                        app_phases.get_mut("architect").and_then(|v| v.as_object_mut())
                    {
                        architect.insert(
                            "status".to_string(),
                            serde_json::Value::String("in-progress".to_string()),
                        );
                    }
                }
            }
        }

        let json = serde_json::to_string_pretty(&project)
            .map_err(|e| McpError::internal_error(format!("Failed to serialize: {}", e), None))?;
        fs::write(&project_path, json).map_err(|e| {
            McpError::internal_error(format!("Failed to write project.json: {}", e), None)
        })?;

        let guidance = if next_status == "design-system" {
            " A new session will start automatically for the design system step. Do NOT call advance_onboarding again. Say a brief closing message and stop."
        } else {
            " Onboarding is now complete."
        };

        Ok(CallToolResult::success(vec![Content::text(format!(
            "Onboarding advanced: {} → {}.{}",
            current_status, next_status, guidance
        ))]))
    }

    #[tool(
        name = "search_design_knowledge",
        description = "Search the UI/UX design knowledge base for styles, colors, typography, UX guidelines, product type recommendations, chart types, and stack-specific best practices. Use this when making design decisions, choosing color palettes, selecting fonts, reviewing UI for accessibility, or following framework best practices. Returns curated design intelligence with specific recommendations."
    )]
    async fn search_design_knowledge(
        &self,
        params: Parameters<SearchDesignKnowledgeParams>,
    ) -> Result<CallToolResult, McpError> {
        let params = params.0;

        if params.query.trim().is_empty() && params.domain.is_none() && params.stack.is_none() {
            // Return available domains and stacks
            let listing = crate::skills::ui_ux::list_domains();
            return Ok(CallToolResult::success(vec![Content::text(listing)]));
        }

        let result = crate::skills::ui_ux::search(
            &params.query,
            params.domain.as_deref(),
            params.stack.as_deref(),
            params.max_results.unwrap_or(5),
        );

        Ok(CallToolResult::success(vec![Content::text(result)]))
    }
}

#[tool_handler]
impl ServerHandler for SensableMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2024_11_05,
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "sensable-mcp".to_string(),
                version: "0.3.0".to_string(),
                title: None,
                description: None,
                icons: None,
                website_url: None,
            },
            instructions: Some(
                "Sensable project tools for reading and managing project artifacts. \
                 Projects are organized by features, each with its own pipeline (discover → define → develop → deliver). \
                 App-level phases (architect, build) are shared across all features. \
                 Read tools execute immediately. Write tools (create, update, delete, transition) \
                 require user approval. Use get_project_state to understand the current project, \
                 then list_features and list_artifacts to explore existing work."
                    .to_string(),
            ),
        }
    }
}
