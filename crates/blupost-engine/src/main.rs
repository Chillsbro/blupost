use std::fmt::Write as _;
use std::process::ExitCode;

use blupost_engine::contacts::ContactsConfig;
use blupost_engine::engine::BlupostEngine;
use blupost_engine::phone::bluez::BluezPhone;
use blupost_engine::phone::bmessage::validate_body;
use blupost_engine::protocol::{ConnectionState, EngineCommand, EngineEvent, OperationKind};
use blupost_engine::runtime::{EngineRuntime, EngineRuntimeError};
use blupost_engine::session::{MessageDirection, PhoneNumber};
use clap::{Parser, Subcommand};
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};

const WATCH_RUNTIME_BUFFER_BYTES: usize = 64 * 1024;
const MAX_STDIN_SEND_BYTES: usize = 128 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StdinSend {
    recipient: String,
    body: String,
}

#[derive(Debug, Parser)]
#[command(
    name = "blupost-engine",
    version,
    about = "Blupost Rust phone/session engine"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Inspect Bluetooth and MAP without sending or changing phone state.
    Doctor {
        /// Emit one machine-readable JSON object.
        #[arg(long)]
        json: bool,
    },
    /// Send one explicit message and exit; failed sends are never retried.
    Send {
        /// Contact alias or explicit phone number.
        recipient: String,
        /// Message text. Quote it to preserve intentional whitespace.
        #[arg(required = true, num_args = 1..)]
        message: Vec<String>,
    },
    /// Accept one explicit recipient and message on private stdin from the Bun launcher.
    #[command(hide = true)]
    SendStdin,
    /// Print new incoming messages until interrupted.
    Watch {
        /// Use a stable tab-delimited stream.
        #[arg(long)]
        plain: bool,
    },
    /// Manage persistent local contacts.
    Contacts {
        #[command(subcommand)]
        command: ContactsCommand,
    },
    /// Serve the versioned JSON-lines engine protocol on stdin/stdout.
    #[command(hide = true)]
    Serve,
}

#[derive(Debug, Subcommand)]
enum ContactsCommand {
    /// List aliases and normalized numbers.
    List,
    /// Add a new alias.
    Add { alias: String, number: String },
    /// Change an existing alias.
    Update { alias: String, number: String },
    /// Remove an alias.
    Remove { alias: String },
}

#[tokio::main]
async fn main() -> ExitCode {
    match run(Cli::parse()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("blupost-engine: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run(cli: Cli) -> Result<(), Box<dyn std::error::Error>> {
    match cli.command {
        Command::Doctor { json } => run_doctor(json).await,
        Command::Send { recipient, message } => run_send(&recipient, message.join(" ")).await,
        Command::SendStdin => {
            let mut bytes = Vec::new();
            tokio::io::stdin()
                .take((MAX_STDIN_SEND_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .await?;
            if bytes.len() > MAX_STDIN_SEND_BYTES {
                return Err("private send request exceeds the safe input limit".into());
            }
            let send: StdinSend =
                serde_json::from_slice(&bytes).map_err(|_| "private send request is not valid")?;
            run_send(&send.recipient, send.body).await
        }
        Command::Watch { plain } => run_watch(plain).await,
        Command::Contacts { command } => run_contacts(command),
        Command::Serve => run_serve().await,
    }
}

async fn run_doctor(json: bool) -> Result<(), Box<dyn std::error::Error>> {
    let report = BluezPhone::doctor().await;
    if json {
        println!("{}", serde_json::to_string(&report)?);
    } else {
        println!("Blupost doctor");
        println!(
            "  Bluetooth adapter: {}",
            if report.host.bluetooth_adapter {
                "ready"
            } else {
                "missing"
            }
        );
        println!(
            "  BlueZ OBEX: {}",
            if report.host.obex_service {
                "ready"
            } else {
                "missing"
            }
        );
        println!(
            "  Paired MAP phone: {}",
            if report.phone.is_some() {
                "found"
            } else {
                "not found"
            }
        );
        println!(
            "  Phone connection: {}",
            if report.phone.as_ref().is_some_and(|phone| phone.connected) {
                "connected"
            } else {
                "disconnected"
            }
        );
        for issue in &report.issues {
            eprintln!("  ! {issue}");
        }
    }
    if report.ok {
        Ok(())
    } else {
        Err("doctor checks failed".into())
    }
}

async fn run_serve() -> Result<(), Box<dyn std::error::Error>> {
    let contacts_path = ContactsConfig::default_path()?;
    let contacts = ContactsConfig::load(&contacts_path)?;
    EngineRuntime::with_persistent_contacts(BluezPhone::new(), contacts, contacts_path)
        .run(tokio::io::stdin(), tokio::io::stdout())
        .await?;
    Ok(())
}

async fn run_send(recipient: &str, message: String) -> Result<(), Box<dyn std::error::Error>> {
    let contacts = load_contacts()?;
    let recipient = validate_one_shot_send(&contacts, recipient, &message)?;
    let mut engine = BlupostEngine::with_contacts(BluezPhone::new(), contacts);
    let connected = engine
        .handle(EngineCommand::Connect {
            request_id: "connect".into(),
        })
        .await;
    if connected
        .iter()
        .any(|event| matches!(event, EngineEvent::Error { .. }))
    {
        return Err("could not connect to the paired iPhone; run `blupost doctor`".into());
    }
    let sent = engine
        .handle(EngineCommand::Send {
            request_id: "send".into(),
            recipient: recipient.as_str().into(),
            body: message,
        })
        .await;
    let success = sent.iter().any(|event| {
        matches!(
            event,
            EngineEvent::Operation {
                operation: OperationKind::Send,
                ok: true,
                ..
            }
        )
    });
    engine
        .handle(EngineCommand::Shutdown {
            request_id: "shutdown".into(),
        })
        .await;
    if !success {
        let reason = sent.iter().find_map(|event| match event {
            EngineEvent::Error { message, .. } => Some(message.as_str()),
            _ => None,
        });
        return Err(reason
            .unwrap_or("the iPhone did not accept the message")
            .into());
    }
    println!("Message sent once; no retry is queued.");
    Ok(())
}

fn validate_one_shot_send(
    contacts: &ContactsConfig,
    recipient: &str,
    message: &str,
) -> Result<PhoneNumber, Box<dyn std::error::Error>> {
    validate_body(message)?;
    Ok(contacts.resolve(recipient)?)
}

async fn run_watch(plain: bool) -> Result<(), Box<dyn std::error::Error>> {
    let contacts = load_contacts()?;
    let labels = contacts.clone();
    let (client, server) = tokio::io::duplex(WATCH_RUNTIME_BUFFER_BYTES);
    let (client_reader, mut client_writer) = tokio::io::split(client);
    let (server_reader, server_writer) = tokio::io::split(server);
    let runtime = tokio::spawn(
        EngineRuntime::new(BluezPhone::new(), contacts).run(server_reader, server_writer),
    );
    let mut lines = BufReader::new(client_reader).lines();

    write_runtime_command(
        &mut client_writer,
        &EngineCommand::Hello {
            request_id: "1".into(),
            version: blupost_engine::protocol::PROTOCOL_VERSION,
        },
    )
    .await?;
    write_runtime_command(
        &mut client_writer,
        &EngineCommand::Connect {
            request_id: "2".into(),
        },
    )
    .await?;

    let watch_result = observe_runtime(&mut lines, &labels, plain).await;
    let runtime_result = finish_watch_runtime(runtime, client_writer, &mut lines).await;
    watch_result?;
    runtime_result?;
    Ok(())
}

async fn finish_watch_runtime<R, W>(
    runtime: tokio::task::JoinHandle<Result<(), EngineRuntimeError>>,
    mut client_writer: W,
    lines: &mut tokio::io::Lines<R>,
) -> Result<(), Box<dyn std::error::Error>>
where
    R: tokio::io::AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
{
    if !runtime.is_finished() {
        let _ = write_runtime_command(
            &mut client_writer,
            &EngineCommand::Shutdown {
                request_id: "3".into(),
            },
        )
        .await;
    }
    drop(client_writer);
    while lines.next_line().await?.is_some() {}
    runtime.await??;
    Ok(())
}

async fn write_runtime_command(
    writer: &mut (impl AsyncWrite + Unpin),
    command: &EngineCommand,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut frame = serde_json::to_vec(command)?;
    frame.push(b'\n');
    writer.write_all(&frame).await?;
    writer.flush().await?;
    Ok(())
}

async fn observe_runtime<R: tokio::io::AsyncBufRead + Unpin>(
    lines: &mut tokio::io::Lines<R>,
    contacts: &ContactsConfig,
    plain: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut was_connected = false;
    let mut connected_once = false;
    let mut last_message_id = 0;

    loop {
        let event = tokio::select! {
            signal = tokio::signal::ctrl_c() => {
                signal?;
                return Ok(());
            }
            line = lines.next_line() => {
                let line = line?.ok_or("engine runtime stopped unexpectedly")?;
                serde_json::from_str::<EngineEvent>(&line)?
            }
        };

        match event {
            EngineEvent::Snapshot { snapshot } => {
                let is_connected = matches!(snapshot.connection, ConnectionState::Connected { .. });
                if let ConnectionState::Connected { phone_name, .. } = &snapshot.connection
                    && !was_connected
                {
                    let phone_name = escape_terminal_field(phone_name);
                    if plain {
                        println!("connected\t{phone_name}");
                    } else if connected_once {
                        println!("Reconnected to {phone_name}. Waiting for new messages…");
                    } else {
                        println!("Connected to {phone_name}. Waiting for new messages…");
                    }
                    connected_once = true;
                }
                if was_connected && !is_connected {
                    eprintln!("blupost-engine: phone connection lost; bounded recovery started");
                }
                if matches!(snapshot.connection, ConnectionState::Failed) {
                    return Err(if connected_once {
                        "automatic reconnect limit reached"
                    } else {
                        "could not connect to the paired iPhone; run `blupost doctor`"
                    }
                    .into());
                }
                was_connected = is_connected;

                let mut incoming = snapshot
                    .session
                    .threads
                    .iter()
                    .flat_map(|thread| &thread.messages)
                    .filter(|message| {
                        message.id > last_message_id
                            && message.direction == MessageDirection::Incoming
                    })
                    .collect::<Vec<_>>();
                incoming.sort_by_key(|message| message.id);
                for message in incoming {
                    let participant = contacts
                        .alias_for(&message.participant)
                        .unwrap_or_else(|| message.participant.as_str());
                    let participant = escape_terminal_field(participant);
                    let body = escape_terminal_field(&message.body);
                    if plain {
                        println!("incoming\t{participant}\t{body}");
                    } else {
                        println!("{participant}: {body}");
                    }
                    last_message_id = last_message_id.max(message.id);
                }
            }
            EngineEvent::Error { code, message, .. } => {
                if code == "connect_failed" && !connected_once {
                    return Err(
                        "could not connect to the paired iPhone; run `blupost doctor`".into(),
                    );
                }
                eprintln!("blupost-engine: {message}");
            }
            EngineEvent::Ready { .. } | EngineEvent::Operation { .. } => {}
        }
    }
}

fn run_contacts(command: ContactsCommand) -> Result<(), Box<dyn std::error::Error>> {
    let path = ContactsConfig::default_path()?;
    match command {
        ContactsCommand::List => {
            let contacts = ContactsConfig::load(&path)?;
            let entries = contacts.entries();
            if entries.is_empty() {
                println!("No contacts configured.");
            } else {
                for contact in entries {
                    println!("{}\t{}", contact.alias, contact.number);
                }
            }
            return Ok(());
        }
        ContactsCommand::Add { alias, number } => {
            ContactsConfig::add_persisted(&path, &alias, &number)?;
        }
        ContactsCommand::Update { alias, number } => {
            ContactsConfig::update_persisted(&path, &alias, &number)?;
        }
        ContactsCommand::Remove { alias } => {
            ContactsConfig::remove_persisted(&path, &alias)?;
        }
    }
    println!("Contacts updated.");
    Ok(())
}

fn load_contacts() -> Result<ContactsConfig, Box<dyn std::error::Error>> {
    Ok(ContactsConfig::load(&ContactsConfig::default_path()?)?)
}

fn escape_terminal_field(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '\t' => escaped.push_str("\\t"),
            '\r' => escaped.push_str("\\r"),
            '\n' => escaped.push_str("\\n"),
            character if character.is_control() => {
                write!(&mut escaped, "\\u{{{:04x}}}", u32::from(character))
                    .expect("writing to a String cannot fail");
            }
            character => escaped.push(character),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use tokio::time::{Duration, timeout};

    use super::*;

    async fn run_watch_shutdown_harness(output_bytes: usize) {
        let (client, server) = tokio::io::duplex(WATCH_RUNTIME_BUFFER_BYTES);
        let (client_reader, client_writer) = tokio::io::split(client);
        let mut lines = BufReader::new(client_reader).lines();
        let runtime = tokio::spawn(async move {
            let (server_reader, mut server_writer) = tokio::io::split(server);
            let command = BufReader::new(server_reader)
                .lines()
                .next_line()
                .await
                .map_err(EngineRuntimeError::Input)?
                .expect("shutdown command");
            assert!(command.contains("\"type\":\"shutdown\""));

            server_writer
                .write_all(&vec![b'x'; output_bytes])
                .await
                .map_err(EngineRuntimeError::Output)?;
            Ok(())
        });

        timeout(
            Duration::from_secs(1),
            finish_watch_runtime(runtime, client_writer, &mut lines),
        )
        .await
        .expect("watch shutdown must complete within its deterministic test deadline")
        .expect("watch shutdown succeeds");
    }

    #[test]
    fn watch_output_escapes_delimiters_and_terminal_controls() {
        assert_eq!(
            escape_terminal_field("one\ttwo\nthree\\four\u{1b}\u{7}"),
            "one\\ttwo\\nthree\\\\four\\u{001b}\\u{0007}"
        );
    }

    #[test]
    fn private_send_input_has_a_strict_recipient_and_body_schema() {
        let send: StdinSend =
            serde_json::from_slice(br#"{"recipient":"+12025550101","body":"fixture message"}"#)
                .expect("valid private send input");
        assert_eq!(send.recipient, "+12025550101");
        assert_eq!(send.body, "fixture message");
        assert!(
            serde_json::from_slice::<StdinSend>(
                br#"{"recipient":"+12025550101","body":"fixture","extra":true}"#
            )
            .is_err()
        );
    }

    #[test]
    fn one_shot_send_rejects_an_empty_body_during_local_validation() {
        let error = validate_one_shot_send(&ContactsConfig::default(), "+12025550101", "  \n\t ")
            .expect_err("reject whitespace-only body");

        assert_eq!(error.to_string(), "message body is empty");
    }

    #[tokio::test]
    async fn watch_shutdown_handles_runtime_output_that_fits_the_duplex_buffer() {
        run_watch_shutdown_harness(1024).await;
    }

    #[tokio::test]
    async fn watch_shutdown_drains_runtime_output_larger_than_the_duplex_buffer() {
        run_watch_shutdown_harness(WATCH_RUNTIME_BUFFER_BYTES + 1).await;
    }
}
