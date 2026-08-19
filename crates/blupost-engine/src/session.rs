use std::collections::{BTreeMap, VecDeque};
use std::fmt;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MAX_SESSION_MESSAGES: usize = 500;

#[derive(Clone, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PhoneNumber(String);

impl PhoneNumber {
    pub fn parse(input: &str) -> Result<Self, PhoneNumberError> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Err(PhoneNumberError::Empty);
        }
        if trimmed.chars().enumerate().any(|(index, character)| {
            !(character.is_ascii_digit()
                || character.is_ascii_whitespace()
                || matches!(character, '-' | '(' | ')' | '.')
                || (index == 0 && character == '+'))
        }) {
            return Err(PhoneNumberError::InvalidCharacters);
        }

        let explicit_international = trimmed.starts_with('+');
        let digits: String = trimmed.chars().filter(char::is_ascii_digit).collect();
        let normalized = if explicit_international {
            digits
        } else if digits.len() == 10 {
            format!("1{digits}")
        } else if digits.len() == 11 && digits.starts_with('1') {
            digits
        } else {
            return Err(PhoneNumberError::InternationalPrefixRequired);
        };

        if !(8..=15).contains(&normalized.len()) {
            return Err(PhoneNumberError::InvalidLength);
        }

        Ok(Self(format!("+{normalized}")))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn redacted(&self) -> String {
        let suffix_start = self.0.len().saturating_sub(4);
        format!("••••{}", &self.0[suffix_start..])
    }
}

impl fmt::Debug for PhoneNumber {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("PhoneNumber")
            .field(&self.redacted())
            .finish()
    }
}

impl fmt::Display for PhoneNumber {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum PhoneNumberError {
    #[error("phone number is empty")]
    Empty,
    #[error("phone number contains unsupported characters")]
    InvalidCharacters,
    #[error("use a +country-code number, a US 10-digit number, or a US 11-digit number")]
    InternationalPrefixRequired,
    #[error("phone number must contain between 8 and 15 digits")]
    InvalidLength,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageDirection {
    Incoming,
    Outgoing,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageState {
    Received,
    Sending,
    Sent,
    Failed,
    Unknown,
}

#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct SessionMessage {
    pub id: u64,
    pub participant: PhoneNumber,
    pub body: String,
    pub direction: MessageDirection,
    pub state: MessageState,
    pub unread: bool,
}

impl fmt::Debug for SessionMessage {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SessionMessage")
            .field("id", &self.id)
            .field("participant", &self.participant)
            .field("body", &"<redacted>")
            .field("direction", &self.direction)
            .field("state", &self.state)
            .field("unread", &self.unread)
            .finish()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ThreadSnapshot {
    pub participant: PhoneNumber,
    pub unread: usize,
    pub draft: String,
    pub messages: Vec<SessionMessage>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub active_thread: Option<PhoneNumber>,
    pub total_messages: usize,
    pub threads: Vec<ThreadSnapshot>,
}

#[derive(Debug, Default)]
pub struct SessionThreads {
    active_thread: Option<PhoneNumber>,
    messages: VecDeque<SessionMessage>,
    drafts: BTreeMap<PhoneNumber, String>,
    next_id: u64,
}

impl SessionThreads {
    pub fn set_active_thread(&mut self, participant: &PhoneNumber) {
        self.active_thread = Some(participant.clone());
        for message in &mut self.messages {
            if &message.participant == participant {
                message.unread = false;
            }
        }
    }

    pub fn receive(&mut self, participant: PhoneNumber, body: String) -> u64 {
        let unread = self.active_thread.as_ref() != Some(&participant);
        self.push(
            participant,
            body,
            MessageDirection::Incoming,
            MessageState::Received,
            unread,
        )
    }

    pub fn submit_outgoing(&mut self, participant: PhoneNumber, body: String) -> u64 {
        self.drafts.remove(&participant);
        self.push(
            participant,
            body,
            MessageDirection::Outgoing,
            MessageState::Sending,
            false,
        )
    }

    pub fn set_draft(&mut self, participant: PhoneNumber, body: String) {
        if body.is_empty() {
            self.drafts.remove(&participant);
        } else {
            self.drafts.insert(participant, body);
        }
    }

    pub fn mark_sent(&mut self, id: u64) -> bool {
        self.set_state(id, MessageState::Sent)
    }

    pub fn mark_failed(&mut self, id: u64) -> bool {
        self.set_state(id, MessageState::Failed)
    }

    pub fn mark_unknown(&mut self, id: u64) -> bool {
        self.set_state(id, MessageState::Unknown)
    }

    #[must_use]
    pub fn snapshot(&self) -> SessionSnapshot {
        let mut grouped: BTreeMap<PhoneNumber, Vec<SessionMessage>> = BTreeMap::new();
        for message in &self.messages {
            grouped
                .entry(message.participant.clone())
                .or_default()
                .push(message.clone());
        }
        if let Some(active) = &self.active_thread {
            grouped.entry(active.clone()).or_default();
        }
        for participant in self.drafts.keys() {
            grouped.entry(participant.clone()).or_default();
        }

        let mut threads: Vec<_> = grouped
            .into_iter()
            .map(|(participant, messages)| ThreadSnapshot {
                unread: messages.iter().filter(|message| message.unread).count(),
                draft: self.drafts.get(&participant).cloned().unwrap_or_default(),
                participant,
                messages,
            })
            .collect();
        threads.sort_by(|left, right| {
            let left_id = left.messages.last().map_or(0, |message| message.id);
            let right_id = right.messages.last().map_or(0, |message| message.id);
            right_id
                .cmp(&left_id)
                .then_with(|| left.participant.cmp(&right.participant))
        });

        SessionSnapshot {
            active_thread: self.active_thread.clone(),
            total_messages: self.messages.len(),
            threads,
        }
    }

    fn push(
        &mut self,
        participant: PhoneNumber,
        body: String,
        direction: MessageDirection,
        state: MessageState,
        unread: bool,
    ) -> u64 {
        self.next_id = self.next_id.saturating_add(1);
        let id = self.next_id;
        if self.messages.len() == MAX_SESSION_MESSAGES {
            self.messages.pop_front();
        }
        self.messages.push_back(SessionMessage {
            id,
            participant,
            body,
            direction,
            state,
            unread,
        });
        id
    }

    fn set_state(&mut self, id: u64, state: MessageState) -> bool {
        let Some(message) = self.messages.iter_mut().find(|message| message.id == id) else {
            return false;
        };
        message.state = state;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn number(value: &str) -> PhoneNumber {
        PhoneNumber::parse(value).expect("valid fixture number")
    }

    #[test]
    fn normalizes_us_and_international_numbers() {
        assert_eq!(number("(202) 555-0101").as_str(), "+12025550101");
        assert_eq!(number("1-202-555-0102").as_str(), "+12025550102");
        assert_eq!(number("+44 20 7946 0958").as_str(), "+442079460958");
    }

    #[test]
    fn rejects_ambiguous_international_numbers() {
        assert_eq!(
            PhoneNumber::parse("442079460958"),
            Err(PhoneNumberError::InternationalPrefixRequired)
        );
    }

    #[test]
    fn rejects_letters_and_repeated_international_prefixes() {
        assert_eq!(
            PhoneNumber::parse("call 2025550101"),
            Err(PhoneNumberError::InvalidCharacters)
        );
        assert_eq!(
            PhoneNumber::parse("++442079460958"),
            Err(PhoneNumberError::InvalidCharacters)
        );
    }

    #[test]
    fn groups_messages_and_clears_unread_when_thread_activates() {
        let mut session = SessionThreads::default();
        let alice = number("2025550101");
        let bob = number("2025550102");
        session.set_active_thread(&alice);
        session.receive(alice.clone(), "visible".into());
        session.receive(bob.clone(), "unread".into());

        let before = session.snapshot();
        assert_eq!(before.total_messages, 2);
        assert_eq!(before.threads[0].participant, bob);
        assert_eq!(before.threads[0].unread, 1);

        session.set_active_thread(&before.threads[0].participant);
        assert_eq!(session.snapshot().threads[0].unread, 0);
    }

    #[test]
    fn caps_messages_globally_across_threads() {
        let mut session = SessionThreads::default();
        for index in 0..(MAX_SESSION_MESSAGES + 3) {
            let participant = if index % 2 == 0 {
                number("2025550101")
            } else {
                number("2025550102")
            };
            session.receive(participant, format!("message {index}"));
        }

        let snapshot = session.snapshot();
        assert_eq!(snapshot.total_messages, MAX_SESSION_MESSAGES);
        assert!(
            snapshot
                .threads
                .iter()
                .all(|thread| { thread.messages.iter().all(|message| message.id > 3) })
        );
    }

    #[test]
    fn tracks_truthful_outgoing_lifecycle() {
        let mut session = SessionThreads::default();
        let participant = number("2025550101");
        session.set_draft(participant.clone(), "draft".into());
        let id = session.submit_outgoing(participant, "hello".into());
        assert_eq!(
            session.snapshot().threads[0].messages[0].state,
            MessageState::Sending
        );
        assert!(session.snapshot().threads[0].draft.is_empty());
        assert!(session.mark_failed(id));
        assert_eq!(
            session.snapshot().threads[0].messages[0].state,
            MessageState::Failed
        );
        assert!(session.mark_unknown(id));
        assert_eq!(
            session.snapshot().threads[0].messages[0].state,
            MessageState::Unknown
        );
        assert!(!session.mark_sent(id + 1));
    }

    #[test]
    fn keeps_drafts_scoped_to_their_normalized_thread() {
        let mut session = SessionThreads::default();
        let alice = number("2025550101");
        let bob = number("2025550102");
        session.set_draft(alice.clone(), "alice draft".into());
        session.set_draft(bob.clone(), "bob draft".into());

        let snapshot = session.snapshot();
        assert_eq!(snapshot.threads.len(), 2);
        assert_eq!(
            snapshot
                .threads
                .iter()
                .find(|thread| thread.participant == alice)
                .map(|thread| thread.draft.as_str()),
            Some("alice draft")
        );

        session.set_draft(bob.clone(), String::new());
        assert!(
            session
                .snapshot()
                .threads
                .iter()
                .all(|thread| thread.participant != bob)
        );
    }
}
