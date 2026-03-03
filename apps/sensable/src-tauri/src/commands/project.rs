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
    2
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
        "discover/specs",
        "discover/research-notes",
        "discover/interviews",
        "discover/insights",
        "discover/opportunity-areas",
        "define/problem-statements",
        "define/requirements",
        "define/constraints",
        "define/wireframes",
        "develop",
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
        schema_version: 2,
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
        schema_version: 2,
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

    Ok(project)
}

/// Open an existing .sensable project (with v1→v2 migration)
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
        // v1 project — migrate
        return migrate_v1_to_v2(&path);
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
        .join("define")
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
                let filename = path.file_name().unwrap().to_string_lossy().to_string();
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
    let contents =
        fs::read_to_string(&json_path).map_err(|e| format!("Failed to read project.json: {}", e))?;
    let mut project: Project =
        serde_json::from_str(&contents).map_err(|e| format!("Invalid project.json: {}", e))?;

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
                let id = path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string();
                let metadata_path = path.join("metadata.json");
                let has_example = path.join("example.tsx").exists() || path.join("example.vue").exists();

                if metadata_path.exists() {
                    let meta_str = fs::read_to_string(&metadata_path)
                        .map_err(|e| format!("Failed to read metadata.json: {}", e))?;
                    let meta: ComponentMetadata = serde_json::from_str(&meta_str)
                        .map_err(|e| format!("Invalid metadata.json in {}: {}", id, e))?;
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
                let id = path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string();
                let metadata_path = path.join("metadata.json");
                let has_example = path.join("example.tsx").exists() || path.join("example.vue").exists();

                if metadata_path.exists() {
                    let meta_str = fs::read_to_string(&metadata_path)
                        .map_err(|e| format!("Failed to read metadata.json: {}", e))?;
                    let meta: LayoutMetadata = serde_json::from_str(&meta_str)
                        .map_err(|e| format!("Invalid metadata.json in {}: {}", id, e))?;
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

    // Update project
    let ds = project.design_system.get_or_insert(DesignSystemStatus {
        status: "not-started".to_string(),
        theme: None,
        component_library: None,
        components: vec![],
        layouts: vec![],
    });
    ds.components = components;
    ds.layouts = layouts;

    project.updated_at = chrono::Utc::now().to_rfc3339();

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&json_path, json)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    Ok(project)
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
