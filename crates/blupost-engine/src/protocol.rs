use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::contacts::ContactEntry;
use crate::session::SessionSnapshot;

pub const PROTOCOL_VERSION: u16 = 2;
pub const MAX_ENGINE_COMMAND_BYTES: usize = 64 * 1024;
pub const MAX_ENGINE_EVENT_BYTES: usize = 128 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum EngineCommand {
    Hello {
        request_id: String,
        version: u16,
    },
    Connect {
        request_id: String,
    },
    Send {
        request_id: String,
        recipient: String,
        body: String,
    },
    SetActiveThread {
        request_id: String,
        recipient: String,
    },
    SetDraft {
        request_id: String,
        recipient: String,
        body: String,
    },
    AddContact {
        request_id: String,
        alias: String,
        number: String,
    },
    Shutdown {
        request_id: String,
    },
}

impl EngineCommand {
    #[must_use]
    pub fn request_id(&self) -> &str {
        match self {
            Self::Hello { request_id, .. }
            | Self::Connect { request_id }
            | Self::Send { request_id, .. }
            | Self::SetActiveThread { request_id, .. }
            | Self::SetDraft { request_id, .. }
            | Self::AddContact { request_id, .. }
            | Self::Shutdown { request_id } => request_id,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineEvent {
    Ready {
        version: u16,
        request_id: String,
    },
    Snapshot {
        snapshot: EngineSnapshot,
    },
    Operation {
        request_id: String,
        operation: OperationKind,
        ok: bool,
    },
    Error {
        request_id: String,
        code: String,
        message: String,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    Connect,
    Send,
    SetActiveThread,
    SetDraft,
    AddContact,
    Shutdown,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct EngineSnapshot {
    pub connection: ConnectionState,
    pub contacts: Vec<ContactEntry>,
    pub session: SessionSnapshot,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected {
        phone_name: String,
        message_type: String,
    },
    Failed,
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("protocol frame is empty")]
    Empty,
    #[error("protocol frame exceeds {MAX_ENGINE_COMMAND_BYTES} bytes")]
    TooLarge,
    #[error("engine event exceeds {MAX_ENGINE_EVENT_BYTES} bytes")]
    EventTooLarge,
    #[error("invalid protocol frame")]
    Invalid(#[source] serde_json::Error),
    #[error("could not encode protocol frame")]
    Encode(#[source] serde_json::Error),
}

pub fn decode_command(line: &str) -> Result<EngineCommand, ProtocolError> {
    if line.trim().is_empty() {
        return Err(ProtocolError::Empty);
    }
    if line.len() > MAX_ENGINE_COMMAND_BYTES {
        return Err(ProtocolError::TooLarge);
    }
    serde_json::from_str(line).map_err(ProtocolError::Invalid)
}

pub fn encode_event(event: &EngineEvent) -> Result<String, ProtocolError> {
    let encoded = serde_json::to_string(event).map_err(ProtocolError::Encode)?;
    if encoded.len() > MAX_ENGINE_EVENT_BYTES {
        return Err(ProtocolError::EventTooLarge);
    }
    Ok(encoded)
}

pub fn invalid_recipient(request_id: String, error: impl std::fmt::Display) -> EngineEvent {
    EngineEvent::Error {
        request_id,
        code: "invalid_recipient".into(),
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_a_versioned_send_command() {
        let command = decode_command(
            r#"{"type":"send","request_id":"r1","recipient":"2025550101","body":"hello"}"#,
        )
        .expect("valid command");
        assert!(matches!(command, EngineCommand::Send { request_id, .. } if request_id == "r1"));
    }

    #[test]
    fn decodes_a_strict_add_contact_command() {
        let command = decode_command(
            r#"{"type":"add_contact","request_id":"r2","alias":"alice","number":"2025550101"}"#,
        )
        .expect("valid command");
        assert!(matches!(
            command,
            EngineCommand::AddContact {
                request_id,
                alias,
                ..
            } if request_id == "r2" && alias == "alice"
        ));
    }

    #[test]
    fn rejects_oversized_frames_before_json_parsing() {
        let frame = "x".repeat(MAX_ENGINE_COMMAND_BYTES + 1);
        assert!(matches!(
            decode_command(&frame),
            Err(ProtocolError::TooLarge)
        ));
    }

    #[test]
    fn rejects_unknown_command_fields() {
        assert!(matches!(
            decode_command(r#"{"type":"connect","request_id":"connect","unexpected":"value"}"#),
            Err(ProtocolError::Invalid(_))
        ));
    }
}
