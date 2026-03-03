use super::types::AgentEvent;

/// Parse a single line of Claude CLI stream-json output into an AgentEvent.
///
/// The stream-json format emits one JSON object per line:
/// - {"type":"system","subtype":"init","session_id":"...","tools":[...],...}
/// - {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}}
/// - {"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use","name":"..."}}}
/// - {"type":"result","subtype":"success","session_id":"...","result":"..."}
/// - {"type":"result","subtype":"error","error":"..."}
pub fn parse_stream_line(line: &str) -> Option<AgentEvent> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    let json: serde_json::Value = serde_json::from_str(line).ok()?;
    let event_type = json.get("type")?.as_str()?;

    match event_type {
        "system" => parse_system_event(&json),
        "stream_event" => parse_stream_event(&json),
        "result" => parse_result_event(&json),
        _ => None,
    }
}

fn parse_system_event(json: &serde_json::Value) -> Option<AgentEvent> {
    let subtype = json.get("subtype")?.as_str()?;
    match subtype {
        "init" => {
            let session_id = json.get("session_id")?.as_str()?.to_string();
            Some(AgentEvent::MessageStart { session_id })
        }
        _ => None,
    }
}

fn parse_stream_event(json: &serde_json::Value) -> Option<AgentEvent> {
    let event = json.get("event")?;
    let event_type = event.get("type")?.as_str()?;

    match event_type {
        "content_block_delta" => {
            let delta = event.get("delta")?;
            let delta_type = delta.get("type")?.as_str()?;
            let index = event.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
            match delta_type {
                "text_delta" => {
                    let text = delta.get("text")?.as_str()?.to_string();
                    Some(AgentEvent::ContentDelta { text })
                }
                "input_json_delta" => {
                    let partial = delta
                        .get("partial_json")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    Some(AgentEvent::ToolInputDelta {
                        index,
                        partial_json: partial,
                    })
                }
                _ => None,
            }
        }
        "content_block_start" => {
            let content_block = event.get("content_block")?;
            let block_type = content_block.get("type")?.as_str()?;
            let index = event.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
            if block_type == "tool_use" {
                let tool_name = content_block.get("name")?.as_str()?.to_string();
                Some(AgentEvent::ToolUse {
                    index,
                    tool_name,
                    tool_input: serde_json::Value::Null,
                })
            } else if block_type == "text" {
                Some(AgentEvent::TextBlockStart { index })
            } else {
                None
            }
        }
        "content_block_stop" => {
            let index = event.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
            Some(AgentEvent::ContentBlockStop { index })
        }
        "message_stop" => {
            // We'll get the session_id from the result event instead
            None
        }
        _ => None,
    }
}

fn parse_result_event(json: &serde_json::Value) -> Option<AgentEvent> {
    let subtype = json.get("subtype")?.as_str()?;
    match subtype {
        "success" => {
            let session_id = json.get("session_id")?.as_str()?.to_string();
            // Extract the result text as fallback content (in case streaming deltas were missed)
            let result_text = json
                .get("result")
                .and_then(|r| r.as_str())
                .unwrap_or("")
                .to_string();
            Some(AgentEvent::MessageEnd {
                session_id,
                result_text,
            })
        }
        "error" => {
            let error = json
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("Unknown error")
                .to_string();
            Some(AgentEvent::Error { message: error })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_init_event() {
        let line = r#"{"type":"system","subtype":"init","session_id":"abc-123","tools":[]}"#;
        match parse_stream_line(line) {
            Some(AgentEvent::MessageStart { session_id }) => {
                assert_eq!(session_id, "abc-123");
            }
            other => panic!("Expected MessageStart, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_text_delta() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}}"#;
        match parse_stream_line(line) {
            Some(AgentEvent::ContentDelta { text }) => {
                assert_eq!(text, "Hello");
            }
            other => panic!("Expected ContentDelta, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_tool_use_start() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_1","name":"get_project_state"}}}"#;
        match parse_stream_line(line) {
            Some(AgentEvent::ToolUse {
                index,
                tool_name,
                tool_input,
            }) => {
                assert_eq!(index, 1);
                assert_eq!(tool_name, "get_project_state");
                assert_eq!(tool_input, serde_json::Value::Null);
            }
            other => panic!("Expected ToolUse, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_result_success() {
        let line = r#"{"type":"result","subtype":"success","session_id":"abc-123","result":"Done","cost_usd":0.01,"duration_ms":5000}"#;
        match parse_stream_line(line) {
            Some(AgentEvent::MessageEnd {
                session_id,
                result_text,
            }) => {
                assert_eq!(session_id, "abc-123");
                assert_eq!(result_text, "Done");
            }
            other => panic!("Expected MessageEnd, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_result_error() {
        let line = r#"{"type":"result","subtype":"error","error":"Something went wrong"}"#;
        match parse_stream_line(line) {
            Some(AgentEvent::Error { message }) => {
                assert_eq!(message, "Something went wrong");
            }
            other => panic!("Expected Error, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_empty_line() {
        assert!(parse_stream_line("").is_none());
        assert!(parse_stream_line("  ").is_none());
    }

    #[test]
    fn test_parse_invalid_json() {
        assert!(parse_stream_line("not json").is_none());
    }

    #[test]
    fn test_parse_input_json_delta() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"phase\":"}}}"#;
        match parse_stream_line(line) {
            Some(AgentEvent::ToolInputDelta {
                index,
                partial_json,
            }) => {
                assert_eq!(index, 1);
                assert_eq!(partial_json, r#"{"phase":"#);
            }
            other => panic!("Expected ToolInputDelta, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_content_block_stop() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_stop","index":2}}"#;
        match parse_stream_line(line) {
            Some(AgentEvent::ContentBlockStop { index }) => {
                assert_eq!(index, 2);
            }
            other => panic!("Expected ContentBlockStop, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_text_block_start() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}"#;
        match parse_stream_line(line) {
            Some(AgentEvent::TextBlockStart { index }) => {
                assert_eq!(index, 0);
            }
            other => panic!("Expected TextBlockStart, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_unknown_event() {
        let line = r#"{"type":"unknown","data":"something"}"#;
        assert!(parse_stream_line(line).is_none());
    }
}
