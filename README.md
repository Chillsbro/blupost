# Blupost

Blupost is a terminal-native Linux client for session-based one-to-one texting through a nearby, paired iPhone. A deep Rust runtime owns Bluetooth MAP, contacts, drafts, message state, and bounded connection recovery; an imperative OpenTUI Core frontend provides the clickable terminal interface without React.

![Blupost Electric Quiet terminal interface](docs/ui-preview.svg)

_An actual deterministic frame captured from the implemented TUI._

The live feasibility probe passed on BlueZ 5.87: Linux sent a text through the iPhone and retrieved a reply through MAP notifications. Blupost deliberately does not synchronize old conversations—each process starts with an empty, in-memory session and retains at most 500 messages across all live threads.

## Requirements

- Linux with BlueZ and the per-user `org.bluez.obex` service
- A paired iPhone with **Show Notifications** enabled for this computer in its Bluetooth settings
- Rust 1.87 or newer
- Bun 1.3.14 or newer
- A terminal with mouse support; Kitty is supported but not required

## Build and run

```sh
bun install --frozen-lockfile
bun run lint
bun run test
bun run build
bun ./bin/blupost.js doctor
bun ./bin/blupost.js
```

For source development, `bun run dev` builds the matching debug engine before starting Bun's watch mode.

The TUI connects when it opens. Choose `＋ Add contact` or press `n`, enter an alias and phone number, then choose `Save contact`; the contact is validated and saved to the same XDG configuration used by the plain commands. Open a thread, type a message, and press Enter or click `Send`. Shift+Enter inserts a newline. Escape steps back through composer, transcript, and compact conversation-list contexts; arrows or `j`/`k` move through contacts, and Tab/Shift+Tab move focus.

`Ctrl+P` opens the command palette for contacts, reconnect, contextual help, and conversations without discarding the current draft. `?` opens context-specific help outside text entry. Drag across message text to copy the completed selection. HTTP(S) URLs are terminal hyperlinks; use the terminal's link modifier when required (`Ctrl+Shift` in Kitty). A dropped Bluetooth session gets at most three connection-only recovery attempts after 1, 2, and 4 seconds; messages are never retried. If BlueZ cannot prove whether a timed-out transfer completed or was cancelled, Blupost shows `Check your phone — outcome unknown` instead of claiming failure. The TUI and `watch` share the same Rust supervisor. Ctrl+C closes the MAP session and restores the terminal.

## Contacts and plain commands

```sh
bun ./bin/blupost.js contacts add alice +13125550123
bun ./bin/blupost.js contacts list
bun ./bin/blupost.js contacts update alice +13125550124
bun ./bin/blupost.js contacts remove alice

bun ./bin/blupost.js send alice "Running late"
bun ./bin/blupost.js send alice -- "--literal option-like message"
bun ./bin/blupost.js watch --plain
```

Contacts added from either the TUI or CLI live at `${XDG_CONFIG_HOME:-~/.config}/blupost/config.toml` with owner-only permissions. Updates share an empty owner-only lock file so concurrent Blupost processes cannot overwrite one another's changes. Phone selection is automatic:

```toml
[contacts]
alice = "+13125550123"
```

Motion is automatic, bounded, and state-driven: interactive terminals get the one-shot mark reveal and local arrival/sending/sent feedback, while non-TTY output and tests snap directly to final frames. Idle state is completely still.

## Privacy boundary

Blupost requests Bluetooth MAP access, not general iPhone filesystem or Apple Account access. TUI message bodies and drafts stay in process memory and cross the validated private child-process stdio seam. With the one-shot shell command, the recipient and body necessarily begin in the Bun launcher's arguments and may therefore be visible in shell history or same-user process inspection; the launcher forwards them to the native engine over private stdin instead of duplicating them into the engine's arguments.

The only normal disk writes are the contacts configuration, its empty lock file, and private `0600` bMessage transfer files inside a random `0700` temporary directory. Rust deletes each transfer file on its operation exit path and removes the directory on orderly session close. An abrupt process kill or host crash can leave that owner-only temporary data behind. Selecting message text deliberately places that selection on the host or terminal clipboard; Blupost does not copy unselected content. Ordinary diagnostics redact Bluetooth addresses and the phone's personal name and never log message bodies.

Terminal scrollback, OS swap, crash dumps, and a compromised same-user desktop session remain outside that guarantee. SHA hashes are not encryption, so Blupost does not present hashing as message confidentiality.
