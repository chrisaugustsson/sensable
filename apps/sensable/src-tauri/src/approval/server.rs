use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::State as AxumState;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub request_id: String,
    pub tool_name: String,
    pub phase: String,
    pub artifact_type: String,
    pub title: String,
    pub preview: serde_json::Value,
    /// "create" | "update" | "delete" | "transition"
    pub action: String,
    /// For updates: the current artifact data (before changes)
    pub existing: Option<serde_json::Value>,
    /// Optional feature UUID for feature-scoped actions
    pub feature_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalResponse {
    pub approved: bool,
    pub reason: Option<String>,
    pub edited_data: Option<serde_json::Value>,
}

#[derive(Clone)]
struct ServerState {
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<ApprovalResponse>>>>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
}

pub struct ApprovalServer {
    port: Arc<Mutex<u16>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<ApprovalResponse>>>>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
}

impl ApprovalServer {
    pub fn new() -> Self {
        Self {
            port: Arc::new(Mutex::new(0)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            app_handle: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_app_handle(&self, handle: AppHandle) {
        let app_handle = self.app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let mut h = app_handle.lock().await;
            *h = Some(handle);
        });
    }

    pub async fn port(&self) -> u16 {
        *self.port.lock().await
    }

    pub async fn start(&self) -> Result<(), String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind approval server: {}", e))?;

        let addr = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local addr: {}", e))?;

        {
            let mut port = self.port.lock().await;
            *port = addr.port();
        }

        println!("Approval server listening on {}", addr);

        let state = ServerState {
            pending: self.pending.clone(),
            app_handle: self.app_handle.clone(),
        };

        let app = Router::new()
            .route("/approval-request", post(handle_approval_request))
            .route("/health", get(handle_health))
            .with_state(state);

        tauri::async_runtime::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("Approval server failed");
        });

        Ok(())
    }

    pub async fn respond(
        &self,
        request_id: String,
        response: ApprovalResponse,
    ) -> Result<(), String> {
        let mut pending = self.pending.lock().await;
        let sender = pending
            .remove(&request_id)
            .ok_or_else(|| format!("No pending approval for request_id: {}", request_id))?;

        sender
            .send(response)
            .map_err(|_| "Failed to send approval response (receiver dropped)".to_string())
    }
}

async fn handle_approval_request(
    AxumState(state): AxumState<ServerState>,
    Json(request): Json<ApprovalRequest>,
) -> Json<ApprovalResponse> {
    let request_id = request.request_id.clone();

    // Create oneshot channel
    let (tx, rx) = oneshot::channel::<ApprovalResponse>();

    // Store the sender
    {
        let mut pending = state.pending.lock().await;
        pending.insert(request_id.clone(), tx);
    }

    // Emit Tauri event to frontend
    {
        let handle = state.app_handle.lock().await;
        if let Some(ref app) = *handle {
            let _ = app.emit("agent:approval-request", &request);
        }
    }

    // Wait for response with 5-minute timeout
    let response =
        match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => {
                // Sender dropped (app closing or bug)
                ApprovalResponse {
                    approved: false,
                    reason: Some("Approval channel closed".to_string()),
                    edited_data: None,
                }
            }
            Err(_) => {
                // Timeout — remove from pending and auto-reject
                let mut pending = state.pending.lock().await;
                pending.remove(&request_id);
                ApprovalResponse {
                    approved: false,
                    reason: Some("Approval timed out after 5 minutes".to_string()),
                    edited_data: None,
                }
            }
        };

    Json(response)
}

async fn handle_health() -> &'static str {
    "ok"
}
