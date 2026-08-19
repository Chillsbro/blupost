use crate::session::PhoneNumber;
use thiserror::Error;

const MESSAGE_CONTAINER_BYTES: usize = 22;
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024;
pub const MAX_BMESSAGE_BYTES: usize = 128 * 1024;

#[derive(Clone, Eq, PartialEq)]
pub struct IncomingBMessage {
    pub sender: PhoneNumber,
    pub body: String,
}

impl std::fmt::Debug for IncomingBMessage {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("IncomingBMessage")
            .field("sender", &self.sender)
            .field("body", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum BMessageError {
    #[error("message body is empty")]
    Empty,
    #[error("message body exceeds {MAX_MESSAGE_BYTES} bytes")]
    TooLarge,
    #[error("bMessage container exceeds {MAX_BMESSAGE_BYTES} bytes")]
    ContainerTooLarge,
    #[error("bMessage is not valid UTF-8")]
    InvalidUtf8,
    #[error("bMessage is missing {0}")]
    Missing(&'static str),
    #[error("bMessage sender is invalid")]
    InvalidSender,
}

pub fn encode_outgoing(recipient: &PhoneNumber, body: &str) -> Result<Vec<u8>, BMessageError> {
    let escaped = normalized_body(body)?;
    let body_length = escaped.len() + MESSAGE_CONTAINER_BYTES;
    let message = format!(
        concat!(
            "BEGIN:BMSG\r\n",
            "VERSION:1.0\r\n",
            "STATUS:UNREAD\r\n",
            "TYPE:SMS_GSM\r\n",
            "FOLDER:telecom/msg/outbox\r\n",
            "BEGIN:BENV\r\n",
            "BEGIN:VCARD\r\n",
            "VERSION:2.1\r\n",
            "N:\r\n",
            "TEL:{}\r\n",
            "END:VCARD\r\n",
            "BEGIN:BBODY\r\n",
            "CHARSET:UTF-8\r\n",
            "LENGTH:{}\r\n",
            "BEGIN:MSG\r\n",
            "{}\r\n",
            "END:MSG\r\n",
            "END:BBODY\r\n",
            "END:BENV\r\n",
            "END:BMSG\r\n"
        ),
        recipient.as_str(),
        body_length,
        escaped
    );
    Ok(message.into_bytes())
}

pub fn validate_body(body: &str) -> Result<(), BMessageError> {
    normalized_body(body).map(|_| ())
}

fn normalized_body(body: &str) -> Result<String, BMessageError> {
    let escaped = normalize_and_escape_body(body);
    if escaped.trim().is_empty() {
        return Err(BMessageError::Empty);
    }
    if escaped.len() > MAX_MESSAGE_BYTES {
        return Err(BMessageError::TooLarge);
    }
    Ok(escaped)
}

pub fn parse_incoming(bytes: &[u8]) -> Result<IncomingBMessage, BMessageError> {
    if bytes.len() > MAX_BMESSAGE_BYTES {
        return Err(BMessageError::ContainerTooLarge);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| BMessageError::InvalidUtf8)?;
    let envelope_index = text
        .find("BEGIN:BENV")
        .ok_or(BMessageError::Missing("envelope"))?;
    let originator = &text[..envelope_index];
    let sender_line = originator
        .lines()
        .find(|line| line.starts_with("TEL"))
        .ok_or(BMessageError::Missing("sender"))?;
    let (_, sender_value) = sender_line
        .split_once(':')
        .ok_or(BMessageError::InvalidSender)?;
    let sender =
        PhoneNumber::parse(sender_value.trim()).map_err(|_| BMessageError::InvalidSender)?;

    let start = text
        .find("BEGIN:MSG\r\n")
        .ok_or(BMessageError::Missing("message body"))?
        + "BEGIN:MSG\r\n".len();
    let rest = &text[start..];
    let end = rest
        .rfind("\r\nEND:MSG")
        .ok_or(BMessageError::Missing("message end"))?;
    let body = rest[..end]
        .replace("/END:MSG", "END:MSG")
        .replace("\r\n", "\n");
    if body.len() > MAX_MESSAGE_BYTES {
        return Err(BMessageError::TooLarge);
    }

    Ok(IncomingBMessage { sender, body })
}

fn normalize_and_escape_body(body: &str) -> String {
    body.replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace("END:MSG", "/END:MSG")
        .replace('\n', "\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_a_standard_fixture_with_exact_length_and_crlf() {
        let recipient = PhoneNumber::parse("12025550101").expect("valid number");
        let body = "fixture outbound";
        let encoded = encode_outgoing(&recipient, body).expect("valid bMessage");
        let text = String::from_utf8(encoded).expect("UTF-8 bMessage");
        assert!(text.contains("TEL:+12025550101\r\n"));
        assert!(text.contains(&format!("LENGTH:{}\r\n", body.len() + 22)));
        assert!(!text.replace("\r\n", "").contains('\n'));
    }

    #[test]
    fn escapes_a_message_terminator_and_normalizes_newlines() {
        let recipient = PhoneNumber::parse("12025550101").expect("valid number");
        let text = String::from_utf8(
            encode_outgoing(&recipient, "line one\nEND:MSG").expect("valid bMessage"),
        )
        .expect("UTF-8");
        assert!(text.contains("line one\r\n/END:MSG\r\nEND:MSG"));
    }

    #[test]
    fn parses_an_incoming_reply_without_logging_the_body() {
        let fixture = concat!(
            "BEGIN:BMSG\r\n",
            "VERSION:1.0\r\n",
            "STATUS:UNREAD\r\n",
            "TYPE:SMS_GSM\r\n",
            "FOLDER:telecom/msg/inbox\r\n",
            "BEGIN:VCARD\r\n",
            "VERSION:3.0\r\n",
            "N:Friend\r\n",
            "TEL:+12025550101\r\n",
            "END:VCARD\r\n",
            "BEGIN:BENV\r\n",
            "BEGIN:BBODY\r\n",
            "CHARSET:UTF-8\r\n",
            "LENGTH:35\r\n",
            "BEGIN:MSG\r\n",
            "fixture reply\r\n",
            "END:MSG\r\n",
            "END:BBODY\r\n",
            "END:BENV\r\n",
            "END:BMSG\r\n"
        );
        let parsed = parse_incoming(fixture.as_bytes()).expect("valid incoming bMessage");
        assert_eq!(parsed.sender.as_str(), "+12025550101");
        assert_eq!(parsed.body, "fixture reply");
        assert!(!format!("{parsed:?}").contains("fixture reply"));
    }

    #[test]
    fn rejects_an_oversized_incoming_container_before_parsing() {
        let fixture = vec![b'x'; MAX_BMESSAGE_BYTES + 1];
        assert_eq!(
            parse_incoming(&fixture),
            Err(BMessageError::ContainerTooLarge)
        );
    }
}
