import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Project, Feature, CurrentView } from "@sensable/schemas";

export async function createProject(
  name: string,
  description: string,
  path: string,
): Promise<Project> {
  return invoke("create_project", { name, description, path });
}

export async function openProject(path: string): Promise<Project> {
  return invoke("open_project", { path });
}

export async function checkProjectExists(path: string): Promise<boolean> {
  return invoke("check_project_exists", { path });
}

// Feature commands

export async function createFeature(
  projectPath: string,
  name: string,
  description: string,
): Promise<Feature> {
  return invoke("create_feature", { projectPath, name, description });
}

export async function updateFeature(
  projectPath: string,
  feature: Feature,
): Promise<Feature> {
  return invoke("update_feature", { projectPath, feature });
}

export async function deleteFeature(
  projectPath: string,
  featureId: string,
): Promise<void> {
  return invoke("delete_feature", { projectPath, featureId });
}

export async function setView(
  projectPath: string,
  view: CurrentView,
): Promise<Project> {
  return invoke("set_view", { projectPath, view });
}

// Artifact commands

export async function listArtifacts(
  projectPath: string,
  phase: string,
  artifactType: string,
  featureId?: string,
): Promise<unknown[]> {
  return invoke("list_artifacts", {
    projectPath,
    featureId: featureId ?? null,
    phase,
    artifactType,
  });
}

export async function readArtifact(
  projectPath: string,
  phase: string,
  artifactType: string,
  id: string,
  featureId?: string,
): Promise<unknown> {
  return invoke("read_artifact", {
    projectPath,
    featureId: featureId ?? null,
    phase,
    artifactType,
    id,
  });
}

export async function writeArtifact(
  projectPath: string,
  phase: string,
  artifactType: string,
  id: string,
  data: unknown,
  featureId?: string,
): Promise<void> {
  return invoke("write_artifact", {
    projectPath,
    featureId: featureId ?? null,
    phase,
    artifactType,
    id,
    data,
  });
}

export async function updateProject(
  path: string,
  project: Project,
): Promise<Project> {
  return invoke("update_project", { path, project });
}

// Design system commands

export async function readDesignSystemTokens(
  projectPath: string,
): Promise<string> {
  return invoke("read_design_system_tokens", { projectPath });
}

export async function deleteLayout(
  projectPath: string,
  layoutId: string,
): Promise<Project> {
  return invoke("delete_layout", { projectPath, layoutId });
}

export async function deleteComponent(
  projectPath: string,
  componentId: string,
): Promise<Project> {
  return invoke("delete_component", { projectPath, componentId });
}

export interface FeatureReference {
  featureId: string;
  featureName: string;
  files: string[];
}

export async function checkDesignSystemReferences(
  projectPath: string,
  itemType: string,
  itemId: string,
): Promise<FeatureReference[]> {
  return invoke("check_design_system_references", {
    projectPath,
    itemType,
    itemId,
  });
}

export async function syncDesignSystem(
  projectPath: string,
): Promise<Project> {
  return invoke("sync_design_system", { projectPath });
}

// Wireframe commands

export interface WireframeVariant {
  file: string;
  label: string;
  description: string;
}

export interface WireframeOption {
  id: string;
  title: string;
  status: "draft" | "chosen" | "rejected";
  variants: WireframeVariant[];
}

export interface WireframeManifest {
  options: WireframeOption[];
  chosenOption: string | null;
}

export async function listWireframes(
  projectPath: string,
  featureId: string,
): Promise<WireframeManifest> {
  return invoke("list_wireframes", { projectPath, featureId });
}

export async function readWireframe(
  projectPath: string,
  featureId: string,
  filename: string,
): Promise<string> {
  return invoke("read_wireframe", { projectPath, featureId, filename });
}

export async function chooseWireframe(
  projectPath: string,
  featureId: string,
  optionId: string,
): Promise<WireframeManifest> {
  return invoke("choose_wireframe", { projectPath, featureId, optionId });
}

// Prototype server commands

export interface PrototypeServerStatus {
  running: boolean;
  port: number;
  setup: boolean;
}

export async function setupPrototypeServer(
  projectPath: string,
  framework: string,
): Promise<void> {
  return invoke("setup_prototype_server", { projectPath, framework });
}

export async function startPrototypeServer(
  projectPath: string,
): Promise<PrototypeServerStatus> {
  return invoke("start_prototype_server", { projectPath });
}

export async function stopPrototypeServer(): Promise<void> {
  return invoke("stop_prototype_server");
}

export async function reinstallPrototypeServer(
  projectPath: string,
  framework: string,
): Promise<void> {
  return invoke("reinstall_prototype_server", { projectPath, framework });
}

export async function getPrototypeServerStatus(
  projectPath: string,
): Promise<PrototypeServerStatus> {
  return invoke("get_prototype_server_status", { projectPath });
}

// Onboarding commands

export async function advanceOnboarding(
  projectPath: string,
): Promise<Project> {
  return invoke("advance_onboarding", { projectPath });
}

// Agent commands

export interface ImageData {
  base64: string;
  media_type: string;
}

export async function startAgent(
  projectPath: string,
  contextKey: string,
  message: string,
  images?: ImageData[],
): Promise<void> {
  return invoke("start_agent", { projectPath, contextKey, message, images: images ?? null });
}

export async function sendAgentMessage(
  contextKey: string,
  message: string,
  images?: ImageData[],
): Promise<void> {
  return invoke("send_agent_message", { contextKey, message, images: images ?? null });
}

export async function stopAgent(contextKey: string): Promise<void> {
  return invoke("stop_agent", { contextKey });
}

/** Stop an agent and clear its session ID so the next start gets a fresh session. */
export async function resetAgentSession(contextKey: string): Promise<void> {
  return invoke("reset_agent_session", { contextKey });
}

export async function getAgentStatus(contextKey: string): Promise<string> {
  return invoke("get_agent_status", { contextKey });
}

export async function stopAllAgents(): Promise<void> {
  return invoke("stop_all_agents");
}

export async function listAgentStatuses(): Promise<[string, string][]> {
  return invoke("list_agent_statuses");
}

// Approval commands

export async function respondToApproval(
  requestId: string,
  approved: boolean,
  reason?: string,
): Promise<void> {
  return invoke("respond_to_approval", { requestId, approved, reason });
}

// Dialog

export async function pickFolder(): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
    title: "Select project folder",
  });
  return result as string | null;
}
