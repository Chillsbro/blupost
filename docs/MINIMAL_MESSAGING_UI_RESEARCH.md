# Minimal Messaging UI Research

**Research date:** 2026-08-18

**Corpus:** 65 primary-source references: 38 messaging and message-handling interfaces, 14 terminal/TUI interfaces, and 13 first-party system or accessibility guidelines.

## Decision in one sentence

Blupost should render the selected conversation, its messages, and one empty composer; everything else should either communicate one unique piece of live state, perform one clear action, or stay off-screen until requested.

This is not a popularity ranking. It is a deliberately broad scan of strong or instructive messaging interfaces across mobile, desktop, web, and terminals. Every observation below comes from an official product page, first-party help/design documentation, or an official source repository. No secondary galleries or listicles were used.

## The strongest cross-product finding

Recipient selection and message composition are separate phases.

- Apple Messages, Google Messages, Signal, and Microsoft Teams show a recipient field only while creating a new conversation. Opening an existing conversation goes directly to its message field.
- Briar and Threema likewise make selecting a contact or chat the addressing action.
- SimpleX's terminal client goes further: after a connection is selected, typing text replies to that sender without repeating recipient syntax.

Therefore an open Alice conversation must not contain `TO Alice`, a recipient chip, a second `Alice` prompt, or a composer prefilled with `Alice`. The selection already answered “to whom?” The composer answers only “what?”

## Primary-source corpus

### A. Messaging interfaces on mobile, desktop, and web

| # | Interface and primary source | Observed lesson for a sparse messenger |
|---:|---|---|
| 1 | [Apple Messages — send a message on Mac](https://support.apple.com/en-au/guide/messages/icht35827/mac) | `To` is part of composing a new conversation. An existing conversation is selected first, then the user types in the message field at the bottom. Do not retain addressing UI after selection. |
| 2 | [Google Messages — send and receive messages](https://support.google.com/messages/answer/6080324?hl=en) | `To` appears under **Start chat**; an open conversation uses only the message box and Send. Route selection and message entry are distinct tasks. |
| 3 | [Signal — send a message](https://support.signal.org/hc/en-us/articles/360007060212-Send-a-message) | Compose opens the contact list, contact selection opens the text field, and Enter sends on desktop. The chosen conversation is sufficient recipient context. |
| 4 | [WhatsApp — chat filters](https://about.fb.com/news/2024/04/whatsapp-chat-filters/amp/) | The primary list begins with only All, Unread, and Groups, explicitly framed as quick and simple. Prefer a tiny set of high-value views over a permanent taxonomy bar. |
| 5 | [Telegram — chat folders](https://telegram.org/blog/folders?setln=en) | Folders appear when a chat list is long enough to need them, and Archive can be hidden. Organization is conditional, not an always-visible scaffold. |
| 6 | [Messenger — search for a conversation](https://www.facebook.com/help/messenger-app/226876201152398/) | Search lives at the top of Chats and a result opens the conversation. Search is an action over the list, not an extra field inside every open thread. |
| 7 | [Instagram Direct — cross-app messaging features](https://about.fb.com/news/2020/09/new-messaging-features-for-instagram/) | Replying to a particular message preserves context within the transcript. The same announcement also demonstrates a caution: themes, effects, reactions, and stickers can overwhelm the core exchange if treated as permanent chrome. |
| 8 | [Discord — display and message-density settings](https://discord.com/blog/making-discord-on-desktop-look-just-right-display-settings-to-ease-the-eyes) | Message density is independently adjustable, and Compact mode removes profile pictures. Avatars and generous spacing are optional presentation, not required message semantics. |
| 9 | [Slack — change message display](https://slack.com/help/articles/213893898-Change-how-messages-are-displayed/slack.com/) | Compact display removes member profile photos and reduces whitespace; formatting controls can also be hidden. Secondary chrome should be suppressible without harming messaging. |
| 10 | [Microsoft Teams Chat — send and read messages](https://support.microsoft.com/en-US/teams/chat/send-and-read-messages-in-microsoft-teams) | A new chat has a `To` field; an established chat is selected and composed into at the bottom. Advanced formatting stays behind the Format action until invoked. |
| 11 | [Google Chat — send a direct message](https://support.google.com/chat/answer/16059642) | Name or address entry belongs to **New chat**. An existing direct message uses the reply field, while draft state is shown beside the conversation in the list. Put state where it applies. |
| 12 | [Webex App — send a message](https://help.webex.com/article/jc7z88) | The user selects a person or space and then writes in the message area. A send failure appears beneath the affected message with Retry/Delete, keeping failure local and actionable. |
| 13 | [Element — the middle panel](https://docs.element.io/latest/element-support/quick-start-guide/the-middle-panel/) | The main panel is room header, timeline, and composer. Details use a secondary panel and message actions appear contextually. Preserve the transcript; reveal tools when requested. |
| 14 | [Mattermost — customize the channel sidebar](https://docs.mattermost.com/end-user-guide/preferences/customize-your-channel-sidebar.html) | Unread-only filtering, collapsible categories, and limits on visible direct messages make list density user- and state-driven. Do not force every possible conversation on screen. |
| 15 | [Zulip — getting started](https://zulip.com/help/getting-started-with-zulip) | Users can collapse uninteresting channels and jump to the next unread item by keyboard. Rich organization is useful for many-topic teams, but it should not burden a simple one-to-one view. |
| 16 | [Twist — welcome and core model](https://twist.com/help/articles/welcome-to-twist-Ndgp3sInM) | Threads and an inbox serve structured asynchronous work, while direct messages remain the lighter path. Do not import thread metadata into every private exchange. |
| 17 | [Rocket.Chat — layout](https://docs.rocket.chat/docs/layout) | Sidebar grouping, roles, and colors are configurable rather than universal. Its accessibility warning about custom colors is a reminder that decoration must not carry meaning alone. |
| 18 | [Nextcloud Talk — product interface](https://nextcloud.com/talk/) | A thread view can isolate only the selected thread “without distractions,” while conversation sorting and grouping live in the list. Focus mode means subtracting unrelated messages and controls. |
| 19 | [LINE — manage the Chats tab](https://help.line.me/line/smartphone/?contentId=20005810&lang=en) | Draft, pin, and sorting state is represented in the chat list. Conversation-management metadata belongs with the conversation row, not repeated in the transcript header and footer. |
| 20 | [Viber — chat knowledge base](https://help.viber.com/hc/en-us/articles/9423180947869-Chat-knowledge-base) | Draft and typing state appear in the chat list, while less-common actions are contextual. Show one compact state at its scope and keep actions out of the idle canvas. |
| 21 | [Beeper — inbox views](https://help.beeper.com/beeper-android-how-does-inbox-work?kb_language=en_US) | Minimal View shows only chat titles; Pro View adds unread count and network icon. Pinned chats can leave the main list, and Archive/Low Priority suppress noise. Minimalism can be a real information mode, not a skin. |
| 22 | [IRCCloud — product overview](https://www.irccloud.com/) | Public channels, private channels, and one-to-one conversations share a stable, synchronized conversation history. Transport persistence need not create extra panels inside the current conversation. |
| 23 | [Session — official documentation](https://docs.getsession.org/) | A privacy-heavy transport still presents familiar direct and group conversations across platforms. Protocol complexity should not leak into routine composition chrome. |
| 24 | [SimpleX Chat — user guide](https://simplex.chat/docs/guide/readme.html) | Connecting to a person is a deliberate new-chat action; after that, the chat behaves as the selected context. Complex identity and transport details remain outside ordinary message entry. |
| 25 | [Delta Chat — official FAQ](https://delta.chat/en/help) | Account and discovery mechanics are separated from ordinary conversations. A messenger can have unusual transport semantics without decorating each message with those mechanics. |
| 26 | [Wire — redesigned chat UI](https://wire.com/en/blog/wires-new-chat-ui-launched?hs_amp=true) | Received and sent messages use opposite sides to improve scanning. Direction can be encoded spatially without repeating `Alice` and `You` on every row. |
| 27 | [Threema Work — first steps](https://threema.ch/docs/work/threema_work_first_steps_ios_en.pdf) | **New Message** belongs to the chat overview; an existing chat exposes only context-relevant actions. Conversation creation and conversation use are separate surfaces. |
| 28 | [Briar — user manual](https://briarproject.org/manual/) | Tapping a contact name opens private messaging, and offline delivery is handled by the system. The selected contact is the destination; delivery caveats should be concise state, not repeated addressing. |
| 29 | [Jami — features by client](https://docs.jami.net/en_US/user/all-features-by-client.html) | Delivery/read receipts and typing indicators are discrete supported states. These belong to the affected message or conversation, not a generic decorative status dashboard. |
| 30 | [Olvid — latest features](https://olvid.io/faq/latest-features/) | Replying to a particular message and ephemeral controls are contextual operations. Specialized actions should appear at the message being acted on, not occupy the idle composer. |
| 31 | [Intercom Messenger — setup and customization](https://www.intercom.com/help/en/articles/6612589-set-up-and-customize-the-messenger) | The Messenger can bypass Home and launch directly into a Conversation. If the user's likely task is messaging, remove the intermediate surface rather than explaining it. |
| 32 | [Gmail — choose inbox density](https://support.google.com/a/users/answer/11339703?hl=en) | Default, Comfortable, and Compact vary spacing and whether attachment previews consume a row. Metadata and preview affordances are density choices, not baseline requirements. |
| 33 | [Outlook — change the message-list display](https://support.microsoft.com/en-us/office/change-how-the-message-list-is-displayed-in-outlook-57fe0cd8-e90b-4b1b-91e4-a0ba658c0042) | Compact list, conversation grouping, and alternate reading-pane positions let content receive the space. Layout should adapt by reallocation, not by squeezing all panes indefinitely. |
| 34 | [Thunderbird — Supernova main window](https://support.mozilla.org/en-US/kb/getting-started-thunderbird-main-window-supernova) | The tab bar appears only when two or more tabs exist and disappears when one remains. This is a strong conditional-chrome precedent: no state to navigate means no navigation chrome. |
| 35 | [Cinny — official repository](https://github.com/cinnyapp/cinny) | The project defines a simple, elegant Matrix interface as a core goal. Simplicity must be an acceptance property of structure and behavior, not decorative styling layered over every feature. |
| 36 | [Fractal — official GNOME app page](https://apps.gnome.org/Fractal/) | The Matrix client is designed for both large and small screens. Responsive conversation UI should preserve the transcript and composer while changing navigation form. |
| 37 | [FluffyChat — official repository](https://github.com/krille-chan/fluffychat) | Human-friendly QR contact flow hides raw Matrix identifiers. Show the human identity required for the task, not transport identifiers or redundant protocol labels. |
| 38 | [Halloy — single-pane mode](https://halloy.chat/guides/single-pane.html) | Single-pane mode replaces the current buffer instead of accumulating panes. A narrow or focus-first layout should switch conversations, not miniaturize a desktop dashboard. |

### B. Terminal chat and mail interfaces

The terminal subset is intentionally smaller. It is used for lessons about density, keyboard access, character budgets, resize behavior, and truthful state—not as the dominant aesthetic reference.

| # | Interface and primary source | Observed terminal lesson |
|---:|---|---|
| 39 | [WeeChat — official user guide](https://weechat.org/files/doc/stable/weechat_user.en.html) | The default anatomy is buffer list, title, status, input, and optional nick list, but every bar can be hidden and a bare display is supported. Peripheral regions are optional, not sacred. |
| 40 | [Irssi — official user interface guide](https://irssi.org/User-interface/) | One active-window indicator identifies where input goes, while activity is compressed into short window signals. One target indicator is enough; low-value metadata should truncate first. |
| 41 | [Profanity — basic UI guide](https://profanity-im.github.io/guide/070/basic.html) | The title identifies the active contact, followed by conversation, compact status, and input. Once a contact window is open, the user simply types—there is no persistent `To` field. |
| 42 | [Poezio — usage guide](https://doc.poez.io/usage.html) | Tab lists can be vertical or horizontal, and selecting a contact opens the one-to-one conversation. Navigation can change representation with available width while the current contact remains singular. |
| 43 | [nchat — official repository](https://github.com/d99kris/nchat) | Help bar, contact list, and top bar are independently toggleable; contact-list width is adjustable. Each piece of chrome must be optional because terminal space is task space. |
| 44 | [iamb — official window-layout guide](https://iamb.chat/layout/windows.html) | Splits are user-invoked, the current window can zoom full-screen, and modal keybindings carry power. Multi-pane complexity should be an action, not the default idle layout. |
| 45 | [gurk — official repository](https://github.com/boxdot/gurk-rs) | `Ctrl+P` opens channel selection, F1 opens help, Escape closes temporary UI, and Enter sends. Navigation and instruction surfaces work as overlays rather than permanent ribbons. |
| 46 | [senpai — official source repository](https://git.sr.ht/~delthas/senpai) | The client centers the current IRC history and input while relying on server history instead of local log-management UI. Operational machinery does not need a visual surface. |
| 47 | [SimpleX terminal app — CLI guide](https://simplex.chat/docs/cli.html) | Once a connection is selected, the terminal can auto-populate the recipient context and the user “just type[s] messages to reply.” This is direct evidence against repeating a recipient in the draft. |
| 48 | [aerc — official site](https://aerc-mail.org/) | Composition and incoming activity remain asynchronous, while advanced behavior is command-driven. A live client can remain responsive without a dashboard of persistent controls. |
| 49 | [NeoMutt — official guide](https://neomutt.org/guide/) | Status lines, sidebars, headers, index fields, and colors are all configurable. Information density should be chosen and suppressible; a sidebar is not required simply because one exists. |
| 50 | [alot — official documentation](https://alot.readthedocs.io/en/latest/) | A full mail user agent exposes power through a command prompt and bindings. Rare actions do not need a visible button or instruction line at all times. |
| 51 | [catgirl — official manual](https://git.causal.agency/catgirl/about/catgirl.1) | The interface is a status line, chat area, and input line; activity and unread state use compact signals and whitespace. Three purposeful regions can carry a complete chat experience. |
| 52 | [Bubble Tea — first-party chat example](https://github.com/charmbracelet/bubbletea/blob/main/examples/chat/main.go) | The complete resizable example is a transcript viewport and one textarea with a short placeholder. No footer, logo, sidebar, or redundant addressing is required for the core interaction. |

### C. First-party system and accessibility guidance

| # | System and primary source | Applicable design constraint |
|---:|---|---|
| 53 | [Apple Human Interface Guidelines — layout](https://developer.apple.com/design/human-interface-guidelines/layout) | Give the most important content most of the space, move secondary content elsewhere, and adapt rather than merely scale. The transcript is the dominant content. |
| 54 | [Apple Human Interface Guidelines — sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) | Sidebars consume substantial space, should be hideable where appropriate, and use short labels without unnecessary words. A contact rail must earn every column. |
| 55 | [Material Design 3 — lists](https://m3.material.io/components/lists/guidelines) | List items organize related text and actions in a repeated structure. A conversation row should have a stable hierarchy, not a pile of unrelated chips and badges. |
| 56 | [Material Design 3 — navigation drawer](https://m3.material.io/components/navigation-drawer/guidelines) | Navigation drawers are one navigation form among several and may be modal. Navigation can move off-canvas at narrow widths instead of remaining a squeezed rail. |
| 57 | [GNOME HIG — adaptiveness](https://developer.gnome.org/hig/guidelines/adaptive.html) | Design from the smallest size, avoid layouts made of many small panes, and reposition or hide elements at breakpoints. A 40-column screen is a distinct composition, not a shrunken 120-column screen. |
| 58 | [GNOME HIG — utility panes](https://developer.gnome.org/hig/patterns/containers/utility-panes.html) | Secondary panes can be transient and overlap content. Help, details, and palettes should appear on demand and then fully leave the layout. |
| 59 | [Fluent 2 — layout](https://fluent2.microsoft.design/layout) | Spacing can create groups without enclosing lines, and responsive layouts may show, hide, or rearchitect regions. Prefer whitespace and subtraction to nested boxes. |
| 60 | [Fluent 2 — accessibility](https://fluent2.microsoft.design/accessibility) | Clear structure, logical focus, and reflow are required; content should communicate something new rather than repeat itself. Redundant copy is both clutter and cognitive load. |
| 61 | [Carbon — notification usage](https://carbondesignsystem.com/components/notification/usage/) | Feedback builds trust, but notifications are disruptive and should be used sparingly; inline notification fits task-local state. Send failure belongs beside the failed message. |
| 62 | [WCAG 2.2 — Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | Content and function must survive narrow reflow without two-dimensional scrolling. Essential state cannot disappear merely because columns do. |
| 63 | [WCAG 2.2 — Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | A status change that does not take focus still needs a programmatic role or property so assistive technology can announce it. Quiet visuals cannot mean silent accessibility. |
| 64 | [WCAG 2.2 — Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) | Color cannot be the only visual means of conveying information or an action. Selection, connection, unread, and send state each need a non-color signal. |
| 65 | [WAI-ARIA Authoring Practices — modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | A modal moves focus inside, contains its focus sequence, closes with Escape, and returns focus logically. Help and command palettes must behave as real temporary modes. |

## What the corpus says repeatedly

### 1. Conversation identity replaces recipient UI

Selecting a contact is an action with a durable result: the active conversation. The interface should show that result once. It should not restate it as a `TO` label, a chip, a placeholder containing the name, and a prefilled draft.

At a wide viewport where the selected row remains visible, that selected row can be the sole identity label. At a narrow viewport where the list is gone, a single compact header such as `‹ Alice` replaces it. The same name must not appear twice merely to make a panel look finished.

### 2. One surface dominates

Across successful chat interfaces the transcript receives the area; navigation and composition support it. The recurring minimal skeleton is:

```text
context (one line, only when needed)
messages
composer (empty until the user writes)
```

Two panes can be useful on a wide screen, but nested cards, branded mastheads, decorative status panels, permanent help rows, and a second composer frame do not add messaging capability.

### 3. State is local, singular, and replace-in-place

- Connection state occupies one stable slot and changes there: `connecting` replaces `connected`; it does not add a banner, badge, footer message, and animated dot.
- Send state belongs to the outgoing message: pending, sent, unknown, or failed. Failure carries its retry action there.
- Draft/unread state belongs to the conversation row.
- Focus belongs to the focused control and must have a non-color treatment.

The user should never have to reconcile two copies of “connected” or infer which of two delivery labels is authoritative.

### 4. Secondary power is invoked, not wallpapered

Slack, Telegram, Thunderbird, Element, WeeChat, nchat, gurk, iamb, and alot all provide evidence for conditional or command-driven power. Help, contact creation, search, formatting, message actions, details, and layout controls can remain fully accessible without living in a shortcut ribbon.

A command palette is valuable precisely because it lets the idle view stop advertising every command.

### 5. Responsive design subtracts in a defined order

The correct response to less space is not smaller boxes and more truncation. Suppress, in order:

1. message previews and optional timestamps;
2. secondary list metadata;
3. the persistent conversation list, replacing it with a separate list view;
4. nonessential separators and padding.

Never suppress the active identity, message text, composer, connection truth, actionable send failure, or route back to conversations.

### 6. Whitespace is useful; ornamental whitespace is not

Small gaps can group related text more cheaply than borders. Large blank brand zones, padded chips, boxed labels, and several rows of fixed chrome steal history from the conversation. Empty space should improve scanning or accept future messages, not display a mood board.

## Anti-patterns: the forms of messaging “slop” to reject

| Failure mode | Why it fails | Required correction |
|---|---|---|
| `TO Alice` inside an already selected Alice conversation | Repeats resolved state and makes the composer resemble a new-message form. | Remove the entire row. Identity appears once. |
| Composer prefilled with `Alice` or another recipient token | Corrupts the message draft, risks accidental send, and answers the wrong question. | Composer initializes to an empty user-authored body. |
| `Alice` in the selected list row, detail header, `TO` row, and placeholder | Four copies have no four distinct meanings. | Render identity once per viewport composition. |
| Persistent `YOU` / `ALICE` labels on every one-to-one message | Repeats facts already conveyed by direction and grouping. | Use stable incoming/outgoing alignment plus a non-color direction cue; label only where ambiguity genuinely exists. |
| Large ASCII logo, framed mark, wordmark, slogan, ornamental rails, flourishes, or brand block in the running app | Consumes the scarcest resource without conveying state or enabling action. | The approved product exception is one small unframed asset mark in the upper-left; keep every other brand treatment outside the working canvas. |
| Pill, chip, dot, and text all representing one state | Multiplies visual objects without multiplying information. | Choose one compact representation with an accessible text alternative. |
| Connection state repeated in header, body banner, and footer | Creates competing authorities and constant visual noise. | One replace-in-place connection slot. |
| Persistent shortcut ribbon (`N new · ? help · Ctrl-P palette …`) | Turns documentation into wallpaper and steals a row at every size. | Put complete shortcuts in Help; expose commands through the palette. |
| Always-visible formatting and attachment controls | Optimizes the idle state for uncommon actions. | Reveal them on focus, overflow, palette, or message context. |
| Box around every region or message | Produces false hierarchy and makes whitespace unusable. | Use spacing, alignment, and at most one structural separator. |
| Several permanent surfaces for contacts, activity, status, details, and help | Shrinks the only surface the user came to read. | Wide: at most list plus conversation. Narrow: one surface at a time. |
| Overexplained empty states | Forces experienced users to reread instructions and makes the screen feel busy before content exists. | One short next action, e.g. `No conversations` with an `Add contact` action. |
| Decorative badges and rails on selected rows | Selection, unread, and presence become visually conflated. | One focus/selection treatment and at most one state token per row. |
| Idle shimmer, pulsing dots, rotating glyphs, or atmospheric motion | Implies work or urgency where none exists and competes with real state transitions. | No idle motion; animate only a bounded, truthful transition if motion is supported. |
| Desktop panes squeezed unchanged into 60×18 or 40×12 | Destroys legibility and hides essential actions behind truncation. | Switch to a single-surface composition at the breakpoint. |
| Failure reported only in a generic status bar | Separates the problem from the message and makes retry ambiguous. | Attach failed/unknown state and retry to the exact outgoing message. |
| Color-only selection, presence, or send state | Excludes color-blind and non-color terminals and fails under limited palettes. | Add position, weight, underline, glyph, or text semantics. |

## Blupost minimal-redesign acceptance contract

The research below remains the evidence baseline. The later approved implementation contract in [`TUI_VISUAL_RESEARCH.md`](TUI_VISUAL_RESEARCH.md) makes one deliberate exception: a single unframed electric-blue mark anchors the upper-left, while wordmarks, slogans, redundant recipient UI, and footer key legends remain excluded.

### Non-negotiable information invariant

> Every persistent character must communicate unique current state, perform a reachable action, or belong to the one approved upper-left mark.

For any idle-screen character or glyph, the reviewer can ask “what unique state or action disappears if this is removed?” If the answer is “balance,” “vibe,” “reinforcement,” or information already shown elsewhere, remove it. Branding is limited to the one approved mark. Spacing is allowed only when it creates a legible group or input target.

### Idle screen anatomy

1. The working view contains only conversation navigation when space permits, the active transcript, and the composer.
2. There is exactly one transparent-background mark in the upper-left, with no product wordmark, slogan, ornamental top bar, card stack, activity panel, or shortcut footer.
3. There is at most one structural separator between a visible conversation list and transcript. Messages may use one quiet incoming surface and one quiet outgoing surface; they do not become nested cards.
4. The active conversation identity appears exactly once in the current viewport composition:
   - when the selected row remains visible, that row is the identity;
   - when the list is hidden, one compact header contains the identity and route back;
   - no second title, `TO` row, recipient chip, or name-bearing placeholder exists.
5. The composer is one quiet input region. Its initial value is empty. Its optional empty hint is generic (`Message`), disappears on input, and never contains the recipient name.
6. One-to-one messages do not repeat `YOU` and the contact name on every row. Incoming and outgoing groups use stable position plus a non-color direction cue. Identity labels appear only if a transcript can actually contain ambiguous authors.
7. Timestamps are grouped, requested, or shown only when they resolve meaningful chronology; they are not stamped onto every short exchange by default.

### State truth and locality

1. Connection state has exactly one stable slot. `connecting`, `connected`, and `offline` replace one another in that slot; no duplicate dot, pill, banner, footer copy, or animation is allowed.
2. The steady state does not pulse or animate. A bounded transition may animate only while an actual transition is occurring and must have a nonanimated fallback.
3. Each outgoing message owns its send state. The state model must distinguish at least `sending`, `sent`, `unknown`, and `failed`; the UI must never claim `sent` without the engine evidence required for that state.
4. Send state appears once, adjacent to its message. Compact glyphs may be used (`…`, `✓`, `?`, `!`) only when an accessible text name is exposed and a text/glyph-safe terminal fallback exists.
5. `failed` and `unknown` are visually distinct without color. Retry acts on the exact message and is explicit; neither state silently becomes a resend.
6. Draft and unread indicators appear only on the applicable conversation row. Unread wins the compact metadata slot; a single latest-message preview may occupy the row's second line when space permits.
7. Status updates that do not move focus are announced through the platform's status semantics where available; otherwise the focused message exposes the same textual state on inspection.

### Actions without permanent instruction noise

1. Add Contact remains reachable by keyboard (`n` or the final mapped equivalent), from the command palette, and by mouse through one visible `+` action in the conversation-list view or its empty state.
2. Help remains reachable by `?` and from the mouse-operable command palette. It opens as an overlay or replacement surface, never a persistent ribbon.
3. The command palette remains keyboard- and mouse-operable. It opens on request, filters actions, and fully disappears on dismissal.
4. Help and palette follow modal focus behavior: focus enters, Tab order stays within, Escape closes, and focus returns to the invoking control or surface.
5. Search, formatting, attachment, details, and message actions remain off the idle canvas until invoked or applicable.
6. No permanent row lists shortcuts. The empty state may contain one brief next action, not a tutorial paragraph.

### Responsive composition

All four target sizes are product surfaces, not screenshot crops. No target may require horizontal scrolling for essential content.

| Viewport | Required composition |
|---|---|
| **120×34** | Two panes are permitted: a restrained conversation list and a dominant transcript. The selected list row is the sole recipient identity; do not repeat a detail title. The list may show one secondary value per row. Place the sole connection state beside the approved mark, above one quiet rule; no global masthead or status footer. |
| **80×24** | Two panes remain while names, one-line previews, and readable messages fit. Recipient identity still appears once. |
| **60×18** | Use one surface at a time: conversation list or active chat. Chat has one compact context line (mark, `‹ Alice`, and the single connection-state slot), transcript, and composer. Palette/help replace or overlay the body. |
| **40×12** | One surface only. Reserve one top line for route/context/state, one bottom line for the composer, and all remaining usable lines for messages. Long text wraps; nonessential metadata disappears. Overlays become full-screen replacements and Escape returns exactly where the user was. |

At every size:

- the latest readable message and focused composer remain visible together when composing;
- resize preserves selected conversation, draft, scroll anchor, focus, and unsent text;
- clipped text uses Unicode-display-width-safe measurement and never corrupts adjacent columns;
- essential actions remain reachable by both keyboard and mouse, even when their desktop placement changes;
- status text replaces prior status in place instead of appending another row.

### Visual and motion budget

1. Outside list rows and messages, the idle app may consume no more than one context row and one composer region at 60×18 and 40×12; the composer frame collapses before tiny content is clipped.
2. No ASCII art, decorative divider copy, gradient simulation, drop-shadow glyphs, ornamental brackets, or filler dots.
3. Selection uses one coordinated treatment: a quiet full-row fill plus one leading rail. Unread remains separate message state rather than ornamental selection chrome.
4. Unread, draft, focus, connection, and send state each remain distinguishable in monochrome. Color may reinforce but never define them.
5. Motion is absent while idle, reduced-motion settings are honored, and no animation shifts the composer or transcript.

### Keyboard, mouse, and accessibility

1. Full operation is possible without a mouse: conversation navigation, open/back, compose, send, add contact, palette, help, retry, and dismissal.
2. Mouse targets exist for the same operations. Clicking a contact selects it; clicking the composer focuses it; clicking Add Contact, palette items, Help, Retry, and Back performs exactly that action.
3. Focus is visible without color and never gets stranded in a hidden pane after resize.
4. Text has sufficient contrast under supported themes; low-color and ASCII-safe fallbacks preserve meaning.
5. Message direction, selection, connection, unread, and send state are not communicated by color alone.
6. Live status is announced without unsolicited focus movement where the rendering/accessibility stack supports it.
7. Narrow reflow preserves all essential content and function; wrapping is preferred to truncating message bodies.

### No-send safety

1. Opening or clicking Alice only changes selection. It must not alter the draft, insert `Alice`, create a message, or call the send path.
2. A newly opened conversation always has an empty composer unless it has a genuine previously saved user draft.
3. Send requires all three conditions: an explicitly selected contact, a nonempty user-authored body, and an explicit send activation from the focused composer or Send action.
4. Opening Help, opening the palette, resizing, switching contacts, clicking status, dismissing an overlay, or pressing Escape never sends.
5. Reconnect does not silently resend `unknown` or `failed` messages. Retry is explicit and message-specific.
6. UI snapshots, design review, and automated smoke tests use a fake/disabled transport and assert zero external sends unless a test is explicitly exercising a mocked send.
7. Any real-world smoke send requires fresh human confirmation of the exact recipient and exact body immediately before activation.

### Verification gate

Acceptance requires automated or recorded evidence for all of the following:

- snapshots at 120×34, 80×24, 60×18, and 40×12 for conversation list, selected conversation, Help, palette, Add Contact, connecting, connected, offline, sending, sent, unknown, and failed;
- keyboard and mouse paths for selection, back, compose, send against a fake transport, Add Contact, Help, palette, retry, and Escape dismissal;
- resize tests that preserve focus, selection, scroll anchor, and an unsent draft across all four sizes;
- monochrome and reduced-motion review;
- assertions that an established Alice chat contains no `TO Alice`, no recipient chip, no recipient-prefilled body, no duplicate connection copy, and no persistent shortcut legend;
- an assertion that selecting Alice generates zero send attempts;
- an assertion that an empty composer cannot send;
- an assertion that failed/unknown messages are never automatically retried;
- a final character audit of every idle row against the unique-state-or-action invariant.

## Practical redesign target

The desired personality is operational minimalism with one restrained brand anchor: the conversation owns the screen, recipient selection is already resolved, the empty composer waits for the user's words, and every exceptional state appears once at the place where the user can understand or act on it.

Distinctiveness comes from the electric-blue/dark-grey hierarchy, excellent type rhythm, reliable focus behavior, fast keyboard flow, truthful state, and disciplined subtraction—not from adding more chrome.
