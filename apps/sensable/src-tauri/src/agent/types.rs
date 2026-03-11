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

/// Token usage data from a Claude CLI result event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageData {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_input_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
    pub num_turns: Option<u64>,
    pub total_cost_usd: Option<f64>,
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
        /// Token usage from the CLI result event
        usage: Option<UsageData>,
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
