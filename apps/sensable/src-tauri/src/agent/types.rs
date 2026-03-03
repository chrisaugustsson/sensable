use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionOption {
    pub label: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub question: String,
    pub header: Option<String>,
    pub options: Vec<QuestionOption>,
    pub multi_select: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum AgentEvent {
    MessageStart {
        session_id: String,
    },
    ContentDelta {
        text: String,
    },
    ContentComplete {
        full_text: String,
    },
    ToolUse {
        index: u64,
        tool_name: String,
        tool_input: serde_json::Value,
    },
    ToolInputDelta {
        index: u64,
        partial_json: String,
    },
    ToolResult {
        tool_name: String,
        result: serde_json::Value,
    },
    TextBlockStart {
        index: u64,
    },
    ContentBlockStop {
        index: u64,
    },
    UserQuestion {
        questions: Vec<Question>,
    },
    MessageEnd {
        session_id: String,
        /// Fallback: full response text from the result event
        result_text: String,
    },
    Error {
        message: String,
    },
    StatusChange {
        status: AgentStatus,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Starting,
    Running,
    Thinking,
    Stopped,
    Error,
}

/// Wrapper that includes context_key with every agent event.
/// Used to route events to the correct frontend session.
#[derive(Debug, Clone, Serialize)]
pub struct ScopedAgentEvent {
    pub context_key: String,
    #[serde(flatten)]
    pub event: AgentEvent,
}
