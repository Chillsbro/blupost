//! Production `BlueZ` MAP adapter. Callers see normalized phone operations while this module hides
//! D-Bus object paths, OBEX transfers, and short-lived message files.

use std::collections::{HashMap, HashSet};
use std::fs::{self, DirBuilder, OpenOptions};
use std::io::Write;
#[cfg(test)]
use std::os::unix::fs::PermissionsExt;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use zbus::fdo::ObjectManagerProxy;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};
use zbus::{Connection, Proxy};

use super::bmessage::{MAX_BMESSAGE_BYTES, encode_outgoing, parse_incoming};
use super::{PhoneCapabilities, PhoneError, PhoneEvent, PhonePort};
use crate::session::PhoneNumber;

const BLUEZ_SERVICE: &str = "org.bluez";
const OBEX_SERVICE: &str = "org.bluez.obex";
const OBEX_ROOT: &str = "/org/bluez/obex";
const OBEX_SERVER_ROOT: &str = "/org/bluez/obex/server/";
const OBJECT_MANAGER_ROOT: &str = "/";
const DEVICE_INTERFACE: &str = "org.bluez.Device1";
const ADAPTER_INTERFACE: &str = "org.bluez.Adapter1";
const CLIENT_INTERFACE: &str = "org.bluez.obex.Client1";
const SESSION_INTERFACE: &str = "org.bluez.obex.Session1";
const MESSAGE_ACCESS_INTERFACE: &str = "org.bluez.obex.MessageAccess1";
const MESSAGE_INTERFACE: &str = "org.bluez.obex.Message1";
const TRANSFER_INTERFACE: &str = "org.bluez.obex.Transfer1";
const MAP_SERVICE_UUID: &str = "00001132-0000-1000-8000-00805f9b34fb";
const MAP_NOTIFICATION_SERVICE_UUID: &str = "BB582B41-420C-11DB-B0DE-0800200C9A66";
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(30);
const TRANSFER_CANCEL_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone)]
struct DiscoveredPhone {
    address: String,
    name: String,
    connected: bool,
}

impl std::fmt::Debug for DiscoveredPhone {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DiscoveredPhone")
            .field("address", &"<redacted>")
            .field("name", &"<redacted>")
            .field("connected", &self.connected)
            .finish()
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct BluezDoctorReport {
    pub ok: bool,
    pub host: BluezHostReport,
    pub phone: Option<DoctorPhone>,
    pub issues: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BluezHostReport {
    pub bluetooth_adapter: bool,
    pub obex_service: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct DoctorPhone {
    pub connected: bool,
}

struct TemporaryWorkspace {
    path: PathBuf,
}

struct TemporaryFile {
    path: PathBuf,
}

impl TemporaryFile {
    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

impl TemporaryWorkspace {
    fn create() -> Result<Self, PhoneError> {
        for root in private_runtime_roots() {
            if !root.is_dir() {
                continue;
            }
            for _ in 0..8 {
                let mut random = [0_u8; 8];
                getrandom::fill(&mut random)
                    .map_err(|error| PhoneError::TemporaryStorage(error.to_string()))?;
                let path = root.join(format!(
                    "blupost-{}-{:016x}",
                    std::process::id(),
                    u64::from_ne_bytes(random)
                ));
                match DirBuilder::new().mode(0o700).create(&path) {
                    Ok(()) => {
                        return Ok(Self { path });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(_) => break,
                }
            }
        }
        Err(PhoneError::TemporaryStorage(
            "could not allocate a unique private directory".into(),
        ))
    }

    fn write_outgoing(&self, bytes: &[u8]) -> Result<TemporaryFile, PhoneError> {
        let path = self.unique_path("outgoing", "bmsg")?;
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .map_err(storage_error)?;
        let temporary = TemporaryFile { path };
        file.write_all(bytes).map_err(storage_error)?;
        file.sync_all().map_err(storage_error)?;
        Ok(temporary)
    }

    fn unique_path(&self, prefix: &str, extension: &str) -> Result<PathBuf, PhoneError> {
        unique_path_in(&self.path, prefix, extension)
    }
}

impl Drop for TemporaryWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

struct ActiveMapSession {
    obex_connection: Connection,
    phone: DiscoveredPhone,
    path: OwnedObjectPath,
    listener: JoinHandle<()>,
    workspace: TemporaryWorkspace,
}

struct SetupListenerGuard(Option<JoinHandle<()>>);

impl SetupListenerGuard {
    fn new(listener: JoinHandle<()>) -> Self {
        Self(Some(listener))
    }

    fn release(mut self) -> JoinHandle<()> {
        self.0.take().expect("setup listener is present")
    }
}

impl Drop for SetupListenerGuard {
    fn drop(&mut self) {
        if let Some(listener) = self.0.take() {
            listener.abort();
        }
    }
}

impl ActiveMapSession {
    fn capabilities(&self) -> PhoneCapabilities {
        capabilities(&self.phone)
    }

    fn is_live(&self) -> bool {
        !self.listener.is_finished()
    }

    async fn push(&self, recipient: &PhoneNumber, body: &str) -> Result<(), PhoneError> {
        let encoded = encode_outgoing(recipient, body)
            .map_err(|error| PhoneError::InvalidMessage(error.to_string()))?;
        let source = self.workspace.write_outgoing(&encoded)?;
        push_message(&self.obex_connection, &self.path, source.path()).await
    }

    async fn close(self) -> Result<(), PhoneError> {
        let client = Proxy::new(
            &self.obex_connection,
            OBEX_SERVICE,
            OBEX_ROOT,
            CLIENT_INTERFACE,
        )
        .await
        .map_err(dbus_error)?;
        client
            .call::<_, _, ()>("RemoveSession", &self.path)
            .await
            .map_err(map_error)
    }
}

impl Drop for ActiveMapSession {
    fn drop(&mut self) {
        self.listener.abort();
    }
}

pub struct BluezPhone {
    active_session: Option<ActiveMapSession>,
    retired_sessions: Vec<ActiveMapSession>,
    event_sender: mpsc::Sender<Result<PhoneEvent, PhoneError>>,
    event_receiver: mpsc::Receiver<Result<PhoneEvent, PhoneError>>,
}

impl std::fmt::Debug for BluezPhone {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BluezPhone")
            .field(
                "phone",
                &self.active_session.as_ref().map(|session| &session.phone),
            )
            .field("connected", &self.active_session.is_some())
            .finish_non_exhaustive()
    }
}

impl Default for BluezPhone {
    fn default() -> Self {
        Self::new()
    }
}

impl BluezPhone {
    #[must_use]
    pub fn new() -> Self {
        let (event_sender, event_receiver) = mpsc::channel(32);
        Self {
            active_session: None,
            retired_sessions: Vec::new(),
            event_sender,
            event_receiver,
        }
    }

    pub async fn doctor() -> BluezDoctorReport {
        let mut report = BluezDoctorReport {
            ok: false,
            host: BluezHostReport {
                bluetooth_adapter: false,
                obex_service: false,
            },
            phone: None,
            issues: Vec::new(),
        };

        match Connection::system().await {
            Ok(connection) => match managed_objects(&connection, BLUEZ_SERVICE).await {
                Ok(objects) => {
                    report.host.bluetooth_adapter = objects.values().any(|interfaces| {
                        interfaces
                            .keys()
                            .any(|interface| interface.as_str() == ADAPTER_INTERFACE)
                    });
                    match select_map_phone(&objects) {
                        Ok(phone) => {
                            report.phone = Some(DoctorPhone {
                                connected: phone.connected,
                            });
                        }
                        Err(PhoneError::NoMapPhone) => report
                            .issues
                            .push("No paired iPhone advertising Bluetooth MAP was found.".into()),
                        Err(error) => report.issues.push(error.to_string()),
                    }
                }
                Err(error) => report.issues.push(error.to_string()),
            },
            Err(_) => report
                .issues
                .push("The system D-Bus or BlueZ service is unavailable.".into()),
        }

        match Connection::session().await {
            Ok(connection) => {
                report.host.obex_service = managed_objects(&connection, OBEX_SERVICE).await.is_ok();
                if !report.host.obex_service {
                    report
                        .issues
                        .push("The per-user BlueZ OBEX service is unavailable.".into());
                }
            }
            Err(_) => report
                .issues
                .push("The desktop-session D-Bus is unavailable.".into()),
        }

        if !report.host.bluetooth_adapter {
            report
                .issues
                .push("No BlueZ Bluetooth adapter was found.".into());
        }
        if report.phone.as_ref().is_some_and(|phone| !phone.connected) {
            report
                .issues
                .push("The paired MAP phone is not currently connected.".into());
        }
        report.ok = report.host.bluetooth_adapter
            && report.host.obex_service
            && report.phone.as_ref().is_some_and(|phone| phone.connected);
        report
    }

    async fn open(&mut self) -> Result<PhoneCapabilities, PhoneError> {
        if let Some(session) = &self.active_session
            && session.is_live()
        {
            return Ok(session.capabilities());
        }
        if self.active_session.is_some() {
            self.retire_active_session();
        }
        let _ = self.cleanup_retired_sessions().await;
        while self.event_receiver.try_recv().is_ok() {}

        let system_connection = Connection::system().await.map_err(dbus_error)?;
        let objects = managed_objects(&system_connection, BLUEZ_SERVICE).await?;
        let phone = select_map_phone(&objects)?;
        let obex_connection = Connection::session().await.map_err(dbus_error)?;
        let client = Proxy::new(&obex_connection, OBEX_SERVICE, OBEX_ROOT, CLIENT_INTERFACE)
            .await
            .map_err(dbus_error)?;
        let workspace = TemporaryWorkspace::create()?;
        let (session_sender, session_receiver) = oneshot::channel();
        let listener = SetupListenerGuard::new(
            start_incoming_listener(
                obex_connection.clone(),
                workspace.path.clone(),
                phone.address.clone(),
                session_receiver,
                self.event_sender.clone(),
            )
            .await?,
        );

        let options = HashMap::from([("Target", Value::from("map"))]);
        let session_path: OwnedObjectPath = match client
            .call("CreateSession", &(phone.address.as_str(), options))
            .await
        {
            Ok(path) => path,
            Err(error) => return Err(map_error(error)),
        };
        if session_sender.send(session_path.clone()).is_err() {
            let _ = client
                .call::<_, _, ()>("RemoveSession", &session_path)
                .await;
            return Err(PhoneError::Map(
                "incoming notification listener stopped during session setup".into(),
            ));
        }

        let session = ActiveMapSession {
            obex_connection,
            phone,
            path: session_path,
            listener: listener.release(),
            workspace,
        };
        let capabilities = session.capabilities();
        self.active_session = Some(session);
        Ok(capabilities)
    }

    async fn push(&mut self, recipient: &PhoneNumber, body: &str) -> Result<(), PhoneError> {
        self.active_session
            .as_ref()
            .ok_or(PhoneError::NotConnected)?
            .push(recipient, body)
            .await
    }

    async fn close_session(&mut self) -> Result<(), PhoneError> {
        self.retire_active_session();
        self.cleanup_retired_sessions().await
    }

    fn retire_active_session(&mut self) {
        if let Some(session) = self.active_session.take() {
            session.listener.abort();
            self.retired_sessions.push(session);
        }
    }

    async fn cleanup_retired_sessions(&mut self) -> Result<(), PhoneError> {
        let sessions = std::mem::take(&mut self.retired_sessions);
        let mut first_error = None;
        for session in sessions {
            if let Err(error) = session.close().await
                && first_error.is_none()
            {
                first_error = Some(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }
}

impl PhonePort for BluezPhone {
    async fn connect(&mut self) -> Result<PhoneCapabilities, PhoneError> {
        self.open().await
    }

    async fn send(&mut self, recipient: &PhoneNumber, body: &str) -> Result<(), PhoneError> {
        self.push(recipient, body).await
    }

    async fn next_event(&mut self) -> Result<PhoneEvent, PhoneError> {
        match self.event_receiver.recv().await {
            Some(Ok(event)) => {
                if event == PhoneEvent::Disconnected {
                    self.retire_active_session();
                }
                Ok(event)
            }
            Some(Err(error)) => {
                self.retire_active_session();
                Err(error)
            }
            None => {
                self.retire_active_session();
                Err(PhoneError::NotConnected)
            }
        }
    }

    async fn close(&mut self) -> Result<(), PhoneError> {
        self.close_session().await
    }
}

async fn managed_objects(
    connection: &Connection,
    destination: &str,
) -> Result<zbus::fdo::ManagedObjects, PhoneError> {
    ObjectManagerProxy::builder(connection)
        .destination(destination)
        .map_err(dbus_error)?
        .path(OBJECT_MANAGER_ROOT)
        .map_err(dbus_error)?
        .build()
        .await
        .map_err(dbus_error)?
        .get_managed_objects()
        .await
        .map_err(dbus_error)
}

fn select_map_phone(objects: &zbus::fdo::ManagedObjects) -> Result<DiscoveredPhone, PhoneError> {
    let mut phones = Vec::new();
    for interfaces in objects.values() {
        let Some(properties) = interfaces
            .iter()
            .find(|(interface, _)| interface.as_str() == DEVICE_INTERFACE)
            .map(|(_, properties)| properties)
        else {
            continue;
        };
        if property_bool(properties, "Paired") != Some(true) {
            continue;
        }
        let supports_map = properties
            .get("UUIDs")
            .and_then(|value| value.try_clone().ok())
            .and_then(|value| Vec::<String>::try_from(value).ok())
            .is_some_and(|uuids| {
                uuids
                    .iter()
                    .any(|uuid| uuid.eq_ignore_ascii_case(MAP_SERVICE_UUID))
            });
        if !supports_map {
            continue;
        }
        let Some(address) = property_string(properties, "Address") else {
            continue;
        };
        let name = property_string(properties, "Name")
            .or_else(|| property_string(properties, "Alias"))
            .unwrap_or_else(|| "iPhone".into());
        phones.push(DiscoveredPhone {
            address,
            name,
            connected: property_bool(properties, "Connected").unwrap_or(false),
        });
    }
    phones.sort_by_key(|phone| !phone.connected);
    match phones.len() {
        0 => Err(PhoneError::NoMapPhone),
        1 => Ok(phones.remove(0)),
        _ if phones[0].connected && !phones[1].connected => Ok(phones.remove(0)),
        _ => Err(PhoneError::MultipleMapPhones),
    }
}

fn property_bool(properties: &HashMap<String, OwnedValue>, name: &str) -> Option<bool> {
    properties
        .get(name)
        .and_then(|value| bool::try_from(value).ok())
}

fn property_string(properties: &HashMap<String, OwnedValue>, name: &str) -> Option<String> {
    properties
        .get(name)
        .and_then(|value| <&str>::try_from(value).ok())
        .map(ToOwned::to_owned)
}

fn capabilities(phone: &DiscoveredPhone) -> PhoneCapabilities {
    PhoneCapabilities {
        name: phone.name.clone(),
        message_type: "SMS_GSM".into(),
    }
}

async fn push_message(
    connection: &Connection,
    session_path: &OwnedObjectPath,
    source: &Path,
) -> Result<(), PhoneError> {
    let source = source
        .to_str()
        .ok_or_else(|| PhoneError::TemporaryStorage("temporary path is not UTF-8".into()))?;
    let access = Proxy::new(
        connection,
        OBEX_SERVICE,
        session_path.as_str(),
        MESSAGE_ACCESS_INTERFACE,
    )
    .await
    .map_err(dbus_error)?;
    let options = push_message_options();
    let (transfer, properties): (OwnedObjectPath, HashMap<String, OwnedValue>) = access
        .call("PushMessage", &(source, "telecom/msg/outbox", options))
        .await
        .map_err(map_error)?;
    wait_for_transfer(connection, &transfer, &properties).await
}

fn push_message_options() -> HashMap<&'static str, Value<'static>> {
    HashMap::from([
        ("Transparent", Value::from(false)),
        ("Retry", Value::from(false)),
        // BlueZ accepts "utf8" or "native" here. This is not a MIME charset name.
        ("Charset", Value::from("utf8")),
    ])
}

#[allow(
    clippy::too_many_lines,
    reason = "subscription setup and its paired signal loop share one ownership scope"
)]
async fn start_incoming_listener(
    connection: Connection,
    workspace: PathBuf,
    phone_address: String,
    client_session_receiver: oneshot::Receiver<OwnedObjectPath>,
    sender: mpsc::Sender<Result<PhoneEvent, PhoneError>>,
) -> Result<JoinHandle<()>, PhoneError> {
    let (ready_sender, ready_receiver) = oneshot::channel();
    let task = tokio::spawn(async move {
        let manager = match ObjectManagerProxy::builder(&connection)
            .destination(OBEX_SERVICE)
            .and_then(|builder| builder.path(OBJECT_MANAGER_ROOT))
        {
            Ok(builder) => match builder.build().await {
                Ok(manager) => manager,
                Err(error) => {
                    let _ = ready_sender.send(Err(dbus_error(error)));
                    return;
                }
            },
            Err(error) => {
                let _ = ready_sender.send(Err(dbus_error(error)));
                return;
            }
        };
        let mut added = match manager.receive_interfaces_added().await {
            Ok(stream) => stream,
            Err(error) => {
                let _ = ready_sender.send(Err(dbus_error(error)));
                return;
            }
        };
        let mut removed = match manager.receive_interfaces_removed().await {
            Ok(stream) => stream,
            Err(error) => {
                let _ = ready_sender.send(Err(dbus_error(error)));
                return;
            }
        };
        let objects = match manager.get_managed_objects().await {
            Ok(objects) => objects,
            Err(error) => {
                let _ = ready_sender.send(Err(dbus_error(error)));
                return;
            }
        };
        let mut notification_sessions: HashSet<OwnedObjectPath> = objects
            .into_iter()
            .filter_map(|(path, interfaces)| {
                let properties = interfaces
                    .iter()
                    .find(|(interface, _)| interface.as_str() == SESSION_INTERFACE)
                    .map(|(_, properties)| properties)?;
                is_phone_notification_session(path.as_str(), properties, &phone_address)
                    .then_some(path)
            })
            .collect();
        let _ = ready_sender.send(Ok(()));
        tokio::pin!(client_session_receiver);
        let mut client_session = None;

        loop {
            tokio::select! {
                biased;
                session = &mut client_session_receiver, if client_session.is_none() => {
                    match session {
                        Ok(path) => client_session = Some(path),
                        Err(_) => break,
                    }
                }
                signal = added.next() => {
                    let Some(signal) = signal else {
                        break;
                    };
                    let args = match signal.args() {
                        Ok(args) => args,
                        Err(error) => {
                            let _ = sender.send(Err(dbus_error(error))).await;
                            return;
                        }
                    };
                    let path = match OwnedObjectPath::try_from(args.object_path().as_str()) {
                        Ok(path) => path,
                        Err(error) => {
                            let _ = sender.send(Err(dbus_error(error))).await;
                            return;
                        }
                    };
                    let interfaces = args.interfaces_and_properties();
                    if let Some(properties) = interfaces
                        .iter()
                        .find(|(interface, _)| interface.as_str() == SESSION_INTERFACE)
                        .map(|(_, properties)| properties)
                        && is_added_phone_notification_session(
                            path.as_str(),
                            properties,
                            &phone_address,
                        )
                    {
                        notification_sessions.insert(path.clone());
                    }
                    let is_message = interfaces
                        .keys()
                        .any(|interface| interface.as_str() == MESSAGE_INTERFACE);
                    let belongs_to_client = client_session
                        .as_ref()
                        .is_some_and(|session| belongs_to_session(&path, session));
                    if !is_message || !belongs_to_client {
                        continue;
                    }
                    let event = match classify_incoming_download(
                        download_incoming(&connection, &path, &workspace).await,
                    ) {
                        Ok(event) => event,
                        Err(error) => {
                            let _ = sender.send(Err(error)).await;
                            return;
                        }
                    };
                    if sender.send(Ok(event)).await.is_err() {
                        return;
                    }
                }
                signal = removed.next() => {
                    let Some(signal) = signal else {
                        break;
                    };
                    let args = match signal.args() {
                        Ok(args) => args,
                        Err(error) => {
                            let _ = sender.send(Err(dbus_error(error))).await;
                            return;
                        }
                    };
                    let path = match OwnedObjectPath::try_from(args.object_path().as_str()) {
                        Ok(path) => path,
                        Err(error) => {
                            let _ = sender.send(Err(dbus_error(error))).await;
                            return;
                        }
                    };
                    let session_removed = args
                        .interfaces()
                        .iter()
                        .any(|interface| interface.as_str() == SESSION_INTERFACE);
                    let own_client_removed = session_removed
                        && client_session.as_ref().is_some_and(|own| own == &path);
                    let own_notification_removed = session_removed
                        && removed_last_notification_session(&mut notification_sessions, &path);
                    if own_client_removed || own_notification_removed {
                        let _ = sender.send(Ok(PhoneEvent::Disconnected)).await;
                        return;
                    }
                }
            }
        }
        let _ = sender
            .send(Err(PhoneError::Dbus(
                "the scoped incoming notification listener stopped".into(),
            )))
            .await;
    });
    match ready_receiver.await {
        Ok(Ok(())) => Ok(task),
        Ok(Err(error)) => {
            task.abort();
            Err(error)
        }
        Err(_) => {
            task.abort();
            Err(PhoneError::Map(
                "incoming notification listener stopped during setup".into(),
            ))
        }
    }
}

fn classify_incoming_download(
    result: Result<PhoneEvent, PhoneError>,
) -> Result<PhoneEvent, PhoneError> {
    match result {
        Err(PhoneError::InvalidMessage(_)) => Ok(PhoneEvent::IncomingSkipped),
        outcome => outcome,
    }
}

fn removed_last_notification_session(
    sessions: &mut HashSet<OwnedObjectPath>,
    removed: &OwnedObjectPath,
) -> bool {
    sessions.remove(removed) && sessions.is_empty()
}

fn is_phone_notification_session(
    path: &str,
    properties: &HashMap<String, OwnedValue>,
    phone_address: &str,
) -> bool {
    let destination = property_string(properties, "Destination");
    let target = property_string(properties, "Target");
    matches_notification_session(
        path,
        destination.as_deref(),
        target.as_deref(),
        phone_address,
    )
}

fn is_added_phone_notification_session(
    path: &str,
    properties: &HashMap<&str, Value<'_>>,
    phone_address: &str,
) -> bool {
    matches_notification_session(
        path,
        properties
            .get("Destination")
            .and_then(|value| <&str>::try_from(value).ok()),
        properties
            .get("Target")
            .and_then(|value| <&str>::try_from(value).ok()),
        phone_address,
    )
}

fn matches_notification_session(
    path: &str,
    destination: Option<&str>,
    target: Option<&str>,
    phone_address: &str,
) -> bool {
    path.starts_with(OBEX_SERVER_ROOT)
        && destination.is_some_and(|value| value.eq_ignore_ascii_case(phone_address))
        && target.is_some_and(|value| value.eq_ignore_ascii_case(MAP_NOTIFICATION_SERVICE_UUID))
}

fn belongs_to_session(message_path: &OwnedObjectPath, session: &OwnedObjectPath) -> bool {
    let Some((parent, _)) = message_path.as_str().rsplit_once('/') else {
        return false;
    };
    session.as_str() == parent
}

async fn download_incoming(
    connection: &Connection,
    message_path: &OwnedObjectPath,
    workspace: &Path,
) -> Result<PhoneEvent, PhoneError> {
    let target = create_incoming_target(workspace)?;
    let target_text = target
        .path()
        .to_str()
        .ok_or_else(|| PhoneError::TemporaryStorage("temporary path is not UTF-8".into()))?;
    let message = Proxy::new(
        connection,
        OBEX_SERVICE,
        message_path.as_str(),
        MESSAGE_INTERFACE,
    )
    .await
    .map_err(dbus_error)?;
    let (transfer, properties): (OwnedObjectPath, HashMap<String, OwnedValue>) = message
        .call("Get", &(target_text, false))
        .await
        .map_err(map_error)?;
    wait_for_transfer(connection, &transfer, &properties).await?;
    if fs::metadata(target.path()).map_err(storage_error)?.len() > MAX_BMESSAGE_BYTES as u64 {
        return Err(PhoneError::InvalidMessage(
            "bMessage container exceeds the safe session limit".into(),
        ));
    }
    let bytes = fs::read(target.path()).map_err(storage_error);
    let incoming =
        parse_incoming(&bytes?).map_err(|error| PhoneError::InvalidMessage(error.to_string()))?;
    Ok(PhoneEvent::Incoming {
        sender: incoming.sender,
        body: incoming.body,
    })
}

async fn wait_for_transfer(
    connection: &Connection,
    transfer_path: &OwnedObjectPath,
    initial: &HashMap<String, OwnedValue>,
) -> Result<(), PhoneError> {
    if let Some(status) = property_string(initial, "Status") {
        match status.as_str() {
            "complete" => return Ok(()),
            "error" => return Err(PhoneError::Map("OBEX transfer failed".into())),
            _ => {}
        }
    }
    let transfer = Proxy::new(
        connection,
        OBEX_SERVICE,
        transfer_path.as_str(),
        TRANSFER_INTERFACE,
    )
    .await
    .map_err(dbus_error)?;
    let result = tokio::time::timeout(TRANSFER_TIMEOUT, async {
        loop {
            let status: String = transfer.get_property("Status").await.map_err(dbus_error)?;
            match status.as_str() {
                "complete" => return Ok(()),
                "error" => return Err(PhoneError::Map("OBEX transfer failed".into())),
                _ => tokio::time::sleep(Duration::from_millis(25)).await,
            }
        }
    })
    .await;
    match result {
        Ok(outcome) => outcome,
        Err(_) => cancel_timed_out_transfer(&transfer).await,
    }
}

async fn cancel_timed_out_transfer(transfer: &Proxy<'_>) -> Result<(), PhoneError> {
    let cancelled = tokio::time::timeout(
        TRANSFER_CANCEL_TIMEOUT,
        transfer.call::<_, _, ()>("Cancel", &()),
    )
    .await;
    if matches!(cancelled, Ok(Ok(()))) {
        return Err(PhoneError::Timeout);
    }

    let status = tokio::time::timeout(
        TRANSFER_CANCEL_TIMEOUT,
        transfer.get_property::<String>("Status"),
    )
    .await;
    match status {
        Ok(Ok(status)) if status == "complete" => Ok(()),
        Ok(Ok(status)) if status == "error" => Err(PhoneError::Map("OBEX transfer failed".into())),
        _ => Err(PhoneError::TransferOutcomeUnknown),
    }
}

fn dbus_error(_error: impl std::fmt::Display) -> PhoneError {
    PhoneError::Dbus("request failed; run `blupost doctor` for safe diagnostics".into())
}

fn map_error(error: impl std::fmt::Display) -> PhoneError {
    let detail = error.to_string().to_ascii_lowercase();
    let diagnostic = if detail.contains("connection refused") {
        "the iPhone refused the MAP request; reconnect it and verify Show Notifications"
    } else if detail.contains("not authorized")
        || detail.contains("not permitted")
        || detail.contains("permission denied")
    {
        "Bluetooth MAP permission was denied; verify Show Notifications for this computer"
    } else if detail.contains("in progress") || detail.contains("busy") {
        "another Bluetooth MAP operation is in progress; wait before one new send attempt"
    } else if detail.contains("not supported") {
        "the connected phone does not support this Bluetooth MAP operation"
    } else if detail.contains("invalid argument") || detail.contains("invalidarguments") {
        "BlueZ rejected the Bluetooth MAP request arguments"
    } else {
        "operation failed; verify the phone is nearby and Show Notifications is enabled"
    };
    PhoneError::Map(diagnostic.into())
}

fn storage_error(error: impl std::fmt::Display) -> PhoneError {
    PhoneError::TemporaryStorage(error.to_string())
}

fn unique_path_in(directory: &Path, prefix: &str, extension: &str) -> Result<PathBuf, PhoneError> {
    let mut random = [0_u8; 8];
    getrandom::fill(&mut random)
        .map_err(|error| PhoneError::TemporaryStorage(error.to_string()))?;
    Ok(directory.join(format!(
        "{prefix}-{:016x}.{extension}",
        u64::from_ne_bytes(random)
    )))
}

fn create_incoming_target(workspace: &Path) -> Result<TemporaryFile, PhoneError> {
    let path = unique_path_in(workspace, "incoming", "bmsg")?;
    OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&path)
        .map_err(storage_error)?;
    Ok(TemporaryFile { path })
}

fn private_runtime_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR") {
        roots.push(PathBuf::from(runtime));
    }
    roots.push(PathBuf::from("/dev/shm"));
    roots.push(std::env::temp_dir());
    roots
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    use super::*;

    #[test]
    fn transfer_staging_is_owner_only_and_removed_on_drop() {
        let workspace = TemporaryWorkspace::create().expect("private workspace");
        let directory = workspace.path.clone();
        assert_eq!(
            fs::metadata(&directory)
                .expect("workspace metadata")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        let message = workspace
            .write_outgoing(b"redacted fixture")
            .expect("staged message");
        assert_eq!(
            fs::metadata(message.path())
                .expect("message metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        drop(workspace);
        assert!(!directory.exists());
    }

    #[test]
    fn incoming_target_is_removed_on_every_exit_path() {
        let workspace = TemporaryWorkspace::create().expect("private workspace");
        let target = create_incoming_target(&workspace.path).expect("incoming target");
        let path = target.path().to_owned();
        assert!(path.exists());
        drop(target);
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn dropping_a_setup_listener_guard_aborts_its_task() {
        struct DropFlag(Arc<AtomicBool>);

        impl Drop for DropFlag {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }

        let dropped = Arc::new(AtomicBool::new(false));
        let task_flag = dropped.clone();
        let listener = tokio::spawn(async move {
            let _flag = DropFlag(task_flag);
            std::future::pending::<()>().await;
        });
        tokio::task::yield_now().await;
        drop(SetupListenerGuard::new(listener));
        tokio::task::yield_now().await;

        assert!(dropped.load(Ordering::SeqCst));
    }

    #[test]
    fn notification_turnover_disconnects_only_after_the_last_session() {
        let first = OwnedObjectPath::try_from("/org/bluez/obex/server/session1")
            .expect("first object path");
        let second = OwnedObjectPath::try_from("/org/bluez/obex/server/session2")
            .expect("second object path");
        let mut sessions = HashSet::from([first.clone(), second.clone()]);

        assert!(!removed_last_notification_session(&mut sessions, &first));
        assert!(sessions.contains(&second));
        assert!(removed_last_notification_session(&mut sessions, &second));
    }

    #[test]
    fn captured_incoming_message_is_accepted_for_the_owned_map_session() {
        let incoming = OwnedObjectPath::try_from("/org/bluez/obex/client/session7/message42")
            .expect("captured incoming object path");
        let own_client = OwnedObjectPath::try_from("/org/bluez/obex/client/session7")
            .expect("owned MAP client session path");
        let foreign_client = OwnedObjectPath::try_from("/org/bluez/obex/client/session9")
            .expect("foreign MAP client session path");
        let notification = OwnedObjectPath::try_from("/org/bluez/obex/server/session8")
            .expect("notification session path");

        assert!(belongs_to_session(&incoming, &own_client));
        assert!(!belongs_to_session(&incoming, &foreign_client));
        assert!(!belongs_to_session(&incoming, &notification));
    }

    #[test]
    fn only_malformed_incoming_messages_are_recoverable() {
        assert_eq!(
            classify_incoming_download(Err(PhoneError::InvalidMessage("redacted fixture".into(),)))
                .expect("malformed incoming message is recoverable"),
            PhoneEvent::IncomingSkipped
        );

        for error in [
            PhoneError::Dbus("redacted fixture".into()),
            PhoneError::Map("redacted fixture".into()),
            PhoneError::Timeout,
            PhoneError::TransferOutcomeUnknown,
            PhoneError::TemporaryStorage("redacted fixture".into()),
        ] {
            assert!(classify_incoming_download(Err(error)).is_err());
        }
    }

    #[test]
    fn map_errors_keep_a_safe_category_without_echoing_raw_dbus_detail() {
        let error =
            map_error("org.bluez.obex.Error.Failed: Connection refused; private transport detail");
        let diagnostic = error.to_string();

        assert_eq!(
            diagnostic,
            "Bluetooth MAP: the iPhone refused the MAP request; reconnect it and verify Show Notifications"
        );
        assert!(!diagnostic.contains("private transport detail"));
    }

    #[test]
    fn push_message_uses_bluez_charset_spelling() {
        let options = push_message_options();

        assert_eq!(options.get("Charset"), Some(&Value::from("utf8")));
        assert_ne!(options.get("Charset"), Some(&Value::from("UTF-8")));
    }

    #[test]
    fn map_errors_recognize_bluez_invalid_arguments_name() {
        let error = map_error("org.bluez.obex.Error.InvalidArguments: no details");

        assert_eq!(
            error.to_string(),
            "Bluetooth MAP: BlueZ rejected the Bluetooth MAP request arguments"
        );
    }

    #[tokio::test]
    async fn queued_terminal_listener_error_returns_promptly() {
        let mut phone = BluezPhone::new();
        phone
            .event_sender
            .send(Err(PhoneError::Dbus("redacted fixture".into())))
            .await
            .expect("queue terminal error");

        assert!(
            tokio::time::timeout(Duration::from_millis(10), phone.next_event())
                .await
                .expect("terminal event returned synchronously after dequeue")
                .is_err()
        );
    }

    #[tokio::test]
    async fn skipped_incoming_message_remains_recoverable() {
        let mut phone = BluezPhone::new();
        phone
            .event_sender
            .send(Ok(PhoneEvent::IncomingSkipped))
            .await
            .expect("queue recoverable event");

        assert_eq!(
            phone.next_event().await.expect("recoverable event"),
            PhoneEvent::IncomingSkipped
        );
        assert!(phone.active_session.is_none());
    }
}
