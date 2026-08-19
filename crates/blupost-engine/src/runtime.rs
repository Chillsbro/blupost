//! Serialized engine runtime for the JSONL adapter. This module owns protocol ordering, request
//! deduplication, reconnect timers, and the publication order around asynchronous phone effects.

use std::io;
use std::path::PathBuf;

use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, BufWriter};

use crate::contacts::ContactsConfig;
use crate::engine::BlupostEngine;
use crate::phone::PhonePort;
use crate::protocol::{
    EngineCommand, EngineEvent, MAX_ENGINE_COMMAND_BYTES, PROTOCOL_VERSION, ProtocolError,
    decode_command, encode_event,
};

const MAX_REQUEST_ID_BYTES: usize = 128;

pub struct EngineRuntime<P> {
    engine: BlupostEngine<P>,
    protocol: ProtocolSession,
}

impl<P: PhonePort> EngineRuntime<P> {
    pub fn new(phone: P, contacts: ContactsConfig) -> Self {
        Self {
            engine: BlupostEngine::with_contacts(phone, contacts),
            protocol: ProtocolSession::default(),
        }
    }

    pub fn with_persistent_contacts(
        phone: P,
        contacts: ContactsConfig,
        contacts_path: PathBuf,
    ) -> Self {
        Self {
            engine: BlupostEngine::with_persistent_contacts(phone, contacts, contacts_path),
            protocol: ProtocolSession::default(),
        }
    }

    pub async fn run<R, W>(mut self, input: R, output: W) -> Result<(), EngineRuntimeError>
    where
        R: AsyncRead + Unpin,
        W: AsyncWrite + Unpin,
    {
        let mut lines = BoundedLines::new(input);
        let mut output = BufWriter::new(output);

        loop {
            let action = if let Some(deadline) = self.engine.reconnect_deadline() {
                tokio::select! {
                    line = lines.next_line() => {
                        NextAction::Protocol(line.map_err(EngineRuntimeError::Input)?)
                    }
                    () = tokio::time::sleep_until(deadline) => NextAction::Reconnect,
                }
            } else {
                tokio::select! {
                    line = lines.next_line() => {
                        NextAction::Protocol(line.map_err(EngineRuntimeError::Input)?)
                    }
                    events = self.engine.next_phone_event(), if self.engine.is_connected() => {
                        NextAction::Phone(events)
                    }
                }
            };

            match action {
                NextAction::Protocol(ProtocolInput::Eof) => {
                    self.engine
                        .handle(EngineCommand::Shutdown {
                            request_id: "stdin-closed".into(),
                        })
                        .await;
                    break;
                }
                NextAction::Protocol(ProtocolInput::Line(line)) => {
                    self.handle_protocol_line(&line, &mut output).await?;
                }
                NextAction::Protocol(ProtocolInput::Invalid(message)) => {
                    write_events(
                        &mut output,
                        vec![EngineEvent::Error {
                            request_id: "invalid-frame".into(),
                            code: "invalid_frame".into(),
                            message: message.into(),
                        }],
                    )
                    .await?;
                }
                NextAction::Phone(events) => write_events(&mut output, events).await?,
                NextAction::Reconnect => {
                    if let Some(progress) = self.engine.begin_scheduled_reconnect() {
                        write_events(&mut output, vec![progress]).await?;
                        let events = self.engine.finish_scheduled_reconnect().await;
                        write_events(&mut output, events).await?;
                    }
                }
            }
            if self.engine.is_closed() {
                break;
            }
        }
        Ok(())
    }

    async fn handle_protocol_line<W: AsyncWrite + Unpin>(
        &mut self,
        line: &str,
        output: &mut BufWriter<W>,
    ) -> Result<(), EngineRuntimeError> {
        let command = match decode_command(line) {
            Ok(command) => command,
            Err(error) => {
                write_events(
                    output,
                    vec![EngineEvent::Error {
                        request_id: "invalid-frame".into(),
                        code: "invalid_frame".into(),
                        message: error.to_string(),
                    }],
                )
                .await?;
                return Ok(());
            }
        };
        if let Some(error) = self.protocol.validate(&command) {
            write_events(output, vec![error]).await?;
            return Ok(());
        }

        let plan = self.engine.prepare_command(command).await;
        let (progress, effect) = plan.into_parts();
        write_events(output, progress).await?;
        let events = self.engine.finish_command(effect).await;
        write_events(output, events).await
    }
}

enum NextAction {
    Protocol(ProtocolInput),
    Phone(Vec<EngineEvent>),
    Reconnect,
}

enum ProtocolInput {
    Eof,
    Line(String),
    Invalid(&'static str),
}

struct BoundedLines<R> {
    reader: BufReader<R>,
    buffer: Vec<u8>,
    over_limit: bool,
}

impl<R: AsyncRead + Unpin> BoundedLines<R> {
    fn new(reader: R) -> Self {
        Self {
            reader: BufReader::new(reader),
            buffer: Vec::new(),
            over_limit: false,
        }
    }

    async fn next_line(&mut self) -> io::Result<ProtocolInput> {
        loop {
            let available = self.reader.fill_buf().await?;
            if available.is_empty() {
                if self.buffer.is_empty() && !self.over_limit {
                    return Ok(ProtocolInput::Eof);
                }
                return Ok(self.finish_line());
            }

            let newline = available.iter().position(|byte| *byte == b'\n');
            let length = newline.unwrap_or(available.len());
            let chunk = available[..length].to_vec();
            let consumed = length + usize::from(newline.is_some());
            self.reader.consume(consumed);
            self.push_chunk(&chunk);
            if newline.is_some() {
                return Ok(self.finish_line());
            }
        }
    }

    fn push_chunk(&mut self, chunk: &[u8]) {
        let remaining = MAX_ENGINE_COMMAND_BYTES.saturating_sub(self.buffer.len());
        self.buffer
            .extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        self.over_limit |= chunk.len() > remaining;
    }

    fn finish_line(&mut self) -> ProtocolInput {
        if self.over_limit {
            self.buffer.clear();
            self.over_limit = false;
            return ProtocolInput::Invalid("protocol frame exceeds 65536 bytes");
        }
        let mut bytes = std::mem::take(&mut self.buffer);
        if bytes.last() == Some(&b'\r') {
            bytes.pop();
        }
        match String::from_utf8(bytes) {
            Ok(line) => ProtocolInput::Line(line),
            Err(_) => ProtocolInput::Invalid("protocol frame is not valid UTF-8"),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct RequestId(u64);

impl RequestId {
    fn parse(value: &str) -> Option<Self> {
        if value.is_empty()
            || value.len() > MAX_REQUEST_ID_BYTES
            || !value.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        value
            .parse()
            .ok()
            .filter(|sequence| *sequence > 0)
            .map(Self)
    }
}

#[derive(Default)]
struct ProtocolSession {
    ready: bool,
    last_request: Option<RequestId>,
}

impl ProtocolSession {
    fn validate(&mut self, command: &EngineCommand) -> Option<EngineEvent> {
        let request_id = command.request_id();
        let Some(sequence) = RequestId::parse(request_id) else {
            return Some(EngineEvent::Error {
                request_id: "invalid-request-id".into(),
                code: "invalid_request_id".into(),
                message: "request identifiers must be positive decimal sequences".into(),
            });
        };
        if self.last_request == Some(sequence) {
            return Some(EngineEvent::Error {
                request_id: request_id.into(),
                code: "duplicate_request".into(),
                message: "request identifiers cannot be reused within one engine session".into(),
            });
        }
        if self.last_request.is_some_and(|last| sequence < last) {
            return Some(EngineEvent::Error {
                request_id: request_id.into(),
                code: "out_of_order_request".into(),
                message: "request identifiers must increase within one engine session".into(),
            });
        }
        self.last_request = Some(sequence);

        match command {
            EngineCommand::Hello { request_id, .. } if self.ready => Some(EngineEvent::Error {
                request_id: request_id.clone(),
                code: "hello_already_complete".into(),
                message: "the protocol handshake is already complete".into(),
            }),
            EngineCommand::Hello { version, .. } if *version == PROTOCOL_VERSION => {
                self.ready = true;
                None
            }
            EngineCommand::Hello { .. } => None,
            command if !self.ready => Some(EngineEvent::Error {
                request_id: command.request_id().into(),
                code: "handshake_required".into(),
                message: "complete the versioned hello handshake before other commands".into(),
            }),
            _ => None,
        }
    }
}

async fn write_events<W: AsyncWrite + Unpin>(
    output: &mut BufWriter<W>,
    events: Vec<EngineEvent>,
) -> Result<(), EngineRuntimeError> {
    for event in events {
        output
            .write_all(encode_event(&event)?.as_bytes())
            .await
            .map_err(EngineRuntimeError::Output)?;
        output
            .write_all(b"\n")
            .await
            .map_err(EngineRuntimeError::Output)?;
    }
    output.flush().await.map_err(EngineRuntimeError::Output)
}

#[derive(Debug, Error)]
pub enum EngineRuntimeError {
    #[error("engine protocol input failed")]
    Input(#[source] io::Error),
    #[error("engine protocol output failed")]
    Output(#[source] io::Error),
    #[error(transparent)]
    Protocol(#[from] ProtocolError),
}

#[cfg(test)]
mod tests {
    use std::future::pending;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use serde_json::{Value, json};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, ReadHalf, WriteHalf};
    use tokio::sync::oneshot;
    use tokio::time::{Duration, timeout};

    use super::*;
    use crate::engine::PHONE_CONNECT_TIMEOUT;
    use crate::phone::{PhoneCapabilities, PhoneError, PhoneEvent};
    use crate::session::PhoneNumber;

    type ClientWriter = WriteHalf<DuplexStream>;
    type ClientReader = tokio::io::Lines<BufReader<ReadHalf<DuplexStream>>>;
    type RuntimeTask = tokio::task::JoinHandle<Result<(), EngineRuntimeError>>;

    struct FakePhone {
        sends: Arc<AtomicUsize>,
        sent_bodies: Arc<Mutex<Vec<String>>>,
        release_send: Option<oneshot::Receiver<()>>,
    }

    impl PhonePort for FakePhone {
        async fn connect(&mut self) -> Result<PhoneCapabilities, PhoneError> {
            Ok(PhoneCapabilities {
                name: "Test iPhone".into(),
                message_type: "SMS_GSM".into(),
            })
        }

        async fn send(&mut self, _recipient: &PhoneNumber, body: &str) -> Result<(), PhoneError> {
            self.sends.fetch_add(1, Ordering::SeqCst);
            self.sent_bodies
                .lock()
                .expect("sent body lock")
                .push(body.into());
            if let Some(release) = self.release_send.take() {
                let _ = release.await;
            }
            Ok(())
        }

        async fn next_event(&mut self) -> Result<PhoneEvent, PhoneError> {
            pending().await
        }

        async fn close(&mut self) -> Result<(), PhoneError> {
            Ok(())
        }
    }

    struct PendingConnectPhone;

    impl PhonePort for PendingConnectPhone {
        async fn connect(&mut self) -> Result<PhoneCapabilities, PhoneError> {
            pending().await
        }

        async fn send(&mut self, _recipient: &PhoneNumber, _body: &str) -> Result<(), PhoneError> {
            panic!("send must not run during a pending connect")
        }

        async fn next_event(&mut self) -> Result<PhoneEvent, PhoneError> {
            pending().await
        }

        async fn close(&mut self) -> Result<(), PhoneError> {
            Ok(())
        }
    }

    async fn write_command(writer: &mut WriteHalf<DuplexStream>, command: Value) {
        writer
            .write_all(format!("{command}\n").as_bytes())
            .await
            .expect("write command");
    }

    async fn read_event(reader: &mut tokio::io::Lines<BufReader<ReadHalf<DuplexStream>>>) -> Value {
        let line = timeout(Duration::from_secs(1), reader.next_line())
            .await
            .expect("event timeout")
            .expect("read event")
            .expect("engine event");
        serde_json::from_str(&line).expect("JSON event")
    }

    fn spawn_runtime(phone: FakePhone) -> (ClientWriter, ClientReader, RuntimeTask) {
        let (client, server) = tokio::io::duplex(MAX_ENGINE_COMMAND_BYTES * 2);
        let (client_read, client_write) = tokio::io::split(client);
        let (server_read, server_write) = tokio::io::split(server);
        let task = tokio::spawn(
            EngineRuntime::new(phone, ContactsConfig::default()).run(server_read, server_write),
        );
        (client_write, BufReader::new(client_read).lines(), task)
    }

    #[tokio::test]
    async fn publishes_sending_before_one_phone_effect_and_then_final_state() {
        let sends = Arc::new(AtomicUsize::new(0));
        let sent_bodies = Arc::new(Mutex::new(Vec::new()));
        let (release_send, wait_for_release) = oneshot::channel();
        let phone = FakePhone {
            sends: sends.clone(),
            sent_bodies: sent_bodies.clone(),
            release_send: Some(wait_for_release),
        };
        let (mut writer, mut reader, task) = spawn_runtime(phone);

        write_command(
            &mut writer,
            json!({"type":"hello","request_id":"1","version":PROTOCOL_VERSION}),
        )
        .await;
        assert_eq!(read_event(&mut reader).await["type"], "snapshot");
        assert_eq!(read_event(&mut reader).await["type"], "ready");

        write_command(&mut writer, json!({"type":"connect","request_id":"2"})).await;
        let connecting = read_event(&mut reader).await;
        assert_eq!(connecting["type"], "snapshot");
        assert_eq!(connecting["snapshot"]["connection"]["state"], "connecting");
        let connected = read_event(&mut reader).await;
        assert_eq!(connected["type"], "snapshot");
        assert_eq!(connected["snapshot"]["connection"]["state"], "connected");
        assert_eq!(read_event(&mut reader).await["type"], "operation");

        write_command(
            &mut writer,
            json!({
                "type":"set_draft",
                "request_id":"3",
                "recipient":"2025550101",
                "body":"stale"
            }),
        )
        .await;
        assert_eq!(read_event(&mut reader).await["type"], "operation");

        write_command(
            &mut writer,
            json!({
                "type":"send",
                "request_id":"4",
                "recipient":"2025550101",
                "body":"submitted"
            }),
        )
        .await;
        let progress = read_event(&mut reader).await;
        assert_eq!(progress["type"], "snapshot");
        assert_eq!(
            progress["snapshot"]["session"]["threads"][0]["messages"][0]["state"],
            "sending"
        );
        assert_eq!(sends.load(Ordering::SeqCst), 1);
        assert_eq!(
            sent_bodies.lock().expect("sent bodies").as_slice(),
            ["submitted"]
        );

        write_command(
            &mut writer,
            json!({
                "type":"set_draft",
                "request_id":"5",
                "recipient":"2025550101",
                "body":"newer"
            }),
        )
        .await;

        release_send.send(()).expect("release phone send");
        let completed = read_event(&mut reader).await;
        assert_eq!(
            completed["snapshot"]["session"]["threads"][0]["messages"][0]["state"],
            "sent"
        );
        assert_eq!(sends.load(Ordering::SeqCst), 1);
        assert_eq!(read_event(&mut reader).await["type"], "operation");

        assert_eq!(read_event(&mut reader).await["type"], "operation");
        write_command(
            &mut writer,
            json!({
                "type":"set_active_thread",
                "request_id":"6",
                "recipient":"2025550101"
            }),
        )
        .await;
        let newer_draft = read_event(&mut reader).await;
        assert_eq!(
            newer_draft["snapshot"]["session"]["threads"][0]["draft"],
            "newer"
        );
        assert_eq!(read_event(&mut reader).await["type"], "operation");

        write_command(&mut writer, json!({"type":"shutdown","request_id":"7"})).await;
        assert_eq!(read_event(&mut reader).await["type"], "snapshot");
        assert_eq!(read_event(&mut reader).await["type"], "operation");
        task.await.expect("join runtime").expect("runtime success");
    }

    #[tokio::test]
    async fn runtime_recovers_framing_after_rejected_commands_and_oversized_lines() {
        let phone = FakePhone {
            sends: Arc::new(AtomicUsize::new(0)),
            sent_bodies: Arc::new(Mutex::new(Vec::new())),
            release_send: None,
        };
        let (mut writer, mut reader, task) = spawn_runtime(phone);

        write_command(&mut writer, json!({"type":"connect","request_id":"1"})).await;
        assert_eq!(read_event(&mut reader).await["code"], "handshake_required");

        writer
            .write_all(format!("{}\n", "x".repeat(MAX_ENGINE_COMMAND_BYTES + 1)).as_bytes())
            .await
            .expect("write oversized line");
        assert_eq!(read_event(&mut reader).await["code"], "invalid_frame");

        write_command(
            &mut writer,
            json!({"type":"hello","request_id":"2","version":PROTOCOL_VERSION}),
        )
        .await;
        assert_eq!(read_event(&mut reader).await["type"], "snapshot");
        assert_eq!(read_event(&mut reader).await["type"], "ready");

        write_command(
            &mut writer,
            json!({"type":"hello","request_id":"3","version":PROTOCOL_VERSION}),
        )
        .await;
        assert_eq!(
            read_event(&mut reader).await["code"],
            "hello_already_complete"
        );
        write_command(
            &mut writer,
            json!({"type":"hello","request_id":"3","version":PROTOCOL_VERSION}),
        )
        .await;
        assert_eq!(read_event(&mut reader).await["code"], "duplicate_request");

        write_command(&mut writer, json!({"type":"connect","request_id":"2"})).await;
        assert_eq!(
            read_event(&mut reader).await["code"],
            "out_of_order_request"
        );

        write_command(&mut writer, json!({"type":"shutdown","request_id":"4"})).await;
        assert_eq!(read_event(&mut reader).await["type"], "snapshot");
        assert_eq!(read_event(&mut reader).await["type"], "operation");
        task.await.expect("join runtime").expect("runtime success");
    }

    #[tokio::test(start_paused = true)]
    async fn pending_connect_times_out_before_queued_shutdown_completes() {
        let (client, server) = tokio::io::duplex(MAX_ENGINE_COMMAND_BYTES * 2);
        let (client_read, mut client_write) = tokio::io::split(client);
        let (server_read, server_write) = tokio::io::split(server);
        let mut reader = BufReader::new(client_read).lines();
        let task = tokio::spawn(
            EngineRuntime::new(PendingConnectPhone, ContactsConfig::default())
                .run(server_read, server_write),
        );

        write_command(
            &mut client_write,
            json!({"type":"hello","request_id":"1","version":PROTOCOL_VERSION}),
        )
        .await;
        assert_eq!(read_event(&mut reader).await["type"], "snapshot");
        assert_eq!(read_event(&mut reader).await["type"], "ready");

        write_command(
            &mut client_write,
            json!({"type":"connect","request_id":"2"}),
        )
        .await;
        let connecting = read_event(&mut reader).await;
        assert_eq!(connecting["snapshot"]["connection"]["state"], "connecting");

        write_command(
            &mut client_write,
            json!({"type":"shutdown","request_id":"3"}),
        )
        .await;
        tokio::time::advance(PHONE_CONNECT_TIMEOUT).await;

        let failed = read_event(&mut reader).await;
        assert_eq!(failed["snapshot"]["connection"]["state"], "failed");
        let connect_error = read_event(&mut reader).await;
        assert_eq!(connect_error["request_id"], "2");
        assert_eq!(connect_error["code"], "connect_failed");

        let closed = read_event(&mut reader).await;
        assert_eq!(closed["snapshot"]["connection"]["state"], "disconnected");
        let shutdown = read_event(&mut reader).await;
        assert_eq!(shutdown["request_id"], "3");
        assert_eq!(shutdown["operation"], "shutdown");
        assert_eq!(shutdown["ok"], true);
        task.await.expect("join runtime").expect("runtime success");
    }
}
