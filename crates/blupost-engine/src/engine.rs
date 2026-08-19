use std::path::PathBuf;

use crate::contacts::{ContactsConfig, ContactsError};
use crate::phone::bmessage::{BMessageError, validate_body};
use crate::phone::{PhoneCapabilities, PhoneError, PhoneEvent, PhonePort};
use crate::protocol::{
    ConnectionState, EngineCommand, EngineEvent, EngineSnapshot, OperationKind, PROTOCOL_VERSION,
    invalid_recipient,
};
use crate::session::{PhoneNumber, SessionThreads};
use tokio::time::{Duration, Instant, timeout};

pub(crate) const PHONE_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const PHONE_SEND_TIMEOUT: Duration = Duration::from_secs(35);
const PHONE_CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

const RECONNECT_DELAYS: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
];

enum ReconnectState {
    Idle,
    Scheduled { attempt: usize, due: Instant },
    InFlight { attempt: usize },
}

pub(crate) struct PreparedSend {
    request_id: String,
    recipient: PhoneNumber,
    body: String,
    message_id: u64,
}

pub(crate) struct PreparedConnect {
    request_id: String,
}

pub(crate) struct CommandPlan {
    before_effect: Vec<EngineEvent>,
    effect: CommandEffect,
}

pub(crate) enum CommandEffect {
    Complete(Vec<EngineEvent>),
    Connect(PreparedConnect),
    Send(PreparedSend),
}

impl CommandPlan {
    fn complete(events: Vec<EngineEvent>) -> Self {
        Self {
            before_effect: Vec::new(),
            effect: CommandEffect::Complete(events),
        }
    }

    fn send(prepared: PreparedSend, progress: EngineEvent) -> Self {
        Self {
            before_effect: vec![progress],
            effect: CommandEffect::Send(prepared),
        }
    }

    fn connect(prepared: PreparedConnect, progress: EngineEvent) -> Self {
        Self {
            before_effect: vec![progress],
            effect: CommandEffect::Connect(prepared),
        }
    }

    pub(crate) fn into_parts(self) -> (Vec<EngineEvent>, CommandEffect) {
        (self.before_effect, self.effect)
    }
}

pub struct BlupostEngine<P> {
    phone: P,
    contacts: ContactsConfig,
    contacts_path: Option<PathBuf>,
    session: SessionThreads,
    connection: ConnectionState,
    reconnect: ReconnectState,
    closed: bool,
}

impl<P: PhonePort> BlupostEngine<P> {
    pub fn new(phone: P) -> Self {
        Self::with_contacts(phone, ContactsConfig::default())
    }

    pub fn with_contacts(phone: P, contacts: ContactsConfig) -> Self {
        Self::from_contacts(phone, contacts, None)
    }

    pub fn with_persistent_contacts(
        phone: P,
        contacts: ContactsConfig,
        contacts_path: PathBuf,
    ) -> Self {
        Self::from_contacts(phone, contacts, Some(contacts_path))
    }

    fn from_contacts(phone: P, contacts: ContactsConfig, contacts_path: Option<PathBuf>) -> Self {
        Self {
            phone,
            contacts,
            contacts_path,
            session: SessionThreads::default(),
            connection: ConnectionState::Disconnected,
            reconnect: ReconnectState::Idle,
            closed: false,
        }
    }

    pub fn snapshot(&self) -> EngineSnapshot {
        EngineSnapshot {
            connection: self.connection.clone(),
            contacts: self.contacts.entries(),
            session: self.session.snapshot(),
        }
    }

    pub(crate) fn is_connected(&self) -> bool {
        matches!(self.connection, ConnectionState::Connected { .. })
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.closed
    }

    pub(crate) fn reconnect_deadline(&self) -> Option<Instant> {
        match self.reconnect {
            ReconnectState::Scheduled { due, .. } => Some(due),
            ReconnectState::Idle | ReconnectState::InFlight { .. } => None,
        }
    }

    pub(crate) fn begin_scheduled_reconnect(&mut self) -> Option<EngineEvent> {
        let state = std::mem::replace(&mut self.reconnect, ReconnectState::Idle);
        let ReconnectState::Scheduled { attempt, .. } = state else {
            self.reconnect = state;
            return None;
        };
        self.reconnect = ReconnectState::InFlight { attempt };
        self.connection = ConnectionState::Connecting;
        Some(self.snapshot_event())
    }

    pub(crate) async fn finish_scheduled_reconnect(&mut self) -> Vec<EngineEvent> {
        let state = std::mem::replace(&mut self.reconnect, ReconnectState::Idle);
        let ReconnectState::InFlight { attempt } = state else {
            self.reconnect = state;
            return Vec::new();
        };
        if let Ok(capabilities) = self.connect_phone().await {
            self.connection = ConnectionState::Connected {
                phone_name: capabilities.name,
                message_type: capabilities.message_type,
            };
            return vec![self.snapshot_event()];
        }

        if attempt + 1 < RECONNECT_DELAYS.len() {
            self.connection = ConnectionState::Disconnected;
            self.schedule_reconnect(attempt + 1);
        } else {
            self.connection = ConnectionState::Failed;
        }
        vec![
            self.snapshot_event(),
            EngineEvent::Error {
                request_id: format!("auto-reconnect-{}", attempt + 1),
                code: "reconnect_failed".into(),
                message: if matches!(self.connection, ConnectionState::Failed) {
                    "automatic reconnect limit reached; click the status to try again".into()
                } else {
                    "automatic reconnect attempt failed; another bounded attempt is scheduled"
                        .into()
                },
            },
        ]
    }

    pub async fn handle(&mut self, command: EngineCommand) -> Vec<EngineEvent> {
        let plan = self.prepare_command(command).await;
        let (mut events, effect) = plan.into_parts();
        events.extend(self.finish_command(effect).await);
        events
    }

    pub(crate) async fn prepare_command(&mut self, command: EngineCommand) -> CommandPlan {
        match command {
            EngineCommand::Hello {
                request_id,
                version,
            } => {
                if version != PROTOCOL_VERSION {
                    return CommandPlan::complete(vec![EngineEvent::Error {
                        request_id,
                        code: "protocol_version".into(),
                        message: format!(
                            "frontend protocol {version} does not match engine protocol {PROTOCOL_VERSION}"
                        ),
                    }]);
                }
                CommandPlan::complete(vec![
                    self.snapshot_event(),
                    EngineEvent::Ready {
                        version: PROTOCOL_VERSION,
                        request_id,
                    },
                ])
            }
            EngineCommand::Connect { request_id } => self.begin_connect(request_id),
            EngineCommand::Send {
                request_id,
                recipient,
                body,
            } => match self.begin_send(request_id, &recipient, body) {
                Ok((prepared, progress)) => CommandPlan::send(prepared, progress),
                Err(events) => CommandPlan::complete(events),
            },
            EngineCommand::SetActiveThread {
                request_id,
                recipient,
            } => CommandPlan::complete(self.set_active_thread(request_id, &recipient)),
            EngineCommand::SetDraft {
                request_id,
                recipient,
                body,
            } => CommandPlan::complete(self.set_draft(request_id, &recipient, body)),
            EngineCommand::AddContact {
                request_id,
                alias,
                number,
            } => CommandPlan::complete(self.add_contact(request_id, &alias, &number)),
            EngineCommand::Shutdown { request_id } => {
                let ok = self.close_phone().await.is_ok();
                self.connection = ConnectionState::Disconnected;
                self.reconnect = ReconnectState::Idle;
                self.closed = true;
                CommandPlan::complete(vec![
                    self.snapshot_event(),
                    EngineEvent::Operation {
                        request_id,
                        operation: OperationKind::Shutdown,
                        ok,
                    },
                ])
            }
        }
    }

    pub(crate) async fn finish_command(&mut self, effect: CommandEffect) -> Vec<EngineEvent> {
        match effect {
            CommandEffect::Complete(events) => events,
            CommandEffect::Connect(prepared) => self.finish_connect(prepared).await,
            CommandEffect::Send(prepared) => self.finish_send(prepared).await,
        }
    }

    pub(crate) async fn next_phone_event(&mut self) -> Vec<EngineEvent> {
        if let Ok(event) = self.phone.next_event().await {
            self.accept_phone_event(event)
        } else {
            self.connection = ConnectionState::Disconnected;
            self.schedule_reconnect(0);
            vec![
                self.snapshot_event(),
                EngineEvent::Error {
                    request_id: "phone-event".into(),
                    code: "phone_event_failed".into(),
                    message: "the live phone event stream failed".into(),
                },
            ]
        }
    }

    fn accept_phone_event(&mut self, event: PhoneEvent) -> Vec<EngineEvent> {
        match event {
            PhoneEvent::Incoming { sender, body } => {
                self.session.receive(sender, body);
            }
            PhoneEvent::IncomingSkipped => {
                return vec![EngineEvent::Error {
                    request_id: "phone-event".into(),
                    code: "incoming_skipped".into(),
                    message:
                        "an incoming MAP notification was invalid and was skipped; the session remains connected"
                            .into(),
                }];
            }
            PhoneEvent::Disconnected => {
                self.connection = ConnectionState::Disconnected;
                self.schedule_reconnect(0);
            }
        }
        vec![self.snapshot_event()]
    }

    fn begin_connect(&mut self, request_id: String) -> CommandPlan {
        self.reconnect = ReconnectState::Idle;
        self.connection = ConnectionState::Connecting;
        CommandPlan::connect(PreparedConnect { request_id }, self.snapshot_event())
    }

    async fn finish_connect(&mut self, prepared: PreparedConnect) -> Vec<EngineEvent> {
        if let Ok(capabilities) = self.connect_phone().await {
            self.connection = ConnectionState::Connected {
                phone_name: capabilities.name,
                message_type: capabilities.message_type,
            };
            vec![
                self.snapshot_event(),
                EngineEvent::Operation {
                    request_id: prepared.request_id,
                    operation: OperationKind::Connect,
                    ok: true,
                },
            ]
        } else {
            self.connection = ConnectionState::Failed;
            vec![
                self.snapshot_event(),
                EngineEvent::Error {
                    request_id: prepared.request_id,
                    code: "connect_failed".into(),
                    message: "could not open the iPhone MAP session; run blupost doctor".into(),
                },
            ]
        }
    }

    pub(crate) fn begin_send(
        &mut self,
        request_id: String,
        recipient: &str,
        body: String,
    ) -> Result<(PreparedSend, EngineEvent), Vec<EngineEvent>> {
        if !self.is_connected() {
            return Err(vec![EngineEvent::Error {
                request_id,
                code: "not_connected".into(),
                message: "connect the iPhone before sending".into(),
            }]);
        }
        if let Err(error) = validate_body(&body) {
            return Err(vec![invalid_message(request_id, &error)]);
        }
        let recipient = match self.contacts.resolve(recipient) {
            Ok(recipient) => recipient,
            Err(error) => return Err(vec![invalid_recipient(request_id, error)]),
        };

        Ok(self.prepare_send(request_id, recipient, body))
    }

    fn prepare_send(
        &mut self,
        request_id: String,
        recipient: PhoneNumber,
        body: String,
    ) -> (PreparedSend, EngineEvent) {
        let message_id = self
            .session
            .submit_outgoing(recipient.clone(), body.clone());
        let progress = self.snapshot_event();
        (
            PreparedSend {
                request_id,
                recipient,
                body,
                message_id,
            },
            progress,
        )
    }

    pub(crate) async fn finish_send(&mut self, prepared: PreparedSend) -> Vec<EngineEvent> {
        match self.send_phone(&prepared.recipient, &prepared.body).await {
            Ok(()) => {
                self.session.mark_sent(prepared.message_id);
                vec![
                    self.snapshot_event(),
                    EngineEvent::Operation {
                        request_id: prepared.request_id,
                        operation: OperationKind::Send,
                        ok: true,
                    },
                ]
            }
            Err(PhoneError::TransferOutcomeUnknown) => {
                self.session.mark_unknown(prepared.message_id);
                vec![
                    self.snapshot_event(),
                    EngineEvent::Error {
                        request_id: prepared.request_id,
                        code: "send_outcome_unknown".into(),
                        message: "the send outcome is unknown; check the phone before trying again"
                            .into(),
                    },
                ]
            }
            Err(error) => {
                self.session.mark_failed(prepared.message_id);
                let code = match &error {
                    PhoneError::Map(_) => "send_transport_failed",
                    PhoneError::Dbus(_) => "send_dbus_failed",
                    PhoneError::Timeout => "send_cancelled",
                    PhoneError::NotConnected
                    | PhoneError::NoMapPhone
                    | PhoneError::MultipleMapPhones => "send_disconnected",
                    PhoneError::InvalidMessage(_) => "send_invalid_message",
                    PhoneError::TemporaryStorage(_) => "send_storage_failed",
                    PhoneError::TransferOutcomeUnknown => unreachable!(
                        "indeterminate transfer outcomes are handled before known failures"
                    ),
                };
                vec![
                    self.snapshot_event(),
                    EngineEvent::Error {
                        request_id: prepared.request_id,
                        code: code.into(),
                        message: error.to_string(),
                    },
                ]
            }
        }
    }

    fn set_active_thread(&mut self, request_id: String, recipient: &str) -> Vec<EngineEvent> {
        let recipient: PhoneNumber = match self.contacts.resolve(recipient) {
            Ok(recipient) => recipient,
            Err(error) => return vec![invalid_recipient(request_id, error)],
        };
        self.session.set_active_thread(&recipient);
        vec![
            self.snapshot_event(),
            EngineEvent::Operation {
                request_id,
                operation: OperationKind::SetActiveThread,
                ok: true,
            },
        ]
    }

    fn set_draft(&mut self, request_id: String, recipient: &str, body: String) -> Vec<EngineEvent> {
        let recipient: PhoneNumber = match self.contacts.resolve(recipient) {
            Ok(recipient) => recipient,
            Err(error) => return vec![invalid_recipient(request_id, error)],
        };
        if !body.is_empty()
            && let Err(error) = validate_body(&body)
        {
            return vec![invalid_message(request_id, &error)];
        }
        self.session.set_draft(recipient, body);
        vec![EngineEvent::Operation {
            request_id,
            operation: OperationKind::SetDraft,
            ok: true,
        }]
    }

    fn add_contact(&mut self, request_id: String, alias: &str, number: &str) -> Vec<EngineEvent> {
        let Some(path) = self.contacts_path.as_deref() else {
            return vec![EngineEvent::Error {
                request_id,
                code: "contact_persistence_unavailable".into(),
                message: "contact persistence is unavailable in this engine session".into(),
            }];
        };
        let updated = match ContactsConfig::add_persisted(path, alias, number) {
            Ok(updated) => updated,
            Err(
                error @ (ContactsError::InvalidAlias
                | ContactsError::AmbiguousAlias
                | ContactsError::DuplicateAlias(_)
                | ContactsError::InvalidNumber { .. }),
            ) => {
                return vec![EngineEvent::Error {
                    request_id,
                    code: "invalid_contact".into(),
                    message: error.to_string(),
                }];
            }
            Err(_) => {
                return vec![EngineEvent::Error {
                    request_id,
                    code: "contact_save_failed".into(),
                    message: "could not save the contact configuration".into(),
                }];
            }
        };
        self.contacts = updated;
        vec![
            self.snapshot_event(),
            EngineEvent::Operation {
                request_id,
                operation: OperationKind::AddContact,
                ok: true,
            },
        ]
    }

    fn schedule_reconnect(&mut self, attempt: usize) {
        let Some(delay) = RECONNECT_DELAYS.get(attempt).copied() else {
            self.reconnect = ReconnectState::Idle;
            self.connection = ConnectionState::Failed;
            return;
        };
        self.reconnect = ReconnectState::Scheduled {
            attempt,
            due: Instant::now() + delay,
        };
    }

    fn snapshot_event(&self) -> EngineEvent {
        EngineEvent::Snapshot {
            snapshot: self.snapshot(),
        }
    }

    async fn connect_phone(&mut self) -> Result<PhoneCapabilities, PhoneError> {
        timeout(PHONE_CONNECT_TIMEOUT, self.phone.connect())
            .await
            .unwrap_or(Err(PhoneError::Timeout))
    }

    async fn send_phone(&mut self, recipient: &PhoneNumber, body: &str) -> Result<(), PhoneError> {
        timeout(PHONE_SEND_TIMEOUT, self.phone.send(recipient, body))
            .await
            .unwrap_or(Err(PhoneError::TransferOutcomeUnknown))
    }

    async fn close_phone(&mut self) -> Result<(), PhoneError> {
        timeout(PHONE_CLOSE_TIMEOUT, self.phone.close())
            .await
            .unwrap_or(Err(PhoneError::Timeout))
    }
}

fn invalid_message(request_id: String, error: &BMessageError) -> EngineEvent {
    EngineEvent::Error {
        request_id,
        code: match error {
            BMessageError::Empty => "empty_message",
            BMessageError::TooLarge => "message_too_large",
            _ => "invalid_message",
        }
        .into(),
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::phone::{PhoneCapabilities, PhoneError};
    use crate::protocol::EngineCommand;
    use std::collections::VecDeque;
    use std::fs;

    fn temporary_contacts_path(label: &str) -> PathBuf {
        let mut random = [0_u8; 8];
        getrandom::fill(&mut random).expect("system randomness");
        std::env::temp_dir()
            .join(format!(
                "blupost-engine-{label}-{:016x}",
                u64::from_ne_bytes(random)
            ))
            .join("config.toml")
    }

    #[derive(Default)]
    struct FakePhone {
        connected: bool,
        connect_failures_remaining: usize,
        fail_send: bool,
        unknown_send: bool,
        events: VecDeque<PhoneEvent>,
    }

    impl PhonePort for FakePhone {
        async fn connect(&mut self) -> Result<PhoneCapabilities, PhoneError> {
            if self.connect_failures_remaining > 0 {
                self.connect_failures_remaining -= 1;
                return Err(PhoneError::Map("fixture connect failure".into()));
            }
            self.connected = true;
            Ok(PhoneCapabilities {
                name: "Test iPhone".into(),
                message_type: "SMS_GSM".into(),
            })
        }

        async fn send(&mut self, _recipient: &PhoneNumber, _body: &str) -> Result<(), PhoneError> {
            if self.unknown_send {
                Err(PhoneError::TransferOutcomeUnknown)
            } else if self.fail_send {
                Err(PhoneError::Map("fixture failure".into()))
            } else {
                Ok(())
            }
        }

        async fn next_event(&mut self) -> Result<PhoneEvent, PhoneError> {
            self.events.pop_front().ok_or(PhoneError::Timeout)
        }

        async fn close(&mut self) -> Result<(), PhoneError> {
            self.connected = false;
            Ok(())
        }
    }

    #[tokio::test]
    async fn sends_once_and_exposes_truthful_state() {
        let mut engine = BlupostEngine::new(FakePhone::default());
        engine
            .handle(EngineCommand::Connect {
                request_id: "connect".into(),
            })
            .await;
        let events = engine
            .handle(EngineCommand::Send {
                request_id: "send".into(),
                recipient: "2025550101".into(),
                body: "hello".into(),
            })
            .await;
        assert!(matches!(events[0], EngineEvent::Snapshot { .. }));
        assert!(matches!(events[1], EngineEvent::Snapshot { .. }));
        assert!(matches!(events[2], EngineEvent::Operation { ok: true, .. }));
        assert_eq!(engine.snapshot().session.total_messages, 1);
        assert_eq!(
            engine.snapshot().session.threads[0].messages[0].state,
            crate::session::MessageState::Sent
        );
    }

    #[tokio::test]
    async fn turns_a_live_phone_event_into_a_thread_snapshot() {
        let sender = PhoneNumber::parse("2025550101").expect("number");
        let phone = FakePhone {
            events: VecDeque::from([PhoneEvent::Incoming {
                sender: sender.clone(),
                body: "fixture reply".into(),
            }]),
            ..FakePhone::default()
        };
        let mut engine = BlupostEngine::new(phone);
        engine.next_phone_event().await;
        let snapshot = engine.snapshot();
        assert_eq!(snapshot.session.threads[0].participant, sender);
        assert_eq!(
            snapshot.session.threads[0].messages[0].body,
            "fixture reply"
        );
    }

    #[tokio::test]
    async fn preserves_an_unknown_send_outcome_without_calling_it_failed() {
        let mut engine = BlupostEngine::new(FakePhone {
            unknown_send: true,
            ..FakePhone::default()
        });
        engine
            .handle(EngineCommand::Connect {
                request_id: "connect".into(),
            })
            .await;

        let events = engine
            .handle(EngineCommand::Send {
                request_id: "send".into(),
                recipient: "2025550101".into(),
                body: "fixture body".into(),
            })
            .await;

        assert_eq!(
            engine.snapshot().session.threads[0].messages[0].state,
            crate::session::MessageState::Unknown
        );
        assert!(matches!(
            &events[2],
            EngineEvent::Error { code, .. } if code == "send_outcome_unknown"
        ));
    }

    #[tokio::test]
    async fn surfaces_a_content_redacted_transport_failure_instead_of_send_failed() {
        let mut engine = BlupostEngine::new(FakePhone {
            fail_send: true,
            ..FakePhone::default()
        });
        engine
            .handle(EngineCommand::Connect {
                request_id: "connect".into(),
            })
            .await;

        let events = engine
            .handle(EngineCommand::Send {
                request_id: "send".into(),
                recipient: "2025550101".into(),
                body: "fixture body".into(),
            })
            .await;

        assert_eq!(
            engine.snapshot().session.threads[0].messages[0].state,
            crate::session::MessageState::Failed
        );
        assert!(matches!(
            &events[2],
            EngineEvent::Error { code, message, .. }
                if code == "send_transport_failed"
                    && message == "Bluetooth MAP: fixture failure"
        ));
    }

    #[tokio::test]
    async fn resolves_a_contact_alias_before_sending() {
        let mut contacts = ContactsConfig::default();
        contacts
            .add("alice", "2025550101")
            .expect("fixture contact");
        let mut engine = BlupostEngine::with_contacts(FakePhone::default(), contacts);
        engine
            .handle(EngineCommand::Connect {
                request_id: "connect".into(),
            })
            .await;
        engine
            .handle(EngineCommand::Send {
                request_id: "send".into(),
                recipient: "alice".into(),
                body: "hello".into(),
            })
            .await;
        assert_eq!(
            engine.snapshot().session.threads[0].participant.as_str(),
            "+12025550101"
        );
    }

    #[tokio::test]
    async fn adds_a_contact_to_the_snapshot_and_persistent_config() {
        let path = temporary_contacts_path("add-contact");
        let mut engine = BlupostEngine::with_persistent_contacts(
            FakePhone::default(),
            ContactsConfig::default(),
            path.clone(),
        );

        let events = engine
            .handle(EngineCommand::AddContact {
                request_id: "add-contact".into(),
                alias: "Fixture_Friend".into(),
                number: "2025550101".into(),
            })
            .await;

        assert!(matches!(events[0], EngineEvent::Snapshot { .. }));
        assert!(matches!(
            events[1],
            EngineEvent::Operation {
                operation: OperationKind::AddContact,
                ok: true,
                ..
            }
        ));
        assert_eq!(engine.snapshot().contacts[0].alias, "fixture_friend");
        let reloaded = ContactsConfig::load(&path).expect("reload saved contacts");
        assert_eq!(
            reloaded
                .resolve("fixture_friend")
                .expect("saved alias")
                .as_str(),
            "+12025550101"
        );

        fs::remove_dir_all(path.parent().expect("temporary parent"))
            .expect("remove temporary contacts directory");
    }

    #[tokio::test]
    async fn does_not_publish_a_contact_when_persistence_fails() {
        let path = temporary_contacts_path("failed-contact");
        let parent = path.parent().expect("temporary parent");
        fs::create_dir_all(parent).expect("create temporary parent");
        let blocker = parent.join("not-a-directory");
        fs::write(&blocker, b"fixture").expect("create blocking file");
        let mut engine = BlupostEngine::with_persistent_contacts(
            FakePhone::default(),
            ContactsConfig::default(),
            blocker.join("config.toml"),
        );

        let events = engine
            .handle(EngineCommand::AddContact {
                request_id: "add-contact".into(),
                alias: "fixture_friend".into(),
                number: "2025550101".into(),
            })
            .await;

        assert!(engine.snapshot().contacts.is_empty());
        assert!(matches!(
            &events[0],
            EngineEvent::Error { code, .. } if code == "contact_save_failed"
        ));

        fs::remove_dir_all(parent).expect("remove temporary contacts directory");
    }

    #[tokio::test]
    async fn contact_addition_merges_configuration_changed_after_engine_start() {
        let path = temporary_contacts_path("merge-contact");
        let mut engine = BlupostEngine::with_persistent_contacts(
            FakePhone::default(),
            ContactsConfig::default(),
            path.clone(),
        );
        ContactsConfig::add_persisted(&path, "external", "2025550101")
            .expect("persist external contact");

        engine
            .handle(EngineCommand::AddContact {
                request_id: "add-contact".into(),
                alias: "local".into(),
                number: "2025550102".into(),
            })
            .await;

        let aliases = engine
            .snapshot()
            .contacts
            .into_iter()
            .map(|contact| contact.alias)
            .collect::<Vec<_>>();
        assert_eq!(aliases, ["external", "local"]);
        assert_eq!(
            ContactsConfig::load(&path).expect("reload").entries().len(),
            2
        );

        fs::remove_dir_all(path.parent().expect("temporary parent"))
            .expect("remove temporary contacts directory");
    }

    #[tokio::test]
    async fn disconnect_schedules_only_three_bounded_reconnect_attempts() {
        let phone = FakePhone {
            connect_failures_remaining: RECONNECT_DELAYS.len(),
            events: VecDeque::from([PhoneEvent::Disconnected]),
            ..FakePhone::default()
        };
        let mut engine = BlupostEngine::new(phone);
        engine.connection = ConnectionState::Connected {
            phone_name: "Test iPhone".into(),
            message_type: "SMS_GSM".into(),
        };
        engine.next_phone_event().await;
        assert!(engine.reconnect_deadline().is_some());

        for attempt in 0..RECONNECT_DELAYS.len() {
            assert!(engine.begin_scheduled_reconnect().is_some());
            let events = engine.finish_scheduled_reconnect().await;
            assert!(matches!(events[0], EngineEvent::Snapshot { .. }));
            if attempt + 1 < RECONNECT_DELAYS.len() {
                assert!(engine.reconnect_deadline().is_some());
            } else {
                assert!(engine.reconnect_deadline().is_none());
                assert!(matches!(engine.connection, ConnectionState::Failed));
            }
        }
    }
}
