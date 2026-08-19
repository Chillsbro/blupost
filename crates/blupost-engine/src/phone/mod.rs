pub mod bluez;
pub mod bmessage;

use crate::session::PhoneNumber;
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PhoneCapabilities {
    pub name: String,
    pub message_type: String,
}

#[derive(Clone, Eq, PartialEq)]
pub enum PhoneEvent {
    Incoming { sender: PhoneNumber, body: String },
    IncomingSkipped,
    Disconnected,
}

impl std::fmt::Debug for PhoneEvent {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Incoming { sender, .. } => formatter
                .debug_struct("Incoming")
                .field("sender", sender)
                .field("body", &"<redacted>")
                .finish(),
            Self::IncomingSkipped => formatter.write_str("IncomingSkipped"),
            Self::Disconnected => formatter.write_str("Disconnected"),
        }
    }
}

#[derive(Debug, Error)]
pub enum PhoneError {
    #[error("no paired iPhone advertising Bluetooth MAP was found")]
    NoMapPhone,
    #[error("multiple paired MAP phones were found; connect only the intended iPhone")]
    MultipleMapPhones,
    #[error("the iPhone is paired but not connected")]
    NotConnected,
    #[error("Bluetooth MAP: {0}")]
    Map(String),
    #[error("a Bluetooth transfer timed out")]
    Timeout,
    #[error("the Bluetooth transfer outcome is unknown; check the phone before trying again")]
    TransferOutcomeUnknown,
    #[error("the incoming bMessage was invalid: {0}")]
    InvalidMessage(String),
    #[error("temporary message storage failed: {0}")]
    TemporaryStorage(String),
    #[error("the BlueZ D-Bus operation failed: {0}")]
    Dbus(String),
}

pub trait PhonePort: Send {
    fn connect(
        &mut self,
    ) -> impl std::future::Future<Output = Result<PhoneCapabilities, PhoneError>> + Send;
    fn send(
        &mut self,
        recipient: &PhoneNumber,
        body: &str,
    ) -> impl std::future::Future<Output = Result<(), PhoneError>> + Send;
    fn next_event(
        &mut self,
    ) -> impl std::future::Future<Output = Result<PhoneEvent, PhoneError>> + Send;
    fn close(&mut self) -> impl std::future::Future<Output = Result<(), PhoneError>> + Send;
}
