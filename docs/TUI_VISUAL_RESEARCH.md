# Electric-blue minimal messaging contract

**Status:** Approved implementation contract

**Evidence:** [65-interface primary-source review](MINIMAL_MESSAGING_UI_RESEARCH.md)

**Scope:** The OpenTUI application. Transport, privacy, and send semantics do not change.

## Decision

Blupost is a conversation tool, not a dashboard. Its default screen contains only what is needed to choose a conversation, read it, understand the live connection, and write the next message.

The selected conversation already answers “who.” The interface does not repeat that answer in a detail title, `TO` field, recipient chip, composer placeholder, or message label. The connection state occupies one stable slot. Help, search, and contact entry appear only when invoked.

The approved visual direction is electric blue against layered dark greys. Exactly one unframed Blupost mark anchors the upper-left. It has no tile, border, masthead, wordmark, slogan, animation, or decorative background. This explicit product decision supersedes the research report's earlier recommendation to keep all branding outside the working canvas.

## Persistent surface budget

Every persistent element must communicate unique state, expose one primary action, or establish the approved brand anchor.

### Wide terminals: 72 columns and above

- Two panes: a restrained conversation list and a dominant transcript.
- No global masthead and no transcript title.
- The real electric-blue mark sits at the upper-left of the navigation pane with transparent surroundings; the single connection state is right-aligned in that same header.
- One quiet divider separates the header from the conversation rows.
- The active list row is the only recipient identity.
- When height permits, a row contains alias plus one latest-message preview. Unread count wins the metadata slot; `draft` is shown only without unread state.
- The active row uses a low-contrast blue surface and leading rail. The rail, weight, and position preserve selection meaning without color.
- The list footer contains only `+ contact`.
- The transcript owns the remaining area and ends in one composer.

### Narrow terminals: below 72 columns

- One pane appears at a time.
- Chat uses one context row: the unframed mark, `‹ alias`, and the connection state.
- The list uses the same row for the single `contacts` context label.
- Temporary surfaces replace the pane and name themselves in that row: `Actions`, `New contact`, or `Help`.
- At `40x12`, previews and the composer frame disappear before identity, message text, connection truth, or the send action.

### Required target frames

| Viewport | Required anatomy |
| --- | --- |
| `120x34` | list + transcript, upper-left mark, no header |
| `80x24` | list + transcript, upper-left mark, no header |
| `60x18` | one chat pane with one context row |
| `40x12` | the same interaction model without overflow |

## Conversation list

- `›` marks the keyboard-selected row and `▌` marks the open conversation.
- The open row keeps a full-width selected surface even while focus is in the composer.
- Moving through rows does not open them. Enter or a mouse click opens the selected conversation.
- Preview text is secondary, single-line, and clipped before it can displace alias, unread state, or the transcript.
- No phone number, device name, timestamp, section heading, or duplicated recipient appears in the list.

## Transcript

- Incoming groups align left; outgoing groups align right.
- Messages use quiet raised surfaces: dark grey for incoming and deep electric blue for outgoing.
- Direction is not repeated with `You`, the contact name, or a permanent direction label.
- Adjacent messages of the same direction share a tight rhythm; direction changes create the larger gap.
- URLs remain terminal hyperlinks and message text remains selectable.
- The transcript invents no timestamps or delivery data.
- When a reader has scrolled away from the end, new arrivals use one local `↓ N new` action and do not move the scroll position.

Message state stays attached to the affected outgoing message:

| Engine state | Visible text |
| --- | --- |
| sending | `sending…` |
| sent | `✓` on the latest outgoing message only |
| failed | `not sent` |
| unknown | `Check your phone — outcome unknown` |

## Composer

- The empty prompt is always `Write a message` and never contains the alias.
- The initial value is empty unless a genuine user draft exists for that thread.
- Roomy, standard, and compact tiers use one quiet framed input surface; tiny uses a single raised row.
- A compact electric-blue `↑` action remains in the right edge so the layout does not jump as text appears.
- Clicking the action with an empty body does nothing. Enter sends only a nonempty user-authored body; Shift+Enter inserts a line break.
- The composer grows only to its tier limit, then scrolls internally.
- Offline edits remain drafts. Nothing is queued or retried, and that fact appears beside the draft only when relevant.
- A rejected pre-acceptance send restores the exact draft without deleting newer typing.

## Mark and terminal capability

- `docs/brand/blupost-mark.svg` is the source of truth and uses solid `#168BFF` with no background.
- Kitty and Sixel-capable terminals receive the embedded asset through OpenTUI's image protocol.
- Other terminals receive a clean electric-blue lowercase `b` rather than a block-art tile.
- The wide mark occupies `4x2` terminal cells; the compact mark occupies `2x1` cells.
- The mark never animates and never changes layout after capability detection.

## Type and color

The terminal controls the live application's font. Geist Mono is the recommended face because its restrained metrics match the approved design; the deterministic documentation preview declares Geist Mono first and falls back to other modern monospace faces.

| Token | Value | Use |
| --- | --- | --- |
| Accent | `#168BFF` | mark, selected rail, send action, live dot |
| Canvas | `#0B0E12` | transcript and root |
| Panel | `#151A21` | navigation, compact context, composer |
| Raised | `#1C232C` | incoming messages and invoked surfaces |
| Active | `#153352` | focused/open conversation |
| Outgoing | `#103A61` | outgoing messages |
| Divider | `#2A323C` | the single pane separator and quiet borders |
| Primary text | `#E8EDF3` | message and active text |
| Secondary text | `#7F8B99` | previews and low-priority state |

No gradient, decorative shadow glyph, ambient glow, animated logo, pane slide, shimmer, pulse, or idle render loop is allowed.

## Temporary surfaces

The command palette, contact form, and help are modal workspaces, not permanent furniture.

- `Ctrl+P` opens searchable contacts and actions without losing the current draft.
- `?` opens help for the area the user came from.
- `n` opens the contact form; its disclosure is the short, truthful `Stored locally.`
- Escape returns to the prior context.
- Compact variants replace the current pane instead of stacking another permanent layer over it.
- No idle row advertises the full shortcut map.

## No-send safety

1. Opening Alice only changes selection. It cannot alter the draft, insert `Alice`, create a message, or call the send path.
2. A newly opened conversation has an empty composer unless it has a genuine saved user draft.
3. Send requires an explicitly selected contact, a nonempty user-authored body, and an explicit send activation.
4. Help, palette, resize, contact switching, connection status, dismissal, and Escape never send.
5. Reconnect never silently resends `unknown` or `failed` messages.
6. Preview generation and automated smoke tests use fake or disabled transport and perform no external send.
7. Any real-world smoke send requires fresh human confirmation of the exact recipient and exact body immediately before activation.

## Acceptance checks

The deterministic UI suite must prove:

1. The active alias and connection state each appear exactly once at all four target sizes.
2. The actual mark is used on image-capable terminals, the clean text fallback is used for block-only terminals, and the wide header contains the sole connection state above one quiet separating rule.
3. The composer is generic and empty without a real draft; clicking its visible send action while empty performs zero sends.
4. Selected rows, message direction, unread state, connection state, and focus remain understandable without color alone.
5. All lines remain within terminal width and every target frame uses the exact terminal height.
6. Keyboard, mouse, resize, draft, Help, palette, contact, copy, hyperlink, scroll-preservation, and shutdown behavior survive the visual redesign.
7. Established conversations contain no `TO Alice`, recipient chip, name-bearing placeholder, duplicate connection copy, or permanent shortcut legend.
8. The checked-in preview is generated from the implemented renderer and contains no phone number or personal device name.
9. Preview and lifecycle verification perform no real send.
