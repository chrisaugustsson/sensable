use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PhaseStatus {
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum CurrentView {
    #[serde(rename = "app")]
    App { view: String },
    #[serde(rename = "feature")]
    Feature {
        #[serde(rename = "featureId")]
        feature_id: String,
        phase: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Feature {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "currentPhase")]
    pub current_phase: String,
    pub phases: HashMap<String, PhaseStatus>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OnboardingStatus {
    pub status: String, // "project-spec" | "design-system" | "complete"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DesignSystemComponent {
    pub id: String,
    pub name: String,
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "hasExample", default)]
    pub has_example: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DesignSystemLayout {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "hasExample", default)]
    pub has_example: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DesignSystemStatus {
    pub status: String, // "not-started" | "in-progress" | "complete"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<HashMap<String, String>>,
    #[serde(rename = "componentLibrary", skip_serializing_if = "Option::is_none")]
    pub component_library: Option<String>,
    #[serde(default)]
    pub components: Vec<DesignSystemComponent>,
    #[serde(default)]
    pub layouts: Vec<DesignSystemLayout>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "schemaVersion", default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(rename = "currentView")]
    pub current_view: CurrentView,
    #[serde(default)]
    pub features: Vec<Feature>,
    #[serde(rename = "appPhases")]
    pub app_phases: HashMap<String, PhaseStatus>,
    #[serde(rename = "agentSessionId")]
    pub agent_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub framework: Option<String>,
    #[serde(rename = "designSystem", skip_serializing_if = "Option::is_none")]
    pub design_system: Option<DesignSystemStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub onboarding: Option<OnboardingStatus>,
}

fn default_schema_version() -> u32 {
    3
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecentProject {
    pub name: String,
    pub path: String,
    #[serde(rename = "lastOpened")]
    pub last_opened: String,
}

fn sensable_dir(project_path: &str) -> PathBuf {
    Path::new(project_path).join(".sensable")
}

pub fn project_json_path(project_path: &str) -> PathBuf {
    sensable_dir(project_path).join("project.json")
}

/// Ensure .sensable/.gitignore exists with entries for auto-generated and runtime files.
pub fn ensure_sensable_gitignore(sensable_dir: &Path) {
    let gitignore_path = sensable_dir.join(".gitignore");
    let required_entries = ["prototype-server/", ".mcp-config-*.json"];

    let mut contents = fs::read_to_string(&gitignore_path).unwrap_or_default();
    let mut changed = false;

    for entry in &required_entries {
        if !contents.contains(entry) {
            if !contents.is_empty() && !contents.ends_with('\n') {
                contents.push('\n');
            }
            contents.push_str(entry);
            contents.push('\n');
            changed = true;
        }
    }

    if changed {
        let _ = fs::write(&gitignore_path, contents);
    }
}

/// Resolve the base directory for artifacts, scoped by optional feature_id.
fn artifact_base_dir(project_path: &str, feature_id: Option<&str>, phase: &str) -> PathBuf {
    let sensable = sensable_dir(project_path);
    match feature_id {
        Some(fid) => sensable.join("features").join(fid).join(phase),
        None => sensable.join(phase), // app-level: architect, build
    }
}

/// Create feature directories (discover/define/develop/deliver with subdirs)
fn create_feature_dirs(sensable: &Path, feature_id: &str) -> Result<(), String> {
    let feature_dir = sensable.join("features").join(feature_id);
    let dirs = [
        "discover/research-notes",
        "discover/interviews",
        "discover/insights",
        "discover/opportunity-areas",
        "define/specs",
        "define/problem-statements",
        "define/requirements",
        "define/constraints",
        "develop/wireframes",
        "deliver/implementation-notes",
    ];
    for dir in &dirs {
        fs::create_dir_all(feature_dir.join(dir))
            .map_err(|e| format!("Failed to create directory {}: {}", dir, e))?;
    }
    Ok(())
}

/// Migrate a v1 project to v2 format.
fn migrate_v1_to_v2(project_path: &str) -> Result<Project, String> {
    let sensable = sensable_dir(project_path);
    let json_path = project_json_path(project_path);

    let contents =
        fs::read_to_string(&json_path).map_err(|e| format!("Failed to read project.json: {}", e))?;
    let v1: serde_json::Value =
        serde_json::from_str(&contents).map_err(|e| format!("Invalid project.json: {}", e))?;

    // Extract v1 fields
    let id = v1.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let name = v1.get("name").and_then(|v| v.as_str()).unwrap_or("Untitled").to_string();
    let description = v1.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let created_at = v1
        .get("createdAt")
        .or_else(|| v1.get("created_at"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let agent_session_id = v1
        .get("agentSessionId")
        .or_else(|| v1.get("agent_session_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Extract old phase statuses
    let old_phases = v1.get("phases").and_then(|v| v.as_object());

    // Build feature from the 4 design phases
    let feature_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let mut feature_phases = HashMap::new();
    let design_phase_names = ["discover", "define", "develop", "deliver"];
    let mut feature_current_phase = "discover".to_string();

    for phase_name in &design_phase_names {
        let status = old_phases
            .and_then(|p| p.get(*phase_name))
            .and_then(|v| v.get("status"))
            .and_then(|v| v.as_str())
            .unwrap_or("not-started")
            .to_string();
        if status == "in-progress" {
            feature_current_phase = phase_name.to_string();
        }
        feature_phases.insert(
            phase_name.to_string(),
            PhaseStatus { status },
        );
    }

    let feature = Feature {
        id: feature_id.clone(),
        name: name.clone(),
        description: description.clone(),
        created_at: created_at.clone(),
        updated_at: now.clone(),
        current_phase: feature_current_phase,
        phases: feature_phases,
    };

    // Extract app-level phases (architect, build)
    let mut app_phases = HashMap::new();
    for phase_name in &["architect", "build"] {
        let status = old_phases
            .and_then(|p| p.get(*phase_name))
            .and_then(|v| v.get("status"))
            .and_then(|v| v.as_str())
            .unwrap_or("not-started")
            .to_string();
        app_phases.insert(phase_name.to_string(), PhaseStatus { status });
    }

    // Move design-phase directories into features/{id}/
    let features_dir = sensable.join("features").join(&feature_id);
    fs::create_dir_all(&features_dir)
        .map_err(|e| format!("Failed to create features dir: {}", e))?;

    for phase_name in &design_phase_names {
        let src = sensable.join(phase_name);
        if src.exists() {
            let dest = features_dir.join(phase_name);
            fs::rename(&src, &dest).map_err(|e| {
                format!("Failed to move {} to features/{}: {}", phase_name, feature_id, e)
            })?;
        }
    }

    let project = Project {
        id,
        name,
        description,
        created_at,
        updated_at: now,
        schema_version: 3,
        current_view: CurrentView::App {
            view: "overview".to_string(),
        },
        features: vec![feature],
        app_phases,
        agent_session_id,
        framework: None,
        design_system: None,
        onboarding: None, // Migrated projects skip onboarding
    };

    // Write v2 project.json
    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&json_path, json)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    Ok(project)
}

/// Create the .sensable directory structure and project.json
#[tauri::command]
pub fn create_project(name: String, description: String, path: String) -> Result<Project, String> {
    let sensable = sensable_dir(&path);

    if sensable.exists() {
        return Err("A .sensable project already exists at this path".to_string());
    }

    // Create v2 directory structure (no top-level discover/define/develop/deliver)
    let dirs = [
        "features",
        "architect",
        "build",
        "design-system",
        "design-system/components",
        "design-system/layouts",
        "project/specs",
        "assets/screenshots",
        "assets/images",
    ];

    for dir in &dirs {
        fs::create_dir_all(sensable.join(dir))
            .map_err(|e| format!("Failed to create directory {}: {}", dir, e))?;
    }

    let now = chrono::Utc::now().to_rfc3339();
    let not_started = PhaseStatus {
        status: "not-started".to_string(),
    };

    let mut app_phases = HashMap::new();
    app_phases.insert("architect".to_string(), not_started.clone());
    app_phases.insert("build".to_string(), not_started);

    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        description,
        created_at: now.clone(),
        updated_at: now,
        schema_version: 3,
        current_view: CurrentView::App {
            view: "overview".to_string(),
        },
        features: vec![],
        app_phases,
        agent_session_id: None,
        framework: None,
        design_system: None,
        onboarding: Some(OnboardingStatus {
            status: "project-spec".to_string(),
        }),
    };

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;

    fs::write(project_json_path(&path), json)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    // Write .gitignore for auto-generated and runtime files
    ensure_sensable_gitignore(&sensable);

    Ok(project)
}

/// Migrate a v2 project to v3 format (Double Diamond realignment).
/// Moves specs from discover/ to define/, wireframes from define/ to develop/.
fn migrate_v2_to_v3(path: &str) -> Result<Project, String> {
    let sensable = sensable_dir(path);
    let json_path = project_json_path(path);

    let contents =
        fs::read_to_string(&json_path).map_err(|e| format!("Failed to read project.json: {}", e))?;
    let mut project: Project =
        serde_json::from_str(&contents).map_err(|e| format!("Invalid project.json: {}", e))?;

    // Migrate each feature's directory structure
    for feature in &project.features {
        let feature_dir = sensable.join("features").join(&feature.id);

        // Move discover/specs/ → define/specs/
        let old_specs = feature_dir.join("discover").join("specs");
        let new_specs = feature_dir.join("define").join("specs");
        if old_specs.exists() {
            let _ = fs::create_dir_all(&new_specs);
            if let Ok(entries) = fs::read_dir(&old_specs) {
                for entry in entries.flatten() {
                    let dest = new_specs.join(entry.file_name());
                    let _ = fs::rename(entry.path(), dest);
                }
            }
            let _ = fs::remove_dir(&old_specs); // Remove if empty
        } else {
            let _ = fs::create_dir_all(&new_specs);
        }

        // Move define/wireframes/ → develop/wireframes/
        let old_wireframes = feature_dir.join("define").join("wireframes");
        let new_wireframes = feature_dir.join("develop").join("wireframes");
        if old_wireframes.exists() {
            let _ = fs::create_dir_all(&new_wireframes);
            if let Ok(entries) = fs::read_dir(&old_wireframes) {
                for entry in entries.flatten() {
                    let dest = new_wireframes.join(entry.file_name());
                    let _ = fs::rename(entry.path(), dest);
                }
            }
            let _ = fs::remove_dir(&old_wireframes); // Remove if empty
        } else {
            let _ = fs::create_dir_all(&new_wireframes);
        }
    }

    // Bump schema version
    project.schema_version = 3;
    project.updated_at = chrono::Utc::now().to_rfc3339();

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&json_path, json)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    Ok(project)
}

/// Open an existing .sensable project (with v1→v2→v3 migration)
#[tauri::command]
pub fn open_project(path: String) -> Result<Project, String> {
    let project_path = project_json_path(&path);

    if !project_path.exists() {
        return Err("No .sensable/project.json found at this path".to_string());
    }

    // Check if this is a v1 project that needs migration
    let contents = fs::read_to_string(&project_path)
        .map_err(|e| format!("Failed to read project.json: {}", e))?;
    let raw: serde_json::Value =
        serde_json::from_str(&contents).map_err(|e| format!("Invalid project.json: {}", e))?;

    let has_schema_version = raw.get("schemaVersion").is_some();

    if !has_schema_version {
        // v1 project — migrate v1→v2→v3
        let _ = migrate_v1_to_v2(&path)?;
        return migrate_v2_to_v3(&path);
    }

    let schema_version = raw
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .unwrap_or(3) as u32;

    if schema_version <= 2 {
        return migrate_v2_to_v3(&path);
    }

    let project: Project =
        serde_json::from_str(&contents).map_err(|e| format!("Invalid project.json: {}", e))?;

    Ok(project)
}

/// Check if a path contains a .sensable project
#[tauri::command]
pub fn check_project_exists(path: String) -> bool {
    project_json_path(&path).exists()
}

/// Create a new feature within a project
#[tauri::command]
pub fn create_feature(
    project_path: String,
    name: String,
    description: String,
) -> Result<Feature, String> {
    let json_path = project_json_path(&project_path);
    let contents =
        fs::read_to_string(&json_path).map_err(|e| format!("Failed to read project.json: {}", e))?;
    let mut project: Project =
        serde_json::from_str(&contents).map_err(|e| format!("Invalid project.json: {}", e))?;

    let feature_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let not_started = PhaseStatus {
        status: "not-started".to_string(),
    };

    let mut phases = HashMap::new();
    phases.insert(
        "discover".to_string(),
        PhaseStatus {
            status: "in-progress".to_string(),
        },
    );
    phases.insert("define".to_string(), not_started.clone());
    phases.insert("develop".to_string(), not_started.clone());
    phases.insert("deliver".to_string(), not_started);

    let feature = Feature {
        id: feature_id.clone(),
        name,
        description,
        created_at: now.clone(),
        updated_at: now.clone(),
        current_phase: "discover".to_string(),
        phases,
    };

    // Create feature directories on disk
    create_feature_dirs(&sensable_dir(&project_path), &feature_id)?;

    // Add to project and save
    project.features.push(feature.clone());
    project.updated_at = now;

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&json_path, json)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    Ok(feature)
}

/// Update a feature within a project
#[tauri::command]
pub fn update_feature(project_path: String, feature: Feature) -> Result<Feature, String> {
    let json_path = project_json_path(&project_path);
    let contents =
        fs::read_to_string(&json_path).map_err(|e| format!("Failed to read project.json: {}", e))?;
    let mut project: Project =
        serde_json::from_str(&contents).map_err(|e| format!("Invalid project.json: {}", e))?;

    let idx = project
        .features
        .iter()
        .position(|f| f.id == feature.id)
        .ok_or_else(|| format!("Feature not found: {}", feature.id))?;

    project.features[idx] = feature.clone();
    project.updated_at = chrono::Utc::now().to_rfc3339();

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&json_path, json)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    Ok(feature)
}

/// Delete a feature from a project
#[tauri::command]
pub fn delete_feature(project_path: String, feature_id: String) -> Result<(), String> {
    let json_path = project_json_path(&project_path);
    let contents =
        fs::read_to_string(&json_path).map_err(|e| format!("Failed to read project.json: {}", e))?;
    let mut project: Project =
        serde_json::from_str(&contents).map_err(|e| format!("Invalid project.json: {}", e))?;

    let idx = project
        .features
        .iter()
        .position(|f| f.id == feature_id)
        .ok_or_else(|| format!("Feature not found: {}", feature_id))?;

    project.features.remove(idx);
    project.updated_at = chrono::Utc::now().to_rfc3339();

    // Remove feature directory
    let feature_dir = sensable_dir(&project_path)
        .join("features")
        .join(&feature_id);
    if feature_dir.exists() {
        fs::remove_dir_all(&feature_dir)
            .map_err(|e| format!("Failed to remove feature directory: {}", e))?;
    }

    // If the current view was on this feature, reset to overview
    if let CurrentView::Feature { feature_id: fid, .. } = &project.current_view {
        if *fid == feature_id {
            project.current_view = CurrentView::App {
                view: "overview".to_string(),
            };
        }
    }

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&json_path, json)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    Ok(())
}

/// Set the current view (replaces old setPhase)
#[tauri::command]
pub fn set_view(project_path: String, view: CurrentView) -> Result<Project, String> {
    let json_path = project_json_path(&project_path);
    let contents =
        fs::read_to_string(&json_path).map_err(|e| format!("Failed to read project.json: {}", e))?;
    let mut project: Project =
        serde_json::from_str(&contents).map_err(|e| format!("Invalid project.json: {}", e))?;

    // If navigating to a feature phase, mark it as in-progress if not-started
    if let CurrentView::Feature {
        ref feature_id,
        ref phase,
    } = view
    {
        if let Some(feature) = project.features.iter_mut().find(|f| f.id == *feature_id) {
            feature.current_phase = phase.clone();
            if let Some(ps) = feature.phases.get_mut(phase) {
                if ps.status == "not-started" {
                    ps.status = "in-progress".to_string();
                }
            }
            feature.updated_at = chrono::Utc::now().to_rfc3339();
        }
    }

    project.current_view = view;
    project.updated_at = chrono::Utc::now().to_rfc3339();

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&json_path, json)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    Ok(project)
}

/// List artifacts in a phase/type directory (feature-aware)
#[tauri::command]
pub fn list_artifacts(
    project_path: String,
    feature_id: Option<String>,
    phase: String,
    artifact_type: String,
) -> Result<Vec<serde_json::Value>, String> {
    let dir = artifact_base_dir(&project_path, feature_id.as_deref(), &phase).join(&artifact_type);

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut artifacts = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        if path.extension().map_or(false, |ext| ext == "json") {
            let contents =
                fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

            let value: serde_json::Value = serde_json::from_str(&contents)
                .map_err(|e| format!("Invalid JSON in {}: {}", path.display(), e))?;

            artifacts.push(value);
        }
    }

    Ok(artifacts)
}

/// Read a single artifact by ID (feature-aware)
#[tauri::command]
pub fn read_artifact(
    project_path: String,
    feature_id: Option<String>,
    phase: String,
    artifact_type: String,
    id: String,
) -> Result<serde_json::Value, String> {
    let file_path = artifact_base_dir(&project_path, feature_id.as_deref(), &phase)
        .join(&artifact_type)
        .join(format!("{}.json", id));

    if !file_path.exists() {
        return Err(format!("Artifact not found: {}", id));
    }

    let contents =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read artifact: {}", e))?;

    let value: serde_json::Value =
        serde_json::from_str(&contents).map_err(|e| format!("Invalid JSON: {}", e))?;

    Ok(value)
}

/// Write an artifact (create or update) (feature-aware)
#[tauri::command]
pub fn write_artifact(
    project_path: String,
    feature_id: Option<String>,
    phase: String,
    artifact_type: String,
    id: String,
    data: serde_json::Value,
) -> Result<(), String> {
    let dir = artifact_base_dir(&project_path, feature_id.as_deref(), &phase).join(&artifact_type);

    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let file_path = dir.join(format!("{}.json", id));

    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize artifact: {}", e))?;

    fs::write(&file_path, json).map_err(|e| format!("Failed to write artifact: {}", e))?;

    Ok(())
}

// -- Wireframe types and commands --

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WireframeVariant {
    pub file: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WireframeOption {
    pub id: String,
    pub title: String,
    pub status: String, // "draft" | "chosen" | "rejected"
    pub variants: Vec<WireframeVariant>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WireframeManifest {
    pub options: Vec<WireframeOption>,
    #[serde(rename = "chosenOption")]
    pub chosen_option: Option<String>,
}

// Old format types for backward compatibility migration
#[derive(Debug, Deserialize)]
struct OldWireframeEntry {
    file: String,
    title: String,
    status: String,
}

#[derive(Debug, Deserialize)]
struct OldWireframeManifest {
    wireframes: Vec<OldWireframeEntry>,
    #[serde(rename = "chosenWireframe")]
    chosen_wireframe: Option<String>,
}

fn migrate_old_manifest(old: OldWireframeManifest) -> WireframeManifest {
    let options = old
        .wireframes
        .into_iter()
        .map(|wf| {
            let id = wf.file.trim_end_matches(".html").to_string();
            WireframeOption {
                id: id.clone(),
                title: wf.title,
                status: wf.status,
                variants: vec![WireframeVariant {
                    file: wf.file,
                    label: "Default".to_string(),
                    description: String::new(),
                }],
            }
        })
        .collect();

    let chosen_option = old
        .chosen_wireframe
        .map(|f| f.trim_end_matches(".html").to_string());

    WireframeManifest {
        options,
        chosen_option,
    }
}

fn wireframes_dir(project_path: &str, feature_id: &str) -> PathBuf {
    sensable_dir(project_path)
        .join("features")
        .join(feature_id)
        .join("develop")
        .join("wireframes")
}

fn read_or_create_manifest(dir: &Path) -> Result<WireframeManifest, String> {
    let manifest_path = dir.join("manifest.json");
    if manifest_path.exists() {
        let contents = fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read manifest.json: {}", e))?;

        // Try new format first
        if let Ok(manifest) = serde_json::from_str::<WireframeManifest>(&contents) {
            return Ok(manifest);
        }

        // Try old format and migrate
        if let Ok(old) = serde_json::from_str::<OldWireframeManifest>(&contents) {
            return Ok(migrate_old_manifest(old));
        }

        Err(format!("Invalid manifest.json format"))
    } else {
        // Build manifest from HTML files on disk, grouping by option prefix
        scan_html_files_to_manifest(dir)
    }
}

/// Scan HTML files and group them into options with variants.
/// Files like `option-1.html` become option "option-1" with a single "Default" variant.
/// Files like `option-1-default.html`, `option-1-selected.html` are grouped under "option-1".
fn scan_html_files_to_manifest(dir: &Path) -> Result<WireframeManifest, String> {
    use std::collections::BTreeMap;

    let mut option_map: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();

    if dir.exists() {
        let entries = fs::read_dir(dir)
            .map_err(|e| format!("Failed to read wireframes dir: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "html") {
                let filename = match path.file_name() {
                    Some(name) => name.to_string_lossy().to_string(),
                    None => continue,
                };
                let stem = filename.trim_end_matches(".html");

                // Parse: "option-N" or "option-N-variantlabel"
                let (option_id, variant_label) = parse_wireframe_filename(stem);

                option_map
                    .entry(option_id)
                    .or_default()
                    .push((filename, variant_label));
            }
        }
    }

    let options = option_map
        .into_iter()
        .map(|(id, mut variants)| {
            variants.sort_by(|a, b| a.0.cmp(&b.0));
            let title = id.replace('-', " ");
            let title = title
                .split_whitespace()
                .map(|w| {
                    let mut c = w.chars();
                    match c.next() {
                        None => String::new(),
                        Some(f) => f.to_uppercase().to_string() + c.as_str(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            WireframeOption {
                id: id.clone(),
                title,
                status: "draft".to_string(),
                variants: variants
                    .into_iter()
                    .map(|(file, label)| WireframeVariant {
                        file,
                        label,
                        description: String::new(),
                    })
                    .collect(),
            }
        })
        .collect();

    Ok(WireframeManifest {
        options,
        chosen_option: None,
    })
}

/// Parse a wireframe filename stem into (option_id, variant_label).
/// "option-1" -> ("option-1", "Default")
/// "option-1-default" -> ("option-1", "Default")
/// "option-1-selected" -> ("option-1", "Selected")
/// "option-2-user-dialog" -> ("option-2", "User dialog")
fn parse_wireframe_filename(stem: &str) -> (String, String) {
    // Match pattern: option-{N}-{rest} or option-{N}
    if let Some(rest) = stem.strip_prefix("option-") {
        // Find the end of the number part
        let num_end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
        if num_end > 0 {
            let option_id = format!("option-{}", &rest[..num_end]);
            let variant_part = &rest[num_end..];
            let variant_label = if variant_part.is_empty() {
                "Default".to_string()
            } else {
                // Strip leading hyphen and capitalize
                let raw = variant_part.trim_start_matches('-');
                if raw.is_empty() {
                    "Default".to_string()
                } else {
                    let label = raw.replace('-', " ");
                    let mut c = label.chars();
                    match c.next() {
                        None => "Default".to_string(),
                        Some(f) => f.to_uppercase().to_string() + c.as_str(),
                    }
                }
            };
            return (option_id, variant_label);
        }
    }

    // Fallback: treat entire stem as a single option
    (stem.to_string(), "Default".to_string())
}

fn save_manifest(dir: &Path, manifest: &WireframeManifest) -> Result<(), String> {
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
    fs::write(dir.join("manifest.json"), json)
        .map_err(|e| format!("Failed to write manifest.json: {}", e))?;
    Ok(())
}

/// List wireframes for a feature (reads manifest or scans directory)
#[tauri::command]
pub fn list_wireframes(
    project_path: String,
    feature_id: String,
) -> Result<WireframeManifest, String> {
    let dir = wireframes_dir(&project_path, &feature_id);
    read_or_create_manifest(&dir)
}

/// Read wireframe HTML content
#[tauri::command]
pub fn read_wireframe(
    project_path: String,
    feature_id: String,
    filename: String,
) -> Result<String, String> {
    let file_path = wireframes_dir(&project_path, &feature_id).join(&filename);
    if !file_path.exists() {
        return Err(format!("Wireframe not found: {}", filename));
    }
    // Ensure the filename doesn't escape the wireframes directory
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Invalid filename".to_string());
    }
    fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read wireframe: {}", e))
}

/// Choose a wireframe option (updates manifest)
#[tauri::command]
pub fn choose_wireframe(
    project_path: String,
    feature_id: String,
    option_id: String,
) -> Result<WireframeManifest, String> {
    let dir = wireframes_dir(&project_path, &feature_id);
    let mut manifest = read_or_create_manifest(&dir)?;

    // Verify the option exists
    if !manifest.options.iter().any(|o| o.id == option_id) {
        return Err(format!("Wireframe option not found: {}", option_id));
    }

    // Update statuses
    for option in &mut manifest.options {
        option.status = if option.id == option_id {
            "chosen".to_string()
        } else {
            "rejected".to_string()
        };
    }
    manifest.chosen_option = Some(option_id);

    save_manifest(&dir, &manifest)?;
    Ok(manifest)
}

/// Advance the onboarding status to the next step
#[tauri::command]
pub fn advance_onboarding(project_path: String) -> Result<Project, String> {
    let json_path = project_json_path(&project_path);
    let contents =
        fs::read_to_string(&json_path).map_err(|e| format!("Failed to read project.json: {}", e))?;
    let mut project: Project =
        serde_json::from_str(&contents).map_err(|e| format!("Invalid project.json: {}", e))?;

    let current_status = project
        .onboarding
        .as_ref()
        .map(|o| o.status.as_str())
        .unwrap_or("complete");

    let next_status = match current_status {
        "project-spec" => "design-system",
        "design-system" => "complete",
        _ => return Ok(project), // Already complete, no-op
    };

    project.onboarding = Some(OnboardingStatus {
        status: next_status.to_string(),
    });
    project.updated_at = chrono::Utc::now().to_rfc3339();

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&json_path, json)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    Ok(project)
}

/// Read design system tokens.css content
#[tauri::command]
pub fn read_design_system_tokens(project_path: String) -> Result<String, String> {
    let path = sensable_dir(&project_path)
        .join("design-system")
        .join("tokens.css");
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read tokens.css: {}", e))
}

/// Metadata file for design system components/layouts
#[derive(Debug, Serialize, Deserialize)]
struct ComponentMetadata {
    name: String,
    #[serde(default = "default_category")]
    category: String,
    #[serde(default)]
    description: Option<String>,
}

fn default_category() -> String {
    "general".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
struct LayoutMetadata {
    name: String,
    #[serde(default)]
    description: Option<String>,
}

/// Scan design-system/components and design-system/layouts directories,
/// read metadata.json from each subdirectory, and update project.json.
#[tauri::command]
pub fn sync_design_system(project_path: String) -> Result<Project, String> {
    let json_path = project_json_path(&project_path);
    // Verify project.json is readable before scanning directories
    if !json_path.exists() {
        return Err("No .sensable/project.json found".to_string());
    }

    let ds_dir = sensable_dir(&project_path).join("design-system");

    // Scan components
    let components_dir = ds_dir.join("components");
    let mut components = Vec::new();
    if components_dir.exists() {
        let entries = fs::read_dir(&components_dir)
            .map_err(|e| format!("Failed to read components dir: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            if path.is_dir() {
                let id = match path.file_name() {
                    Some(name) => name.to_string_lossy().to_string(),
                    None => continue,
                };
                let metadata_path = path.join("metadata.json");
                let has_example = path.join("example.tsx").exists()
                    || path.join("Example.tsx").exists()
                    || path.join("example.vue").exists()
                    || path.join("Example.vue").exists();

                if metadata_path.exists() {
                    // Use continue on errors so partially-written files (from concurrent agent writes) don't fail the sync
                    let meta_str = match fs::read_to_string(&metadata_path) {
                        Ok(s) => s,
                        Err(_) => continue,
                    };
                    let meta: ComponentMetadata = match serde_json::from_str(&meta_str) {
                        Ok(m) => m,
                        Err(_) => continue,
                    };
                    components.push(DesignSystemComponent {
                        id,
                        name: meta.name,
                        category: meta.category,
                        description: meta.description,
                        has_example,
                    });
                } else {
                    // Infer from directory name
                    let name = id
                        .split('-')
                        .map(|s| {
                            let mut c = s.chars();
                            match c.next() {
                                None => String::new(),
                                Some(f) => f.to_uppercase().to_string() + c.as_str(),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ");
                    components.push(DesignSystemComponent {
                        id,
                        name,
                        category: "general".to_string(),
                        description: None,
                        has_example,
                    });
                }
            }
        }
    }
    components.sort_by(|a, b| a.id.cmp(&b.id));

    // Scan layouts
    let layouts_dir = ds_dir.join("layouts");
    let mut layouts = Vec::new();
    if layouts_dir.exists() {
        let entries = fs::read_dir(&layouts_dir)
            .map_err(|e| format!("Failed to read layouts dir: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            if path.is_dir() {
                let id = match path.file_name() {
                    Some(name) => name.to_string_lossy().to_string(),
                    None => continue,
                };
                let metadata_path = path.join("metadata.json");
                let has_example = path.join("example.tsx").exists()
                    || path.join("Example.tsx").exists()
                    || path.join("example.vue").exists()
                    || path.join("Example.vue").exists();

                if metadata_path.exists() {
                    let meta_str = match fs::read_to_string(&metadata_path) {
                        Ok(s) => s,
                        Err(_) => continue,
                    };
                    let meta: LayoutMetadata = match serde_json::from_str(&meta_str) {
                        Ok(m) => m,
                        Err(_) => continue,
                    };
                    layouts.push(DesignSystemLayout {
                        id,
                        name: meta.name,
                        description: meta.description,
                        has_example,
                    });
                } else {
                    let name = id
                        .split('-')
                        .map(|s| {
                            let mut c = s.chars();
                            match c.next() {
                                None => String::new(),
                                Some(f) => f.to_uppercase().to_string() + c.as_str(),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ");
                    layouts.push(DesignSystemLayout {
                        id,
                        name,
                        description: None,
                        has_example,
                    });
                }
            }
        }
    }
    layouts.sort_by(|a, b| a.id.cmp(&b.id));

    // Re-read project.json to get the latest version (another command or MCP tool may have written to it)
    let fresh_contents =
        fs::read_to_string(&json_path).map_err(|e| format!("Failed to re-read project.json: {}", e))?;
    let mut fresh_project: Project =
        serde_json::from_str(&fresh_contents).map_err(|e| format!("Invalid project.json on re-read: {}", e))?;

    // Only update the design system scan results, preserving all other fields
    let ds = fresh_project.design_system.get_or_insert(DesignSystemStatus {
        status: "not-started".to_string(),
        theme: None,
        component_library: None,
        components: vec![],
        layouts: vec![],
    });
    ds.components = components;
    ds.layouts = layouts;

    fresh_project.updated_at = chrono::Utc::now().to_rfc3339();

    let json = serde_json::to_string_pretty(&fresh_project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&json_path, json)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    // Generate preview entry files in the prototype-server
    let framework = fresh_project.framework.as_deref().unwrap_or("react");
    generate_preview_entries(&project_path, framework);

    Ok(fresh_project)
}

/// Delete a layout from the design system
#[tauri::command]
pub fn delete_layout(project_path: String, layout_id: String) -> Result<Project, String> {
    let layout_dir = sensable_dir(&project_path)
        .join("design-system")
        .join("layouts")
        .join(&layout_id);

    if layout_dir.exists() {
        fs::remove_dir_all(&layout_dir)
            .map_err(|e| format!("Failed to remove layout directory: {}", e))?;
    }

    // Re-sync to update project.json
    sync_design_system(project_path)
}

/// Delete a component from the design system
#[tauri::command]
pub fn delete_component(project_path: String, component_id: String) -> Result<Project, String> {
    let component_dir = sensable_dir(&project_path)
        .join("design-system")
        .join("components")
        .join(&component_id);

    if component_dir.exists() {
        fs::remove_dir_all(&component_dir)
            .map_err(|e| format!("Failed to remove component directory: {}", e))?;
    }

    // Re-sync to update project.json
    sync_design_system(project_path)
}

#[derive(Debug, Serialize)]
pub struct FeatureReference {
    #[serde(rename = "featureId")]
    pub feature_id: String,
    #[serde(rename = "featureName")]
    pub feature_name: String,
    pub files: Vec<String>,
}

/// Check if a design system item (layout or component) is referenced by any feature prototypes.
#[tauri::command]
pub fn check_design_system_references(
    project_path: String,
    item_type: String,
    item_id: String,
) -> Result<Vec<FeatureReference>, String> {
    let sensable = sensable_dir(&project_path);
    let features_dir = sensable.join("features");

    if !features_dir.exists() {
        return Ok(vec![]);
    }

    // Load project to get feature names
    let json_path = project_json_path(&project_path);
    let project: Project = serde_json::from_str(
        &fs::read_to_string(&json_path)
            .map_err(|e| format!("Failed to read project.json: {}", e))?,
    )
    .map_err(|e| format!("Failed to parse project.json: {}", e))?;

    let feature_map: HashMap<String, String> = project
        .features
        .iter()
        .map(|f| (f.id.clone(), f.name.clone()))
        .collect();

    let mut references = Vec::new();

    let feature_entries = fs::read_dir(&features_dir)
        .map_err(|e| format!("Failed to read features dir: {}", e))?;

    for entry in feature_entries.flatten() {
        let feature_dir = entry.path();
        if !feature_dir.is_dir() {
            continue;
        }

        let feature_id = match feature_dir.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => continue,
        };

        let mut matching_files = Vec::new();

        // Scan prototype files (develop/prototypes/)
        let proto_dir = feature_dir.join("develop").join("prototypes");
        if proto_dir.exists() {
            scan_dir_for_references(&proto_dir, &item_type, &item_id, &feature_dir, &mut matching_files);
        }

        // Scan wireframe files (develop/wireframes/)
        let wire_dir = feature_dir.join("develop").join("wireframes");
        if wire_dir.exists() {
            scan_dir_for_references(&wire_dir, &item_type, &item_id, &feature_dir, &mut matching_files);
        }

        if !matching_files.is_empty() {
            let feature_name = feature_map
                .get(&feature_id)
                .cloned()
                .unwrap_or_else(|| feature_id.clone());
            references.push(FeatureReference {
                feature_id,
                feature_name,
                files: matching_files,
            });
        }
    }

    Ok(references)
}

/// Recursively scan a directory for files that reference a design system item.
fn scan_dir_for_references(
    dir: &Path,
    item_type: &str,
    item_id: &str,
    feature_dir: &Path,
    results: &mut Vec<String>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_dir_for_references(&path, item_type, item_id, feature_dir, results);
            continue;
        }

        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "tsx" | "ts" | "jsx" | "vue" | "html") {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Check for imports/references to this item:
        // e.g. @layouts/main-layout, @components/button, layouts/main-layout, components/button
        let patterns = [
            format!("@{}/{}", item_type, item_id),
            format!("{}/{}", item_type, item_id),
        ];

        if patterns.iter().any(|p| content.contains(p)) {
            let relative = path
                .strip_prefix(feature_dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            results.push(relative);
        }
    }
}

/// Convert a kebab-case ID to a PascalCase identifier for JS imports.
/// e.g. "button-primary" -> "ButtonPrimary", "nav-item" -> "NavItem"
fn to_pascal_case(id: &str) -> String {
    id.split('-')
        .map(|s| {
            let mut c = s.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().to_string() + c.as_str(),
            }
        })
        .collect()
}

/// Info collected during per-entry generation for building the catalog page.
struct CatalogEntry {
    id: String,
    ident: String,
    name: String,
    category: String,
    description: String,
    example_file: String,
    item_type: String, // "components" or "layouts"
}

/// Generate preview entry files in the prototype-server for each component/layout
/// that has an example file. This creates index.html + main entry for Vite MPA serving.
pub fn generate_preview_entries(project_path: &str, framework: &str) {
    let sensable = sensable_dir(project_path);
    let proto_dir = sensable.join("prototype-server");
    let ds_dir = sensable.join("design-system");

    // Skip if prototype-server isn't set up
    if !proto_dir.join("package.json").exists() {
        return;
    }

    let is_vue = framework == "vue";
    let mut catalog_entries: Vec<CatalogEntry> = Vec::new();

    // Generate entries for components and layouts
    for item_type in &["components", "layouts"] {
        let src_dir = ds_dir.join(item_type);
        let dest_dir = proto_dir.join("design-system").join(item_type);

        if !src_dir.exists() {
            continue;
        }

        let entries = match fs::read_dir(&src_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let id = match path.file_name() {
                Some(name) => name.to_string_lossy().to_string(),
                None => continue,
            };

            // Find the example file
            let example_file = if is_vue {
                if path.join("Example.vue").exists() {
                    Some("Example.vue")
                } else if path.join("example.vue").exists() {
                    Some("example.vue")
                } else {
                    None
                }
            } else if path.join("example.tsx").exists() {
                Some("example.tsx")
            } else if path.join("Example.tsx").exists() {
                Some("Example.tsx")
            } else {
                None
            };

            let example_file = match example_file {
                Some(f) => f,
                None => continue,
            };

            let entry_dir = dest_dir.join(&id);
            let _ = fs::create_dir_all(&entry_dir);

            // Determine the alias prefix based on item type
            let alias = if *item_type == "components" {
                "@components"
            } else {
                "@layouts"
            };

            // Write index.html
            let (mount_id, main_ext) = if is_vue {
                ("app", "main.ts")
            } else {
                ("root", "main.tsx")
            };
            let index_html = format!(
                r#"<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{id}</title>
    <script>
      window.addEventListener("message", (e) => {{
        if (e.data?.type === "set-theme") {{
          document.documentElement.classList.toggle("dark", e.data.theme === "dark");
        }}
      }});
      new ResizeObserver(() => {{
        window.parent.postMessage({{ type: "catalog-resize", height: document.documentElement.scrollHeight }}, "*");
      }}).observe(document.documentElement);
    </script>
  </head>
  <body class="bg-background text-foreground">
    <div id="{mount_id}"></div>
    <script type="module" src="./{main_ext}"></script>
  </body>
</html>
"#
            );
            let _ = fs::write(entry_dir.join("index.html"), index_html);

            // Write main entry
            let main_content = if is_vue {
                format!(
                    r##"import {{ createApp }} from "vue";
import "@/globals.css";
import Example from "{alias}/{id}/{example_file}";

createApp(Example).mount("#app");
"##
                )
            } else {
                format!(
                    r##"import React from "react";
import ReactDOM from "react-dom/client";
import "@/globals.css";
import Example from "{alias}/{id}/{example_file}";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Example />
  </React.StrictMode>
);
"##
                )
            };
            let _ = fs::write(entry_dir.join(main_ext), main_content);

            // Collect info for catalog page
            let ident = to_pascal_case(&id);
            let (name, category, description) = {
                let metadata_path = path.join("metadata.json");
                if metadata_path.exists() {
                    if let Ok(meta_str) = fs::read_to_string(&metadata_path) {
                        if *item_type == "components" {
                            if let Ok(meta) = serde_json::from_str::<ComponentMetadata>(&meta_str) {
                                (meta.name, meta.category, meta.description.unwrap_or_default())
                            } else {
                                (id.clone(), "general".to_string(), String::new())
                            }
                        } else if let Ok(meta) = serde_json::from_str::<LayoutMetadata>(&meta_str) {
                            (meta.name, "layouts".to_string(), meta.description.unwrap_or_default())
                        } else {
                            (id.clone(), "layouts".to_string(), String::new())
                        }
                    } else {
                        (id.clone(), if *item_type == "components" { "general".to_string() } else { "layouts".to_string() }, String::new())
                    }
                } else {
                    // Infer name from id
                    let inferred = id.split('-').map(|s| {
                        let mut c = s.chars();
                        match c.next() {
                            None => String::new(),
                            Some(f) => f.to_uppercase().to_string() + c.as_str(),
                        }
                    }).collect::<Vec<_>>().join(" ");
                    (inferred, if *item_type == "components" { "general".to_string() } else { "layouts".to_string() }, String::new())
                }
            };
            catalog_entries.push(CatalogEntry {
                id: id.clone(),
                ident,
                name,
                category,
                description,
                example_file: example_file.to_string(),
                item_type: item_type.to_string(),
            });
        }
    }

    // Generate separate catalog pages for components and layouts
    let component_entries: Vec<&CatalogEntry> = catalog_entries.iter().filter(|e| e.item_type == "components").collect();
    let layout_entries: Vec<&CatalogEntry> = catalog_entries.iter().filter(|e| e.item_type == "layouts").collect();
    generate_catalog_page(&proto_dir, &component_entries, "components", is_vue);
    generate_catalog_page(&proto_dir, &layout_entries, "layouts", is_vue);
}

/// Generate a catalog page (index.html + main.tsx) for a specific item type
/// that renders all items on a single scrollable page grouped by category.
fn generate_catalog_page(proto_dir: &std::path::Path, entries: &[&CatalogEntry], catalog_name: &str, is_vue: bool) {
    if entries.is_empty() {
        return;
    }

    let catalog_dir = proto_dir.join("design-system").join(format!("{}-catalog", catalog_name));
    let _ = fs::create_dir_all(&catalog_dir);

    let (mount_id, main_ext) = if is_vue {
        ("app", "main.ts")
    } else {
        ("root", "main.tsx")
    };

    // Write index.html
    let index_html = format!(
        r#"<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Component Catalog</title>
    <script>
      window.addEventListener("message", (e) => {{
        if (e.data?.type === "set-theme") {{
          document.documentElement.classList.toggle("dark", e.data.theme === "dark");
        }}
      }});
      // Report content height to parent so iframe can auto-resize
      new ResizeObserver(() => {{
        window.parent.postMessage({{ type: "catalog-resize", height: document.documentElement.scrollHeight }}, "*");
      }}).observe(document.documentElement);
    </script>
  </head>
  <body class="bg-background text-foreground">
    <div id="{mount_id}"></div>
    <script type="module" src="./{main_ext}"></script>
  </body>
</html>
"#
    );
    let _ = fs::write(catalog_dir.join("index.html"), index_html);

    // Generate main entry file
    let main_content = if is_vue {
        generate_catalog_main_vue(entries, catalog_name)
    } else {
        generate_catalog_main_react(entries, catalog_name)
    };
    let _ = fs::write(catalog_dir.join(main_ext), main_content);
}

fn generate_catalog_main_react(entries: &[&CatalogEntry], catalog_name: &str) -> String {
    let alias = if catalog_name == "components" { "@components" } else { "@layouts" };

    // Build import statements
    let mut imports = String::new();
    for e in entries {
        imports.push_str(&format!(
            "import {ident}Example from \"{alias}/{id}/{file}\";\n",
            ident = e.ident,
            alias = alias,
            id = e.id,
            file = e.example_file,
        ));
    }

    // Build items array
    let mut items_js = String::new();
    for e in entries {
        let desc_escaped = e.description.replace('\\', "\\\\").replace('"', "\\\"");
        let name_escaped = e.name.replace('\\', "\\\\").replace('"', "\\\"");
        let cat_escaped = e.category.replace('\\', "\\\\").replace('"', "\\\"");
        items_js.push_str(&format!(
            "  {{ id: \"{id}\", name: \"{name}\", category: \"{cat}\", description: \"{desc}\", Component: {ident}Example }},\n",
            id = e.id,
            name = name_escaped,
            cat = cat_escaped,
            desc = desc_escaped,
            ident = e.ident,
        ));
    }

    format!(
        r##"import React, {{ useState, useEffect, useRef }} from "react";
import ReactDOM from "react-dom/client";
import "@/globals.css";

{imports}
const ITEMS = [
{items_js}];

function CatalogApp() {{
  const [view, setView] = useState("catalog");
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {{
    function onHashChange() {{
      const hash = window.location.hash;
      if (hash.startsWith("#detail/")) {{
        const id = hash.slice("#detail/".length);
        setView("detail");
        setSelectedId(id);
      }} else {{
        setView("catalog");
        setSelectedId(null);
      }}
    }}
    window.addEventListener("hashchange", onHashChange);
    onHashChange();

    function handleMessage(e) {{
      if (e.data?.type === "navigate-catalog") {{
        window.location.hash = "";
      }}
    }}
    window.addEventListener("message", handleMessage);

    return () => {{
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("message", handleMessage);
    }};
  }}, []);

  useEffect(() => {{
    window.parent.postMessage({{ type: "catalog-navigation", view, selectedId }}, "*");
  }}, [view, selectedId]);

  if (view === "detail" && selectedId) {{
    return <DetailView id={{selectedId}} onBack={{() => {{ window.location.hash = ""; }}}} />;
  }}
  return <CatalogView onSelect={{(id) => {{ window.location.hash = `#detail/${{id}}`; }}}} />;
}}

function CatalogView({{ onSelect }}) {{
  const categories = new Map();
  for (const item of ITEMS) {{
    const cat = item.category || "general";
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat).push(item);
  }}
  const categoryRefs = useRef(new Map());
  const catKeys = [...categories.keys()].sort();

  return (
    <div className="min-h-screen">
      {{catKeys.length > 1 && (
        <nav className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur px-6 py-2 flex gap-2 overflow-x-auto">
          {{catKeys.map((cat) => (
            <button
              key={{cat}}
              onClick={{() => categoryRefs.current.get(cat)?.scrollIntoView({{ behavior: "smooth", block: "start" }})}}
              className="shrink-0 rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors capitalize"
            >
              {{cat}} <span className="text-[10px] ml-1 opacity-60">({{categories.get(cat).length}})</span>
            </button>
          ))}}
        </nav>
      )}}

      <div className="p-6 space-y-10">
        {{catKeys.map((cat) => (
          <section key={{cat}} ref={{(el) => {{ if (el) categoryRefs.current.set(cat, el); }}}}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4 capitalize">{{cat}}</h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {{categories.get(cat).map((item) => (
                <ItemCard key={{item.id}} item={{item}} onClick={{() => onSelect(item.id)}} />
              ))}}
            </div>
          </section>
        ))}}
      </div>
    </div>
  );
}}

function ItemCard({{ item, onClick }}) {{
  return (
    <div
      className="group cursor-pointer rounded-lg border border-border overflow-hidden hover:border-foreground/30 transition-colors"
      style={{{{ contentVisibility: "auto", containIntrinsicSize: "auto 200px" }}}}
      onClick={{onClick}}
    >
      <div className="border-b border-border bg-accent/20 px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{{item.name}}</h3>
          <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">Click to focus →</span>
        </div>
        {{item.description && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{{item.description}}</p>}}
      </div>
      <div className="relative overflow-hidden">
        <div style={{{{ width: 1280, pointerEvents: "none" }}}}>
          <ErrorBoundary name={{item.name}}>
            <item.Component />
          </ErrorBoundary>
        </div>
        <div className="absolute inset-0 flex items-center justify-center bg-background/0 group-hover:bg-background/60 transition-all duration-200">
          <span className="flex items-center gap-1.5 rounded-md bg-foreground/90 px-3 py-1.5 text-xs font-medium text-background opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 shadow-lg">
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8c0-3 2.5-5.5 6-5.5S14 5 14 8s-2.5 5.5-6 5.5S2 11 2 8z" /><circle cx="8" cy="8" r="2" /></svg>
            View layout
          </span>
        </div>
      </div>
    </div>
  );
}}

function DetailView({{ id, onBack }}) {{
  const item = ITEMS.find((i) => i.id === id);
  if (!item) return <div className="p-6 text-sm text-muted-foreground">Not found.</div>;

  return (
    <div className="h-screen overflow-hidden">
      <ErrorBoundary name={{item.name}}>
        <item.Component />
      </ErrorBoundary>
    </div>
  );
}}

class ErrorBoundary extends React.Component {{
  constructor(props) {{
    super(props);
    this.state = {{ hasError: false, error: null }};
  }}
  static getDerivedStateFromError(error) {{
    return {{ hasError: true, error: error.message }};
  }}
  render() {{
    if (this.state.hasError) {{
      return <div className="text-xs text-destructive p-2 text-center">Error rendering {{this.props.name}}: {{this.state.error}}</div>;
    }}
    return this.props.children;
  }}
}}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><CatalogApp /></React.StrictMode>
);
"##,
        imports = imports,
        items_js = items_js,
    )
}

fn generate_catalog_main_vue(entries: &[&CatalogEntry], catalog_name: &str) -> String {
    let alias = if catalog_name == "components" { "@components" } else { "@layouts" };

    // Build import statements
    let mut imports = String::new();
    for e in entries {
        imports.push_str(&format!(
            "import {ident}Example from \"{alias}/{id}/{file}\";\n",
            ident = e.ident,
            alias = alias,
            id = e.id,
            file = e.example_file,
        ));
    }

    let mut items_js = String::new();
    for e in entries {
        let desc_escaped = e.description.replace('\\', "\\\\").replace('"', "\\\"");
        let name_escaped = e.name.replace('\\', "\\\\").replace('"', "\\\"");
        let cat_escaped = e.category.replace('\\', "\\\\").replace('"', "\\\"");
        items_js.push_str(&format!(
            "  {{ id: \"{id}\", name: \"{name}\", category: \"{cat}\", description: \"{desc}\", component: {ident}Example }},\n",
            id = e.id, name = name_escaped, cat = cat_escaped, desc = desc_escaped, ident = e.ident,
        ));
    }

    format!(
        r##"import {{ createApp, ref, watch, onMounted, onUnmounted, h, defineComponent }} from "vue";
import "@/globals.css";

{imports}
const ITEMS = [
{items_js}];

const CatalogApp = defineComponent({{
  setup() {{
    const view = ref("catalog");
    const selectedId = ref(null);

    function onHashChange() {{
      const hash = window.location.hash;
      if (hash.startsWith("#detail/")) {{
        selectedId.value = hash.slice("#detail/".length);
        view.value = "detail";
      }} else {{
        view.value = "catalog";
        selectedId.value = null;
      }}
    }}

    function handleMessage(e) {{
      if (e.data?.type === "navigate-catalog") {{
        window.location.hash = "";
      }}
    }}

    onMounted(() => {{
      window.addEventListener("hashchange", onHashChange);
      window.addEventListener("message", handleMessage);
      onHashChange();
    }});
    onUnmounted(() => {{
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("message", handleMessage);
    }});

    // Notify parent of navigation changes (for fit-to-height scaling)
    watch([view, selectedId], ([v, id]) => {{
      window.parent.postMessage({{ type: "catalog-navigation", view: v, selectedId: id }}, "*");
    }}, {{ immediate: true }});

    return () => {{
      if (view.value === "detail" && selectedId.value) {{
        const item = ITEMS.find((i) => i.id === selectedId.value);
        if (!item) return h("div", {{ class: "p-6 text-sm text-muted-foreground" }}, "Not found.");
        return h("div", {{ class: "h-screen overflow-hidden" }}, [h(item.component)]);
      }}

      const categories = new Map();
      for (const item of ITEMS) {{
        const cat = item.category || "general";
        if (!categories.has(cat)) categories.set(cat, []);
        categories.get(cat).push(item);
      }}
      const catKeys = [...categories.keys()].sort();

      return h("div", {{ class: "min-h-screen" }}, [
        catKeys.length > 1 ? h("nav", {{ class: "sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur px-6 py-2 flex gap-2 overflow-x-auto" }},
          catKeys.map((cat) => h("button", {{ class: "shrink-0 rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors capitalize", onClick: () => document.getElementById("cat-" + cat)?.scrollIntoView({{ behavior: "smooth" }}) }}, `${{cat}} (${{categories.get(cat).length}})`))
        ) : null,
        h("div", {{ class: "p-6 space-y-10" }},
          catKeys.map((cat) => h("section", {{ id: "cat-" + cat, key: cat }}, [
            h("h2", {{ class: "text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4 capitalize" }}, cat),
            h("div", {{ class: "grid grid-cols-1 gap-4 lg:grid-cols-2" }},
              categories.get(cat).map((item) => h("div", {{
                class: "group cursor-pointer rounded-lg border border-border overflow-hidden hover:border-foreground/30 transition-colors",
                onClick: () => {{ window.location.hash = `#detail/${{item.id}}`; }}
              }}, [
                h("div", {{ class: "border-b border-border bg-accent/20 px-4 py-3" }}, [
                  h("h3", {{ class: "text-sm font-medium" }}, item.name),
                  item.description ? h("p", {{ class: "mt-0.5 text-xs text-muted-foreground" }}, item.description) : null,
                ]),
                h("div", {{ class: "relative overflow-hidden" }}, [
                  h("div", {{ style: {{ width: "1280px", pointerEvents: "none" }} }}, [h(item.component)]),
                  h("div", {{ class: "absolute inset-0 flex items-center justify-center bg-background/0 group-hover:bg-background/60 transition-all duration-200" }}, [
                    h("span", {{ class: "flex items-center gap-1.5 rounded-md bg-foreground/90 px-3 py-1.5 text-xs font-medium text-background opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 shadow-lg" }}, [
                      h("svg", {{ class: "h-3.5 w-3.5", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round", innerHTML: '<path d="M2 8c0-3 2.5-5.5 6-5.5S14 5 14 8s-2.5 5.5-6 5.5S2 11 2 8z" /><circle cx="8" cy="8" r="2" />' }}),
                      "View layout"
                    ])
                  ])
                ]),
              ]))
            ),
          ]))
        ),
      ]);
    }};
  }},
}});

createApp(CatalogApp).mount("#app");
"##,
        imports = imports,
        items_js = items_js,
    )
}

/// Update project.json
#[tauri::command]
pub fn update_project(path: String, project: Project) -> Result<Project, String> {
    let mut updated = project;
    updated.updated_at = chrono::Utc::now().to_rfc3339();

    let json = serde_json::to_string_pretty(&updated)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;

    fs::write(project_json_path(&path), json)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    Ok(updated)
}
