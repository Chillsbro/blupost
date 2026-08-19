use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use rustix::fs::{FlockOperation, flock};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::session::{PhoneNumber, PhoneNumberError};

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ContactsConfig {
    contacts: BTreeMap<String, PhoneNumber>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContactEntry {
    pub alias: String,
    pub number: PhoneNumber,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ConfigFile {
    #[serde(default, rename = "phone", skip_serializing_if = "Option::is_none")]
    legacy_phone: Option<LegacyPhoneConfig>,
    #[serde(default)]
    contacts: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LegacyPhoneConfig {
    #[serde(default = "automatic_device")]
    device: String,
}

struct ConfigLock {
    _file: fs::File,
}

impl ConfigLock {
    fn acquire(path: &Path) -> Result<Self, ContactsError> {
        let parent = secure_parent(path)?;
        let lock_path = parent.join(".config.lock");
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(&lock_path)
            .map_err(ContactsError::Write)?;
        fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o600))
            .map_err(ContactsError::Write)?;
        flock(&file, FlockOperation::LockExclusive)
            .map_err(|error| ContactsError::Lock(error.into()))?;
        Ok(Self { _file: file })
    }
}

impl ContactsConfig {
    pub fn load(path: &Path) -> Result<Self, ContactsError> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let contents = fs::read_to_string(path).map_err(ContactsError::Read)?;
        let parsed: ConfigFile =
            toml::from_str(&contents).map_err(|error| redacted_parse_error(&contents, &error))?;
        if parsed
            .legacy_phone
            .as_ref()
            .is_some_and(|phone| phone.device != "auto")
        {
            return Err(ContactsError::UnsupportedDeviceSelection);
        }
        let mut contacts = BTreeMap::new();
        for (alias, number) in parsed.contacts {
            let normalized_alias = normalize_alias(&alias)?;
            let normalized_number =
                PhoneNumber::parse(&number).map_err(|source| ContactsError::InvalidNumber {
                    alias: normalized_alias.clone(),
                    source,
                })?;
            if contacts
                .insert(normalized_alias.clone(), normalized_number)
                .is_some()
            {
                return Err(ContactsError::DuplicateAlias(normalized_alias));
            }
        }
        Ok(Self { contacts })
    }

    fn save(&self, path: &Path) -> Result<(), ContactsError> {
        let parent = secure_parent(path)?;
        let file = ConfigFile {
            legacy_phone: None,
            contacts: self
                .contacts
                .iter()
                .map(|(alias, number)| (alias.clone(), number.as_str().to_owned()))
                .collect(),
        };
        let serialized = toml::to_string_pretty(&file).map_err(ContactsError::Serialize)?;
        let mut random = [0_u8; 8];
        getrandom::fill(&mut random).map_err(ContactsError::Random)?;
        let suffix = u64::from_ne_bytes(random);
        let temp = parent.join(format!(".config.toml.{suffix:016x}.tmp"));

        let write_result = (|| {
            let mut output = OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&temp)
                .map_err(ContactsError::Write)?;
            output
                .write_all(serialized.as_bytes())
                .map_err(ContactsError::Write)?;
            output.sync_all().map_err(ContactsError::Write)?;
            fs::rename(&temp, path).map_err(ContactsError::Write)?;
            Ok(())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        write_result
    }

    pub fn add_persisted(path: &Path, alias: &str, number: &str) -> Result<Self, ContactsError> {
        Self::edit_persisted(path, |contacts| contacts.add(alias, number))
    }

    pub fn update_persisted(path: &Path, alias: &str, number: &str) -> Result<Self, ContactsError> {
        Self::edit_persisted(path, |contacts| contacts.update(alias, number))
    }

    pub fn remove_persisted(path: &Path, alias: &str) -> Result<Self, ContactsError> {
        Self::edit_persisted(path, |contacts| contacts.remove(alias))
    }

    fn edit_persisted(
        path: &Path,
        edit: impl FnOnce(&mut Self) -> Result<(), ContactsError>,
    ) -> Result<Self, ContactsError> {
        let _lock = ConfigLock::acquire(path)?;
        let mut contacts = Self::load(path)?;
        edit(&mut contacts)?;
        contacts.save(path)?;
        Ok(contacts)
    }

    #[must_use]
    pub fn entries(&self) -> Vec<ContactEntry> {
        self.contacts
            .iter()
            .map(|(alias, number)| ContactEntry {
                alias: alias.clone(),
                number: number.clone(),
            })
            .collect()
    }

    pub fn resolve(&self, alias_or_number: &str) -> Result<PhoneNumber, ContactsError> {
        let direct_error = match PhoneNumber::parse(alias_or_number) {
            Ok(number) => return Ok(number),
            Err(error) => error,
        };
        if let Ok(alias) = normalize_alias(alias_or_number)
            && let Some(number) = self.contacts.get(&alias)
        {
            return Ok(number.clone());
        }
        Err(ContactsError::DirectNumber(direct_error))
    }

    #[must_use]
    pub fn alias_for(&self, number: &PhoneNumber) -> Option<&str> {
        self.contacts
            .iter()
            .find_map(|(alias, candidate)| (candidate == number).then_some(alias.as_str()))
    }

    pub fn add(&mut self, alias: &str, number: &str) -> Result<(), ContactsError> {
        let alias = normalize_alias(alias)?;
        if self.contacts.contains_key(&alias) {
            return Err(ContactsError::DuplicateAlias(alias));
        }
        let number = PhoneNumber::parse(number).map_err(|source| ContactsError::InvalidNumber {
            alias: alias.clone(),
            source,
        })?;
        self.contacts.insert(alias, number);
        Ok(())
    }

    pub fn update(&mut self, alias: &str, number: &str) -> Result<(), ContactsError> {
        let alias = normalize_alias(alias)?;
        if !self.contacts.contains_key(&alias) {
            return Err(ContactsError::UnknownAlias(alias));
        }
        let number = PhoneNumber::parse(number).map_err(|source| ContactsError::InvalidNumber {
            alias: alias.clone(),
            source,
        })?;
        self.contacts.insert(alias, number);
        Ok(())
    }

    pub fn remove(&mut self, alias: &str) -> Result<(), ContactsError> {
        let alias = normalize_alias(alias)?;
        self.contacts
            .remove(&alias)
            .map(|_| ())
            .ok_or(ContactsError::UnknownAlias(alias))
    }

    pub fn default_path() -> Result<PathBuf, ContactsError> {
        if let Some(config_home) = std::env::var_os("XDG_CONFIG_HOME") {
            return Ok(PathBuf::from(config_home).join("blupost/config.toml"));
        }
        let home = std::env::var_os("HOME").ok_or(ContactsError::MissingHome)?;
        Ok(PathBuf::from(home).join(".config/blupost/config.toml"))
    }
}

fn secure_parent(path: &Path) -> Result<&Path, ContactsError> {
    let parent = path.parent().ok_or(ContactsError::MissingParent)?;
    fs::create_dir_all(parent).map_err(ContactsError::Write)?;
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700)).map_err(ContactsError::Write)?;
    Ok(parent)
}

fn normalize_alias(input: &str) -> Result<String, ContactsError> {
    let alias = input.trim().to_ascii_lowercase();
    if alias.is_empty()
        || !alias
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(ContactsError::InvalidAlias);
    }
    if PhoneNumber::parse(&alias).is_ok() {
        return Err(ContactsError::AmbiguousAlias);
    }
    Ok(alias)
}

fn automatic_device() -> String {
    "auto".into()
}

fn redacted_parse_error(contents: &str, error: &toml::de::Error) -> ContactsError {
    match error.span() {
        Some(span) => {
            let offset = span.start.min(contents.len());
            let line = contents
                .char_indices()
                .take_while(|(index, _)| *index < offset)
                .filter(|(_, character)| *character == '\n')
                .count()
                + 1;
            ContactsError::Parse { line }
        }
        None => ContactsError::ParseUnknown,
    }
}

#[derive(Debug, Error)]
pub enum ContactsError {
    #[error("contact alias must contain only letters, digits, '-' or '_'")]
    InvalidAlias,
    #[error("contact alias cannot also be parsed as a phone number")]
    AmbiguousAlias,
    #[error("contact alias already exists: {0}")]
    DuplicateAlias(String),
    #[error("unknown contact alias: {0}")]
    UnknownAlias(String),
    #[error("invalid number for contact {alias}: {source}")]
    InvalidNumber {
        alias: String,
        #[source]
        source: PhoneNumberError,
    },
    #[error("invalid phone number: {0}")]
    DirectNumber(PhoneNumberError),
    #[error("could not read contacts configuration: {0}")]
    Read(std::io::Error),
    #[error("could not parse contacts configuration near line {line}")]
    Parse { line: usize },
    #[error("could not parse contacts configuration")]
    ParseUnknown,
    #[error("could not serialize contacts configuration: {0}")]
    Serialize(toml::ser::Error),
    #[error("only automatic phone selection is supported; remove the [phone] setting")]
    UnsupportedDeviceSelection,
    #[error("could not write contacts configuration: {0}")]
    Write(std::io::Error),
    #[error("could not lock contacts configuration: {0}")]
    Lock(std::io::Error),
    #[error("could not create secure temporary filename: {0}")]
    Random(getrandom::Error),
    #[error("configuration path has no parent directory")]
    MissingParent,
    #[error("HOME and XDG_CONFIG_HOME are both unset")]
    MissingHome,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir() -> PathBuf {
        let mut random = [0_u8; 8];
        getrandom::fill(&mut random).expect("system randomness");
        std::env::temp_dir().join(format!(
            "blupost-contacts-{:016x}",
            u64::from_ne_bytes(random)
        ))
    }

    #[test]
    fn round_trips_contacts_with_owner_only_permissions() {
        let directory = test_dir();
        let path = directory.join("config.toml");
        fs::create_dir_all(&directory).expect("create fixture directory");
        fs::write(&path, "[contacts]\n").expect("create existing config");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644))
            .expect("set existing config permissions");
        let mut contacts = ContactsConfig::default();
        contacts.add("Alice", "2025550101").expect("add contact");
        contacts.save(&path).expect("save contacts");

        assert_eq!(
            fs::metadata(&directory)
                .expect("directory metadata")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&path)
                .expect("file metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            ContactsConfig::load(&path)
                .expect("load contacts")
                .resolve("alice")
                .expect("resolve")
                .as_str(),
            "+12025550101"
        );
        fs::remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn rejects_alias_collisions_after_normalization() {
        let mut contacts = ContactsConfig::default();
        contacts.add("Alice", "2025550101").expect("add contact");
        assert!(matches!(
            contacts.add("alice", "2025550102"),
            Err(ContactsError::DuplicateAlias(_))
        ));
    }

    #[test]
    fn serializes_concurrent_contact_updates_through_a_stable_lock() {
        use std::sync::{Arc, Barrier};

        let directory = test_dir();
        let path = directory.join("config.toml");
        let barrier = Arc::new(Barrier::new(2));
        let mut updates = Vec::new();
        for (alias, number) in [("alice", "2025550101"), ("bob", "2025550102")] {
            let path = path.clone();
            let barrier = Arc::clone(&barrier);
            updates.push(std::thread::spawn(move || {
                barrier.wait();
                ContactsConfig::add_persisted(&path, alias, number)
                    .expect("persist concurrent contact");
            }));
        }
        for update in updates {
            update.join().expect("contact update thread");
        }

        assert_eq!(
            ContactsConfig::load(&path).expect("reload").entries().len(),
            2
        );
        assert_eq!(
            fs::metadata(directory.join(".config.lock"))
                .expect("lock metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        fs::remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn rejects_phone_number_shaped_aliases_on_add_and_load() {
        let mut contacts = ContactsConfig::default();
        assert!(matches!(
            contacts.add("2025550101", "2025550199"),
            Err(ContactsError::AmbiguousAlias)
        ));

        let directory = test_dir();
        fs::create_dir_all(&directory).expect("create fixture directory");
        let path = directory.join("config.toml");
        fs::write(&path, "[contacts]\n2025550101 = \"2025550199\"\n")
            .expect("write ambiguous config fixture");
        assert!(matches!(
            ContactsConfig::load(&path),
            Err(ContactsError::AmbiguousAlias)
        ));
        fs::remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn direct_numbers_take_precedence_even_over_corrupt_alias_state() {
        let mut contacts = ContactsConfig::default();
        contacts.contacts.insert(
            "2025550101".into(),
            PhoneNumber::parse("2025550199").expect("fixture target"),
        );

        assert_eq!(
            contacts
                .resolve("2025550101")
                .expect("resolve direct number")
                .as_str(),
            "+12025550101"
        );
    }

    #[test]
    fn parse_errors_report_location_without_echoing_contact_data() {
        let directory = test_dir();
        fs::create_dir_all(&directory).expect("create fixture directory");
        let path = directory.join("config.toml");
        let private_number = "2025550199";
        fs::write(&path, format!("[contacts]\nalice = [{private_number}\n"))
            .expect("write malformed fixture");

        let error = ContactsConfig::load(&path).expect_err("reject malformed config");
        let diagnostic = error.to_string();
        assert!(diagnostic.contains("near line 2"));
        assert!(!diagnostic.contains(private_number));
        assert!(!diagnostic.contains("alice"));

        fs::remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn migrates_the_legacy_automatic_phone_setting_out_on_save() {
        let directory = test_dir();
        fs::create_dir_all(&directory).expect("create fixture directory");
        let path = directory.join("config.toml");
        fs::write(
            &path,
            "[phone]\ndevice = \"auto\"\n\n[contacts]\nalice = \"2025550101\"\n",
        )
        .expect("write legacy config fixture");

        let contacts = ContactsConfig::load(&path).expect("load legacy automatic config");
        contacts.save(&path).expect("save contacts-only config");
        let rewritten = fs::read_to_string(&path).expect("read rewritten config");
        assert!(!rewritten.contains("[phone]"));
        assert!(rewritten.contains("[contacts]"));

        fs::remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn rejects_a_legacy_device_setting_that_would_be_ignored() {
        let directory = test_dir();
        fs::create_dir_all(&directory).expect("create fixture directory");
        let path = directory.join("config.toml");
        fs::write(&path, "[phone]\ndevice = \"named-device\"\n")
            .expect("write unsupported device fixture");

        assert!(matches!(
            ContactsConfig::load(&path),
            Err(ContactsError::UnsupportedDeviceSelection)
        ));

        fs::remove_dir_all(directory).expect("remove fixture directory");
    }
}
