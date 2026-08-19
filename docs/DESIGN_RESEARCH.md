# Blupost interface design research

**Date:** 2026-08-17

**Status:** Proposed design direction; no implementation changes are authorized by this document

**Scope:** Information architecture, interaction design, visual language, accessibility, trust, and an implementation sequence for the Bun/OpenTUI interface

**Evidence labels:** Descriptions of Apple, exemplar TUIs, framework behavior, and standards are source-backed observations. The proposed direction, wireframes, breakpoints, priorities, and every “should” statement are **design synthesis/inference**, not a claim that one objectively best TUI exists.

## Executive decision

Blupost should not imitate Apple Messages pixel for pixel. It should apply Apple's design discipline to a terminal-native messaging client.

The recommended direction is **Quiet Signal**:

> The conversation feels human. The transport feels quiet, honest, and dependable.

That means:

- The active conversation and composer dominate the screen; branding and Bluetooth machinery recede.
- Wide terminals use a persistent conversation list and detail pane. Narrow terminals use one pane at a time instead of squeezing or vertically stacking two incomplete panes.
- Messages read like a calm transcript, not a wall of decorated ASCII bubbles.
- The active recipient, connection state, send outcome, and preserved draft are always unambiguous.
- Core app operation is keyboard-complete, mouse operation is additive, and shortcuts explain themselves in context.
- Color reinforces structure but never carries meaning by itself.
- The interface is almost motionless. It animates only to show real ongoing work.
- Uncertainty is stated plainly. In particular, `check phone` must never look like either success or failure and must never offer an implicit retry.

The companion [Signal b identity and motion direction](BRAND_MOTION.md) defines a lowercase `b` with a speech tail trailing from its lower-left bowl, the wordmark, and one bounded tail-reveal animation for the redesign.

This is the path to an interface that feels Apple-like in care, hierarchy, restraint, and trust while remaining recognizably Linux, open source, and terminal native.

## Product truth that the design must preserve

The redesign starts from Blupost's actual contract, not from a generic chat mockup. The current [README](../README.md) and [TUI implementation](../src/tui/createBlupostTui.ts) establish these non-negotiable facts:

- Blupost is a nearby, session-based, one-to-one messaging client using an iPhone over Bluetooth MAP.
- Contacts persist locally. Messages, unread counts, and drafts exist only for the current process.
- The session retains at most 500 messages across all threads.
- There is no synchronized iPhone history, group messaging, attachments, reactions, typing indicators, or dependable delivery/read receipt model.
- Reconnection may retry the connection, but Blupost never retries a message automatically.
- A transfer can end in an indeterminate `check phone` state when the runtime cannot prove whether the phone completed it.
- Message bodies must stay out of ordinary logs and diagnostics.
- Selecting text deliberately copies only that selection; HTTP(S) links use terminal hyperlink behavior.
- The primary interface must work with both keyboard and mouse across capable terminals. Kitty enhancements must have portable fallbacks.

These constraints are a design advantage. Blupost can be far simpler than a general-purpose messaging app if it presents its limits as a coherent, trustworthy experience instead of apologizing for them.

### Current-tree audit

A direct audit of the current implementation and deterministic render fixtures identifies concrete redesign pressure:

- At `96x24`, the main experience is divided into three rounded frames: conversation list, transcript, and composer. Repeated `them`/`you` prefixes and the frames compete with the message bodies for attention.
- Thread items reserve two rows but currently render one line, leaving every second row visually empty without adding information.
- The footer permanently displays `Session-only · N / 500 messages`, giving an implementation limit the same persistent prominence as actionable status.
- At `60x20`, the six-row stacked sidebar plus header, composer, borders, margins, and footer leave only about five transcript rows. The app remains technically present but the conversation no longer feels primary.
- Against the hard-coded `#071117` background, current measured contrast ratios are approximately `17.24:1` for primary text, `7.45:1` for muted text, and `10.84:1` for cyan. Those are strong. The `faint` token is only `3.69:1`; the border and soft-border tokens are about `2.17:1` and `1.49:1`. W3C's web-oriented benchmarks are not a TUI conformance claim, but they make the hierarchy problem measurable: faint explanatory copy misses the ordinary-text `4.5:1` target, and subtle structural edges may disappear on different displays ([WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)).

This audit supports a structural redesign before a palette refresh: reclaim vertical space, stop rendering empty row height, reduce frames and repeated metadata, and move durable state to the object it describes.

## Research method and source selection

This review uses primary sources only:

- Apple's Human Interface Guidelines and official Apple design sessions.
- Official documentation, repositories, and maintained examples for Lazygit, K9s, GitUI, Helix, Telescope, Charm's Bubble Tea/Bubbles, and OpenTUI.
- First-party standards and specifications from W3C, Unicode, ncurses, Kitty, GNOME, and the `NO_COLOR` project.

The TUI projects are not presented as an objective popularity ranking. They were selected because their official materials provide primary evidence in five criteria relevant to Blupost: **clarity, discoverability, responsiveness, feedback, and terminal-native capability**. Concretely, that includes pane navigation, context-sensitive help, adaptive density, command/filter surfaces, focus, theming, text input, and capability negotiation.

The synthesis distinguishes sourced observations from design recommendations. A pattern appearing in another app is evidence that it can work in a terminal; it is not a reason to transplant that app's complexity into Blupost.

## What Apple design contributes

### Purpose before appearance

Apple's current design principles frame design as intentional prioritization. The official session distinguishes simplicity from visual minimalism: hiding everything can increase friction, while a small amount of well-placed context can make an interface simpler. It also ties clarity to hierarchy built with order, spacing, and contrast ([Principles of great design, WWDC26](https://developer.apple.com/videos/play/wwdc2026/250/)).

For Blupost, the purpose is not “manage Bluetooth” or “show a terminal dashboard.” It is:

1. Know who the conversation is with.
2. Read what happened in this session.
3. Write and deliberately send the next message.
4. Trust what Blupost says about the result.

Every persistent element must serve one of those jobs. The global message counter, Bluetooth detail, branding, decorative frame, and shortcut catalog are secondary. They can remain available without competing with the conversation.

Apple's design-foundations session proposes three practical orientation questions: where am I, what can I do, and where can I go next. It also recommends organizing information before styling, placing actions in the context where they apply, and using progressive disclosure for secondary detail ([Design foundations from idea to interface, WWDC25](https://developer.apple.com/videos/play/wwdc2025/359/)). Blupost should use those questions as the review rubric for every state.

### Hierarchy through restraint

Apple's HIG describes hierarchy, harmony, and consistency as current top-level principles ([Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines)). Its typography guidance recommends a small typographic vocabulary, strong legibility, and weight/color changes that preserve relative hierarchy ([Typography](https://developer.apple.com/design/human-interface-guidelines/typography)).

A TUI cannot change point size reliably; the terminal owns the font. The correct translation is:

- Full-contrast text for message bodies and the active recipient.
- Bold or bright text for the current title and primary action.
- Muted text for stable metadata.
- Spacing and alignment before borders.
- Sentence case instead of pervasive uppercase.
- One brand accent, then semantic warning/error colors only where needed.

The current nested rounded borders and repeated cyan treatment give navigation, transcript, composer, and controls similar visual weight. Quiet Signal should remove most of that chrome. A single divider, selected-row treatment, and composer boundary are enough to establish structure.

### Adaptive navigation, not compressed navigation

Apple recommends split views for list/detail hierarchies when space permits, with persistent selection so the relationship between panes remains clear. It specifically says compact environments should not force multiple narrow panes and that layouts need deliberate behavior across widths ([Split views](https://developer.apple.com/design/human-interface-guidelines/split-views)). Sidebars consume meaningful space and should give way to a more compact navigation model when necessary ([Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)).

That maps directly to Blupost:

- **Wide:** conversation list on the left, active conversation on the right.
- **Narrow:** conversation list *or* active conversation, never both stacked as permanent regions.
- **Short:** remove secondary metadata and help hints before sacrificing transcript or composer usability.

This is the most important structural change. The current narrow layout stacks a six-line thread area over the conversation. That preserves both objects technically, but neither gets enough room to feel primary.

### Apple Messages as a product reference, not a template

Apple's current Messages user guide documents a durable desktop flow: select a conversation in the sidebar, read the transcript in the detail area, write in the field at the bottom, and press Return to send ([Send a message on Mac](https://support.apple.com/en-au/guide/messages/icht35827/mac)). Quiet Signal borrows that stable list/detail/composer model because it matches Blupost's core task. It does **not** borrow Messages' literal visuals or imply support for its history, groups, attachments, reactions, replies, editing, effects, cloud services, encryption model, or delivery/read behavior.

### Content-first conversation presentation

Apple describes lists as a familiar, efficient way to scan structured, text-heavy information ([Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)). It also explicitly recommends making useful displayed text selectable ([Text views](https://developer.apple.com/design/human-interface-guidelines/text-views)). Those principles matter more to Blupost than the visual shape of an iMessage bubble.

The transcript should therefore use clean message blocks with selective metadata:

- Consecutive messages from the same direction form a visual group.
- Sender labels appear at group boundaries, not before every body.
- Incoming and outgoing groups differ through alignment/indentation plus a textual or glyph cue, not hue alone.
- Message text remains high contrast and selectable.
- Links are underlined in addition to being colored.
- Send state sits next to the affected outgoing message, never only in a global footer.

This is not a literal Messages clone. There should be no elaborate box-drawing speech tails, simulated glass, or blue/green transport claims.

### A composer that explains itself

Apple distinguishes small text fields from multiline text views and recommends labels or hints that remain comprehensible after placeholder text disappears ([Text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields), [Text views](https://developer.apple.com/design/human-interface-guidelines/text-views)). It recommends giving the most likely action the strongest treatment and using concise verb-based labels ([Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)).

For Blupost:

- The composer remains anchored at the bottom of the conversation.
- Its label includes the recipient when space permits: `Message Alice`.
- It grows from one line to a bounded maximum instead of permanently reserving four rows.
- `Enter send · Shift+Enter newline` appears at the point of use until it is no longer useful at very small heights.
- `Send` is the only dominant action in the conversation.
- When disconnected, the composer explains that the draft is preserved and nothing will queue for later delivery.
- A send in flight disables only the send action; the user can continue preparing a later draft if the current engine behavior supports it.

### Feedback in proportion to importance

Apple recommends passive status for ongoing state, feedback near the action or object it describes, and disruptive alerts only for important, actionable situations ([Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback), [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)). It recommends accurate, consistently placed progress indicators and recovery guidance if progress stalls ([Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)). Error writing should be direct, blame-free, close to the problem, and clear about what can be done next ([Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).

Blupost needs three different feedback locations:

| Kind | Placement | Examples |
|---|---|---|
| Durable system state | Conversation header | `● Connected · iPhone`, `○ Disconnected · Reconnect` |
| Object-specific outcome | The affected message or form field | `Sending…`, `Sent`, `Failed`, `? Check phone`; invalid alias/number |
| Minor confirmation | Footer notice area | `Selection copied`, `Contact saved` |

A general footer must not be the only place an error appears, because snapshots and unrelated operations can replace it. Critical or ambiguous state should persist until the underlying condition changes or the user dismisses/addresses it.

### Discoverability without permanent clutter

Apple's discoverability guidance recommends visible essential actions, words when symbols are ambiguous, contextual teaching, and hidden gestures only as accelerators with visible alternatives ([Discoverable design, WWDC21](https://developer.apple.com/videos/play/wwdc2021/10126/)).

For Blupost, this means:

- A short context keybar shows only the commands relevant to the focused region.
- `?` opens the complete help surface for the current context.
- Every mouse action has a keyboard route.
- Every shortcut also has a readable action name somewhere in help.
- The interface does not require an onboarding tour.
- The first empty state teaches the next action in one or two lines.

### Semantic color and accessible redundancy

Apple recommends consistent semantic use of color, light/dark and increased-contrast testing, and additional shape or text whenever color communicates state ([Color](https://developer.apple.com/design/human-interface-guidelines/color)). Its accessibility guidance similarly says interfaces should be perceivable through more than one cue and cites 4.5:1 as a useful minimum contrast target for ordinary text ([Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).

Quiet Signal should use semantic tokens rather than a collection of attractive hex values:

- `surface`
- `surfaceRaised`
- `textPrimary`
- `textSecondary`
- `textDisabled`
- `accent`
- `selection`
- `success`
- `warning`
- `danger`
- `focus`
- `divider`

Every state also gets a word or distinct glyph: `● Connected`, `○ Disconnected`, `! Failed`, `? Check phone`. Incoming/outgoing direction gets layout plus a label/marker. Links get underline plus accent color. Focus gets a persistent border, reverse-video row, or caret rather than color alone.

### Motion as truthful feedback only

Apple says custom motion should be purposeful, brief, cancelable, and never the sole way to communicate information ([Motion](https://developer.apple.com/design/human-interface-guidelines/motion)). The HIG also warns about automatic and repetitive motion for accessibility ([Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).

There is no dependable terminal-wide equivalent of Apple's Reduce Motion setting. Blupost also has an existing product constraint against user-facing motion controls. The safest translation is not another preference; it is an almost motionless interface:

- Keep a restrained activity glyph for a real connect or send operation.
- Remove startup fades, pane slides, transcript opacity flashes, and continuous decorative pulses.
- Make every animated state completely understandable as a static frame.
- Stop animation immediately when the operation ends.
- Preserve the current non-TTY behavior that renders final frames directly.

### Privacy as contextual truth

Apple's privacy guidance emphasizes transparency about what data or resources are needed and protecting the data people allow an app to access ([Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy)). Blupost's privacy boundary is unusual enough that it deserves concise, contextual explanation:

- The initial empty transcript says that messages are session-only and disappear when Blupost exits.
- The add-contact form says `Saved locally` near the save action.
- Clipboard confirmation appears only after explicit selection.
- The active recipient remains visible whenever the composer is focused.
- The UI never claims end-to-end encryption, Apple Account access, history sync, or delivery/read receipts.
- `check phone` says exactly why the outcome is uncertain and never presents a one-key resend.

The permanent footer does not need to repeat `Session-only · n / 500` at all times. The cap can remain in a low-priority session detail/help surface, while the session-only boundary appears prominently when it matters: startup, empty state, and exit/help documentation.

## What should not be translated from Apple

Apple's platform components are designed for graphical surfaces, pointer/touch input, platform fonts, accessibility APIs, and dynamic materials. Several visual signatures would become noisy imitation in ANSI cells.

Do **not** copy:

- Liquid Glass, blur, translucency, faux depth, or shadow simulation. Apple presents these as a system material and navigation layer, not a decorative skin ([Meet Liquid Glass, WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/)).
- Pixel-for-pixel Messages bubbles, bubble tails, or Apple's blue/green semantics.
- Bottom tab bars designed around thumb reach.
- SF Symbols or an icon font dependency.
- Apple font names, point sizes, corner radii, or touch target numbers as terminal measurements.
- Gesture-only actions, hover-only explanations, or icon-only critical controls.
- Decorative animation intended to mimic spring physics.

Translate qualities, not assets:

| Apple quality | Terminal-native translation | Rejected imitation |
|---|---|---|
| Clear hierarchy | Contrast, spacing, alignment, stable regions | More rounded frames |
| Adaptive split view | List/detail wide; one-pane stack narrow | Two squeezed panes |
| Semantic colors | Role-based palette with terminal fallbacks | Apple's literal blue palette |
| Dynamic Type | Reflow when the user changes terminal font/size | Trying to control terminal font size |
| Familiar controls | Arrow/Tab/Enter/Escape and visible labels | Touch gestures in keyboard clothing |
| Material separation | One divider or background role | ANSI “glass” and simulated shadows |
| Delight | Fast, precise, forgiving behavior | Confetti, shimmer, or ornamental glyphs |

## What exemplary TUIs contribute

### Source matrix

| Project | Relevant first-party evidence | Lesson for Blupost |
|---|---|---|
| Lazygit | The official config exposes a bottom line with useful keybindings, panel jump labels, and normal/half/full screen modes; `?` opens a keybinding menu ([configuration](https://github.com/jesseduffield/lazygit/blob/master/docs/Config.md), [keybindings](https://github.com/jesseduffield/lazygit/blob/master/docs/keybindings/Keybindings_en.md)) | Keep a small contextual keybar, full help on demand, and a way for content to claim more space. |
| GitUI | Its README explicitly calls out context-based help and a responsive terminal UI; default navigation begins with arrow keys while bindings remain customizable ([README](https://github.com/gitui-org/gitui), [key configuration](https://github.com/gitui-org/gitui/blob/master/KEY_CONFIG.md)) | Prefer familiar keys first, expose help in context, and treat resizing as a first-class state change. |
| K9s | `?` shows active mnemonics, `/` filters, `:` enters command navigation, and Escape leaves modes. Its docs explicitly distinguish a delete binding with confirmation from a kill binding with no confirmation ([commands](https://k9scli.io/topics/commands/)). It also supports wide-only columns and options to disable mouse, icons, header, logo, or crumbs ([custom views](https://k9scli.io/topics/columns/), [configuration](https://k9scli.io/topics/config/)) | Borrow progressive disclosure and responsive subtraction. Do not inherit K9s's operational density or use a hidden, immediate shortcut for a high-consequence messaging action. |
| Helix | Its official keymap uses explicit focus/mode layers and a command palette; its statusline has left/center/right roles and a stable progress location ([keymap](https://docs.helix-editor.com/keymap.html), [editor configuration](https://docs.helix-editor.com/editor.html)). Theme scopes describe semantic UI roles such as selected menu item, inactive statusline, selection, warning, and error ([themes](https://docs.helix-editor.com/themes.html)) | Make current focus and state visible. Centralize semantic styling. Avoid adopting a modal editor grammar for a simple messenger. |
| Telescope | The picker is organized around prompt, results, preview, and a contextual mappings display available with `?`/`Ctrl-/` ([official README](https://github.com/nvim-telescope/telescope.nvim)) | A focused filter/help surface can reveal power without permanently occupying the screen. |
| Charm Bubble Tea/Bubbles | The maintained help example switches between short and full help and changes width so it can truncate gracefully ([help example](https://github.com/charmbracelet/bubbletea/blob/main/examples/help/main.go)). Bubble Tea itself emphasizes window-size events plus keyboard, mouse, and clipboard support ([README](https://github.com/charmbracelet/bubbletea)) | Help is a responsive component, not a static legend. Treat input mechanisms as peers. |
| OpenTUI | The renderer owns resize, mouse, keyboard protocol, alternate-screen behavior, selection, and OSC 52 clipboard policy ([renderer](https://opentui.com/docs/core-concepts/renderer/)). Renderables support focused-descendant styling ([renderables](https://opentui.com/docs/core-concepts/renderables/)); ScrollBox provides keyboard scrolling and child-into-view behavior ([ScrollBox](https://opentui.com/docs/components/scrollbox/)); Textarea supports multiline input and configurable submit bindings ([Textarea](https://opentui.com/docs/components/textarea/)) | The proposed design fits the actual framework, but pinned version 0.5.2 APIs must be checked before implementation. Focus, selection, and scroll behavior should be explicit app state, not incidental widget behavior. |

### Recurring pattern 1: stable space and visible focus

The most successful pane-based TUIs maintain a predictable spatial model. Selection changes content in a stable detail region, and focus is visible. Lazygit's panel modes, GitUI's responsive layout, and Helix's selected/inactive theme roles all reinforce this.

For Blupost:

- The conversation list is navigation, not an equal dashboard widget.
- The selected row stays highlighted even when the composer owns keyboard focus.
- Keyboard focus and selected conversation are distinct states and get distinct treatments.
- The active recipient is repeated in the detail header and composer label.
- Resizing never changes the selected conversation or draft.

### Recurring pattern 2: a small visible command vocabulary

Lazygit, GitUI, K9s, Telescope, and Bubbles all provide some combination of short help, full help, context-specific mappings, or a discoverable command surface. Their shared lesson is not “show every shortcut.” It is “show the next few useful actions and provide a reliable door to the rest.”

For Blupost, show at most four or five contextual actions in the footer, then `? Help`. The list changes with focus:

- Conversation list: `↑↓ Move  Enter Open  / Filter  a Add  ? Help`
- Transcript browsing: `PgUp/PgDn Scroll  End Latest  Tab Message  Esc Back  ? Help`
- Composer: `Enter Send  Shift+Enter Newline  Esc Leave message  ? Help`
- Add contact: `Tab Next  Enter Save  Esc Cancel`

At very narrow widths, keep the action names and drop secondary bindings rather than turning the footer into clipped punctuation.

### Recurring pattern 3: progressive disclosure through modes

K9s and Telescope reserve filter/command/help detail until invoked. Helix reserves command palettes and mode-specific commands behind explicit entry points. Blupost needs only a light version of that model:

- `/` filters conversations.
- `?` opens contextual help and a searchable action list only if that remains simple.
- `a` opens Add Contact in the conversation-list context.
- Connection details, session limits, privacy behavior, and clipboard explanation live in Help/About rather than the main transcript.

Do not add a general `:` command mode in the first redesign. Blupost has too few actions to justify it, and it would obscure rather than simplify.

### Recurring pattern 4: responsive subtraction

Lazygit can give a focused panel half or all of the screen. K9s can make columns wide-only and can suppress optional chrome. The Bubble Tea help component shortens itself at constrained widths. The pattern is to remove or replace secondary structure rather than scale every element down equally.

Blupost should prioritize, in order:

1. Message body and composer.
2. Active recipient and message outcome.
3. Connection state.
4. Navigation and unread state.
5. Contextual shortcuts.
6. Session counter, phone detail, decorative brand mark.

### Recurring pattern 5: keyboard-first, mouse-enhanced

GitUI defaults to arrow navigation. K9s makes mouse support optional. OpenTUI routes keyboard input through focused renderables and can auto-focus on click. W3C's keyboard guidance, while written for web content, gives a useful cross-interface target: pointer actions need equivalent keyboard routes without timing-sensitive chords ([WCAG 2.2 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard)).

Blupost should treat click, wheel, drag selection, and terminal hyperlinks as accelerators. The core workflow—add contact, choose thread, browse, compose, send, reconnect, and exit—must remain possible without a pointer. Free-form drag selection is terminal-native pointer behavior; a future `Copy message` action can provide a useful keyboard-comparable operation without pretending that it selects an arbitrary character range.

## Terminal realities and design consequences

### A terminal is a capability spectrum

Terminal color counts, attributes, keyboard events, hyperlink handling, clipboard policy, glyph width, and alternate-screen behavior vary. ncurses' terminfo documentation describes terminals with different color models and even attribute/color collisions ([terminfo](https://invisible-island.net/ncurses/man/terminfo.5.html)). Kitty's keyboard protocol exists because legacy terminal encodings make some modified keys ambiguous and supports progressive opt-in rather than assuming universal behavior ([Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)). OpenTUI performs terminal configuration and capability policy in its renderer ([OpenTUI renderer](https://opentui.com/docs/core-concepts/renderer/)).

Consequences:

- Bind common actions to plain arrows, Tab, Enter, Escape, Page Up/Down, and single mnemonic keys outside text input.
- Treat modified-key aliases as conveniences, not the only route.
- Do not require hover, release events, a particular mouse protocol, or a Kitty-only key distinction.
- Render a coherent static frame even when animations or high-fidelity key events are unavailable.
- Keep an ASCII-safe glyph set available for terminals/fonts that render symbols poorly.

### Cell width is not string length

Unicode defines grapheme clusters as approximations of user-perceived characters and notes that emoji sequences form a single cluster ([UAX #29](https://www.unicode.org/reports/tr29/)). East Asian Width is a separate property relevant to fixed-width presentation and includes context-dependent ambiguous-width characters ([UAX #11](https://www.unicode.org/reports/tr11/)).

Consequences:

- Never truncate aliases, drafts, or messages by JavaScript code-unit count.
- Use OpenTUI's measured layout and wrapping primitives wherever possible.
- Test combining marks, emoji sequences, CJK, long unbroken URLs, and mixed-width aliases.
- Treat bidirectional text and cursor movement as an explicit research gap until tested; do not claim international text support from UTF-8 decoding alone.

### Hyperlinks and clipboard are terminal-mediated

OpenTUI documents that OSC 52 clipboard output can be blocked or silently ignored by a terminal and that invoking the output path does not prove the clipboard changed ([renderer](https://opentui.com/docs/core-concepts/renderer/)). Kitty allows users to configure whether hyperlinks are allowed and how/when their targets and underlines appear ([Kitty configuration](https://sw.kovidgoyal.net/kitty/conf/)).

Consequences:

- Keep links visibly underlined in Blupost's own rendering.
- Do not claim a link opened; the terminal owns activation.
- Keep the existing truthful distinction between a confirmed host copy and a terminal clipboard attempt.
- Provide a keyboard copy action only if it can select a well-defined object, such as the focused message body; do not silently copy whole conversations.

### Respect the terminal's visual environment

The informal `NO_COLOR` standard asks color-producing command-line software to honor a nonempty `NO_COLOR` environment variable by default ([NO_COLOR](https://no-color.org/)). GitUI says it aims to work on both light and dark terminal themes, while K9s exposes a `default` color so the terminal background can remain transparent ([GitUI README](https://github.com/gitui-org/gitui), [K9s skins](https://k9scli.io/topics/skins/)).

Quiet Signal should therefore support four presentation tiers:

1. **Truecolor:** full semantic palette.
2. **256/16 color:** mapped semantic roles with tested contrast.
3. **Terminal-default:** default foreground/background plus a restrained accent.
4. **No color:** bold, underline, reverse video, ASCII glyphs, and words carry the entire hierarchy.

`NO_COLOR` should be evaluated during implementation alongside an explicit `auto/always/never` policy. Full-screen TUI behavior needs to remain legible rather than merely stripping escape sequences.

### Accessibility needs honest limits

WCAG is a web standard, so Blupost must not claim WCAG conformance. Its criteria still provide useful measurable targets: normal text contrast of 4.5:1, meaning beyond color, complete keyboard access, and a visible persistent focus indicator ([contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum), [use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color), [keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard), [focus visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)).

Linux screen-reader support introduces a separate issue. GNOME documents that Orca obtains structured application information through AT-SPI when toolkits expose it ([Orca introduction](https://help.gnome.org/orca/introduction.html)). The reviewed OpenTUI documentation describes rendered cells, input, selection, focus, and clipboard behavior, but does not document an AT-SPI semantic accessibility tree. A terminal emulator may expose some cell text independently, but that is not evidence that dynamic pane structure, focus, or live status will be announced correctly.

Therefore:

- Do not market the full-screen TUI as screen-reader accessible until manually verified.
- Preserve `watch --plain` and scriptable commands as useful non-full-screen fallbacks, while acknowledging that the current one-shot send command can expose the body in process arguments.
- Investigate a future line-oriented interactive mode that keeps message bodies off `argv` if assistive-technology testing shows the alternate-screen UI is inadequate.
- Test with Orca and representative Linux terminal emulators before making accessibility claims.

## Design synthesis: proposed information architecture

### Primary objects

Blupost has only four user-visible objects:

1. **Phone session** — connection state and current phone identity.
2. **Conversation** — participant, unread count, session messages, and draft.
3. **Message** — body, direction, and truthful transport state.
4. **Contact** — locally stored alias and normalized number.

The UI should not introduce “dashboard,” “inbox,” or “account” concepts that the engine does not have.

### Primary actions

- Select a conversation.
- Read/scroll the active transcript.
- Compose and send once.
- Add a contact.
- Reconnect the phone session.
- Select/copy text and activate a link through the terminal.
- Open contextual help.
- Quit safely.

Everything else is detail or system feedback.

### Region model

| Region | Purpose | Persistent content | Contextual content |
|---|---|---|---|
| App header | Identity and durable global state | `Blupost`; phone connection | `Reconnect` action when disconnected |
| Conversation list | Navigate peers | Alias/number, persistent selection | Unread count, draft or last-session-message preview |
| Conversation header | Orient the send target | Active alias; optional number | Session-only/help affordance |
| Transcript | Read and inspect | Message bodies and direction | Message outcome, new-message marker |
| Composer | Create explicit next action | Recipient-aware input | Send/newline hint, disconnected explanation |
| Footer | Discover and confirm | Context keybar, `? Help` | Minor notices such as copy/save |

Durable state never depends on a transient footer message.

## Design synthesis: recommended navigation and focus model

Blupost should use **focus contexts**, not editor-style modes. The contexts are Conversation List, Transcript Browse, Composer, Add Contact, Help, and Filter.

### Global behavior

| Key | Action | Notes |
|---|---|---|
| `Ctrl+C` | Quit safely | Global; restores terminal and closes the MAP session |
| `?` | Open contextual help | Available outside text entry; Help lists current and global actions |
| `Tab` / `Shift+Tab` | Move between major focus regions | Direction must be reversible and visible |
| `Esc` | Step back one level | Close help/filter/form; leave composer; on compact chat return to list |

Escape should follow a predictable hierarchy. If the composer is focused, the first Escape leaves text entry and focuses transcript browsing. A second Escape in compact layout returns to the conversation list. This prevents an accidental key from abandoning a draft while keeping Back discoverable.

### Conversation list

| Key | Action |
|---|---|
| `↑` / `↓` and `j` / `k` | Move selection |
| `Enter` | Open the selected conversation; on wide layouts, also move toward the composer |
| `/` | Filter contacts/conversations |
| `a` | Add contact |
| `c` | Reconnect, only when reconnect is available |

The selected row must be visibly selected even when focus moves elsewhere. Focus can add a brighter edge/caret or stronger reverse-video treatment.

### Transcript browse

| Key | Action |
|---|---|
| `↑` / `↓` | Scroll by line |
| `PageUp` / `PageDown` | Scroll by page |
| `Home` / `End` | Oldest/latest message |
| `Tab` or `i` | Focus composer |
| `Esc` | Return to conversation list in compact layout |

If a new message arrives while the user is scrolled away from the bottom, preserve reading position and show `↓ 2 new messages`. `End` or activating that line returns to latest. Never yank the transcript to bottom merely because a snapshot arrived.

### Composer

| Key | Action |
|---|---|
| `Enter` | Send the captured body once |
| `Shift+Enter` | Insert newline |
| Normal editing keys | Edit text using terminal conventions |
| `Esc` | Leave composer without losing draft |

Do not assign single-letter app shortcuts while the composer owns focus. The footer should make the Enter/Shift+Enter contract visible.

### Add Contact

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Move between Alias, Phone number, Save, Cancel |
| `Enter` | Activate the focused action or advance from Alias |
| `Esc` | Cancel without changing config |

Keep separate labels visible after input begins. Put validation under the relevant field. On success, say `Saved locally`, close the form, activate the new conversation, and preserve predictable focus.

## Design synthesis: responsive layout direction

Breakpoint numbers below are hypotheses for prototype testing, not immutable constants. Width and height both matter.

| Tier | Provisional dimensions | Structure | Removed first |
|---|---:|---|---|
| Roomy | `>= 100` columns and `>= 24` rows | 28–32-column list + detail | Nothing essential; richer row previews allowed |
| Standard | `72–99` columns and `>= 18` rows | 22–28-column list + detail | Phone number, long previews, secondary hints |
| Compact | `< 72` columns or constrained height | Single pane: list or conversation | Persistent sidebar, decorative brand mark, secondary metadata |
| Tiny | `< 48` columns or `< 14` rows | Single functional pane with one-line header/footer | Previews, most key hints, noncritical counters, extra padding |

The implementation should derive named capabilities such as `showSidebar`, `showPreview`, `showSecondaryHints`, and `composerMaxRows` rather than scattering width checks across render methods.

### Wide concept

The borders below illustrate regions, not a recommendation to draw every edge.

```text
 Blupost                                      ● Connected · iPhone
──────────────────────┬─────────────────────────────────────────────
 Conversations        │ Alice                              Session only
 / Filter             │─────────────────────────────────────────────
                      │ Alice
 ▌ Alice           2  │ │ Are you still coming tonight?
   Bob                │ │
   Casey        Draft │                                      You
                      │                    Yep — leaving now.
 + Add contact        │                                      Sent
                      │
                      │─────────────────────────────────────────────
                      │ Message Alice…                     Send ↵
──────────────────────┴─────────────────────────────────────────────
 ↑↓ Move  Enter Open  / Filter  a Add  ? Help       12 in this session
```

Characteristics:

- The active row uses a persistent selection bar plus background/weight.
- The transcript is open, not surrounded by a heavy rounded frame.
- Consecutive direction groups avoid repeating `you` or `them` on every line.
- Message state is subordinate to the outgoing body but remains textual.
- The composer boundary is the strongest structural divider in the detail pane.
- Connection is global, while recipient identity is local to the conversation.

### Compact conversation-list concept

```text
 Blupost                         ● Connected
────────────────────────────────────────────
 Conversations
 / Filter

 ▌ Alice                                      2
   Bob
   Casey                                  Draft

 + Add contact
────────────────────────────────────────────
 ↑↓ Move  Enter Open  a Add  ? Help
```

### Compact conversation concept

```text
 ‹ Conversations                  Alice
────────────────────────────────────────────
 Alice
 │ Are you still coming tonight?

                                  You
                    Yep — leaving now.
                                  Sent

────────────────────────────────────────────
 Message Alice…                    Send ↵
 Esc Back  PgUp/PgDn Scroll  ? Help
```

The compact model is a navigation stack. Selecting a conversation replaces the list with the conversation; returning restores list selection and scroll position.

### Disconnected state

```text
 ○ iPhone disconnected                         Reconnect c
 Draft preserved. Blupost will not queue this message.
```

The explanation belongs beside the disabled send action or beneath the header, not only in a footer that may be missed.

## Design synthesis: conversation and message specification

### Thread rows

Each row has a strict priority order:

1. Alias, otherwise normalized number.
2. Unread count.
3. `Draft` when a nonempty draft exists.
4. Optional last session-message preview at roomy width only.

Do not imply synced history. A contact with no live session message is still a valid row. If rows are reordered by recency, use the highest message ID as session recency and keep untouched contacts in stable alias order; document and test the rule.

### Message grouping

Group adjacent messages with the same direction for presentation only. Do not change engine state.

- Show `Alice` or `You` at the start of a group.
- Use one-line spacing within a group and a larger separation between directions.
- Keep incoming groups leading-aligned.
- Give outgoing groups a consistent indent or trailing alignment, but never force bodies into excessively narrow columns.
- Use a readable maximum measure around 68–76 cells on roomy terminals; use available width on compact terminals.
- Render body and metadata as separate elements so selecting a body does not automatically copy sender labels or transport suffixes.

### Send-state lexicon

The visual vocabulary must reflect what the engine actually knows:

| Engine state | Recommended UI | Meaning |
|---|---|---|
| `sending` | `◌ Sending…` | One transfer attempt is in progress |
| `sent` | `✓ Sent` or more precise engine-approved wording | The engine's send operation confirmed its defined success; not a read receipt |
| `failed` | `! Not sent` plus a recovery explanation | The engine confirmed failure |
| `unknown` | `? Check your phone — Blupost couldn't confirm whether this was sent.` | Outcome is indeterminate; never auto-retry |
| incoming `received` | No routine suffix | It is visibly present in the transcript |

Before changing `Sent` to a phrase like `Sent to phone`, confirm the exact BlueZ/engine semantic. The UI must not become more precise than the evidence.

For `failed`, a future action may place the body back into the composer for review. It must not resend immediately. For `unknown`, do not offer a retry affordance at all in the same state because duplicating the message is possible.

### New-message behavior

- If already at latest, append and remain at latest.
- If browsing older content, hold scroll position.
- Show a persistent new-message marker with count.
- Selecting a thread clears its unread state according to engine policy, but the transcript marker remains until the user reaches latest.
- Avoid whole-transcript opacity flashes; the content itself is sufficient feedback.

### Empty states

Empty states should state the situation and next action, following Apple's writing guidance for blank screens ([Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).

No contacts:

```text
No conversations yet
Add a contact to start a session-only conversation.
[ Add contact ]
```

Contact selected, no messages:

```text
No messages with Alice in this session
Messages appear here only while Blupost is open.
```

Connecting:

```text
Connecting to iPhone…
You can choose a conversation and prepare a draft while you wait.
```

## Design synthesis: composer specification

- Minimum one content row; grow with content to a tested maximum of five rows when height allows.
- Keep a visible focus treatment around the whole composer region.
- Use `Message <alias>…` as the accessible/readable prompt; retain a separate recipient title above so the placeholder is not the only label.
- Keep Send at a stable trailing location and make the entire text label clickable.
- Show `Send ↵` in the button at widths where it fits; use `Send` plus the nearby keybar in compact mode.
- Do not show an SMS character counter until the engine can calculate transport segmentation accurately and the product decides the information is useful.
- Preserve per-thread drafts through focus moves, pane changes, and resize.
- On a rejected send, restore the captured body without overwriting text typed after submission; retain the current engine's safe merge behavior.
- While disconnected, preserve editability if drafts are safe but disable Send and explain why locally.

## Design synthesis: contact form specification

On wide screens, Add Contact may temporarily replace the conversation-list content or appear as a light detail sheet in that region. On compact screens, it becomes its own single-pane step. Do not put a tiny modal over an already small terminal.

```text
Add contact

Alias
friend

Phone number
+1 312 555 0123

Saved locally in your Blupost config.

[ Save contact ]   Cancel
```

- Use persistent labels, not placeholder-only fields.
- Keep error text adjacent to Alias or Phone number.
- Use direct wording from the Rust validation layer but translate technical codes into plain actions.
- Do not display unrelated config contents or paths in ordinary errors.
- Keep Save unavailable while required fields are blank or a save is in flight.
- Escape cancels; saving success activates the new conversation.

## Design synthesis: visual system

### Personality

The desired emotional tone is **calm confidence**. Blupost is a quiet bridge between two user-owned systems. It should feel precise and independent, not corporate, playful, cyberpunk, or like a Bluetooth diagnostic console.

### Palette direction

- Prefer the terminal's own background by default after compatibility testing.
- Use a cool cyan/teal accent as a Blupost signature, but reserve it for selection, focus, links, and the primary action.
- Keep message bodies in the primary foreground color; do not tint all outgoing text cyan.
- Use green only for confirmed positive state, amber for uncertainty/attention, and red for confirmed failure.
- Pair each semantic color with a word/glyph.
- Provide tested mappings for truecolor, 256-color, 16-color, and no-color modes.
- Evaluate both light and dark terminal backgrounds and an increased-contrast palette.

Exact color values should be chosen only after automated contrast measurement against the actual paired surfaces. The current palette is a useful mood reference, not a finished accessibility system.

### Type and glyph rules

- One terminal typeface; Blupost does not choose or bundle it.
- Bold/bright for titles and current selection, regular for bodies, dim only for nonessential metadata that remains legible.
- Sentence case for actions and headings.
- Avoid long all-caps controls such as `+ ADD CONTACT` and `SENDING`.
- No Nerd Font dependency.
- Baseline symbols: `●`, `○`, `✓`, `!`, `?`, `›`, `‹`, with ASCII alternatives `*`, `o`, `ok`, `!`, `?`, `>`, `<`.
- Test every glyph as a one-cell assumption; replace any ambiguous-width ornament.

### Borders and surfaces

- At most one main list/detail divider.
- One composer boundary.
- Selected rows use reverse/background plus a leading marker.
- Avoid a border around the transcript unless it materially improves focus visibility.
- Use rounded borders sparingly; their presence should identify a control or temporary surface, not every region.
- Do not fill the full screen with a hard-coded dark background until light-theme and selection behavior are verified.

### Motion

Remove decorative motion in the redesign. Retain only bounded activity animation for connecting or sending, at a consistent location, with accompanying text. Motion should never delay input, change layout, or make selection harder.

## Accessibility and inclusive design requirements

These are engineering requirements even though full screen-reader accessibility remains unverified:

1. Every core app control and workflow action has a keyboard route. Free-form terminal text selection is tested and documented separately.
2. Focus is always visible and never indicated only by color.
3. Tab/Shift+Tab order is stable and reversible.
4. Escape always exits the current temporary context without losing a draft.
5. Incoming/outgoing, connected/disconnected, and all send states use text or distinct glyphs in addition to color.
6. Primary text meets a 4.5:1 contrast target against its actual background; selected and focus states remain legible in light/dark/high-contrast variants.
7. No critical message auto-dismisses on a timer.
8. Decorative blinking is absent; progress animation has static text.
9. The layout remains operable when terminal font zoom causes a resize.
10. No core action depends on a nonstandard glyph, Nerd Font, mouse hover, or modified key chord.
11. Selection, cursor movement, wrapping, and truncation are tested with extended grapheme clusters and mixed-width text.
12. Screen-reader claims require manual Orca testing on the target terminal stack.

## Privacy and trust requirements

1. The active recipient is visible whenever Send is available.
2. A disconnected draft is explicitly described as preserved and not queued.
3. `unknown` is never collapsed into failure or success.
4. No UI action retries a message implicitly.
5. Contact persistence is disclosed locally at the form.
6. Session-only message retention is explained at the first empty transcript and in Help/About.
7. Clipboard writes happen only from an explicit completed selection or future explicit copy command and produce truthful feedback.
8. Link activation remains terminal mediated; Blupost does not silently launch external applications.
9. No message preview is written to logs, crash breadcrumbs, screenshot fixtures, or design telemetry.
10. Future privacy mode may hide sidebar previews and phone names for screen sharing, but it is a later enhancement, not a substitute for the core privacy boundary.

## Design synthesis: prioritized implementation plan

### Phase 0 — Interaction contract and deterministic fixtures

**Priority:** Blocker for the redesign

**Goal:** Make state semantics and responsive behavior testable before restyling.

Deliverables:

- A UI state inventory covering no contacts, no active thread, empty thread, active conversation, long/multiline messages, unread messages, draft, connecting, connected, disconnected, failed connection, sending, sent, failed send, unknown send, contact validation failure, clipboard success/fallback/failure, help, and filter.
- Deterministic fixture snapshots with no real message send or personal data.
- Named layout capabilities derived from width and height rather than a single `wide` boolean.
- Viewport test matrix at minimum: `120x34`, `90x24`, `72x20`, `60x18`, `48x14`, and `40x12`.
- A written send-state lexicon approved against Rust engine semantics.
- A presentation-only boundary for Phases 1–3: consume the existing snapshot fields (`id`, `participant`, `body`, `direction`, `state`, `unread`, thread draft, contacts, and connection) without inventing timestamps or expanding the engine protocol.

Exit criteria:

- Every engine state has one agreed label, location, tone, and recovery action.
- Every responsive tier has a wireframe and focus path.
- Tests can render every critical state without Bluetooth or a live recipient.

### Phase 1 — Responsive shell and focus architecture

**Priority:** Highest visible improvement

**Goal:** Establish the list/detail wide layout and true single-pane compact layout.

Deliverables:

- Stable app header, conversation list, conversation header, transcript, composer, and footer regions.
- Persistent selection distinct from keyboard focus.
- Compact navigation stack with Back behavior and state restoration.
- Tab/Shift+Tab traversal and hierarchical Escape behavior.
- Contextual short keybar plus full `?` help.
- Resize preservation for active thread, draft, list selection, and transcript position.

Exit criteria:

- Every core app action is reachable keyboard-only.
- At `40x12`, the active pane, header, composer or primary action, and a route to Help remain usable with no overlap.
- Resizing across every tier loses no draft and changes no active recipient.
- Mouse clicks move the same selection/focus state as keyboard actions.

### Phase 2 — Conversation and composer redesign

**Priority:** Core experience

**Goal:** Make reading and sending feel calm, human, and trustworthy.

Deliverables:

- Direction-grouped message presentation with separate selectable bodies and metadata.
- Readable line measure and compact full-width behavior.
- Message-local sending/sent/failed/unknown state.
- Bounded auto-growing composer with recipient-aware label and visible send/newline hint.
- Disconnected composer explanation and preserved draft behavior.
- New-message marker that does not steal scroll position.
- Thread row priority rules for unread, draft, and optional live-session preview.

Exit criteria:

- A body selection copies body text without forced sender/status prefixes.
- Unknown outcome remains visible and cannot trigger automatic or one-key resend.
- New messages do not yank a user who is reading older content.
- Long URLs, multiline bodies, emoji, combining text, and CJK wrap without corrupting neighboring layout.

### Phase 3 — Feedback, contact flow, and visual system

**Priority:** Trust and finish

**Goal:** Replace generic chrome and volatile footer errors with a coherent semantic system.

Deliverables:

- Durable connection state and reconnect action in the app/conversation header.
- Inline contact validation and `Saved locally` disclosure.
- Footer notices reserved for minor confirmations.
- Semantic theme tokens and truecolor/256/16/default/no-color mappings.
- Light, dark, and increased-contrast validation.
- ASCII-safe glyph fallback.
- Removal of decorative startup, pane-slide, pulse, and transcript-flash motion.

Exit criteria:

- Every state remains distinguishable in monochrome captures.
- Primary text meets the chosen contrast target in all supported palettes.
- No critical error disappears because an unrelated snapshot refreshes the footer.
- The app remains visually coherent on terminal-default light and dark backgrounds.

### Phase 4 — Search, polish, and real usability validation

**Priority:** After the core is stable

**Goal:** Improve speed and confidence without adding permanent complexity.

Candidate deliverables:

- `/` conversation filter with clear exit/empty state.
- Searchable contextual action/help surface if the action count justifies it.
- Optional privacy/screen-sharing mode that hides previews and phone identity.
- Optional comfortable/compact density only after testing shows a real need.
- Manual keyboard-only, mouse, link, clipboard, resize, light/dark, and terminal compatibility sessions.
- Qualitative usability tests with new and experienced terminal users.
- Orca and terminal screen-reader investigation; decision on a line-oriented interactive fallback.

Exit criteria:

- A new user can add a contact, select it, understand the recipient, compose, and identify the result without reading the README.
- An experienced user can complete the same flow keyboard-only with no hidden mandatory shortcut.
- Target users can correctly explain `failed` versus `check phone` after seeing each state.
- No accessibility or privacy claim exceeds verified evidence.

## Priority cut

### Must have in the redesign

- True compact one-pane navigation.
- Stable active-recipient and connection identity.
- Visible focus and keyboard parity.
- Contextual keybar and `?` help.
- Grouped readable transcript.
- Message-local truthful outcome states.
- Bounded recipient-aware composer.
- Durable inline errors.
- Semantic palette with monochrome fallbacks.
- Nearly motionless behavior.

### Should have after the foundation

- Conversation filter.
- New-message marker while scrolled up.
- Draft and unread treatment in thread rows.
- Terminal-default light/dark support.
- ASCII-safe presentation.
- Contact form with field-local validation.

### Could have later

- Privacy/screen-sharing mode.
- Comfortable/compact density preference.
- Keyboard copy-current-message action.
- Relative in-session timestamps, but only after the engine model and privacy implications are deliberately designed.
- User-defined theme overrides after semantic roles are stable.

### Explicitly not part of this redesign

- Apple Messages visual cloning.
- Attachments, reactions, group threads, history synchronization, typing indicators, or read receipts.
- Background daemon behavior.
- Automatic message retry.
- Decorative animation.
- A general command language solely to make the app feel like a power-user TUI.

## Design verification matrix

### Viewports

- `120x34` — roomy desktop.
- `90x24` — standard terminal.
- `72x20` — breakpoint boundary.
- `60x18` — compact laptop split.
- `48x14` — constrained terminal.
- `40x12` — tiny but functional floor.
- Live resize across all sizes while a draft is nonempty and transcript is scrolled up.

### Visual environments

- Kitty truecolor on dark background.
- Kitty or another target terminal on light background.
- 256-color and 16-color approximation.
- `NO_COLOR`/monochrome policy.
- Increased-contrast palette.
- Unicode and ASCII glyph sets.

### Input paths

- Keyboard only.
- Mouse click and wheel.
- Drag selection and clipboard success/fallback/failure.
- Terminal hyperlink modifier behavior.
- Key protocol fallback where modified combinations are ambiguous.

### Content cases

- Long alias and raw phone number.
- No contacts and many contacts.
- Unread count, draft, and last-message preview collisions.
- Empty, short, long, multiline, whitespace-heavy, and URL-heavy bodies.
- Emoji sequence, combining mark, CJK, and mixed-width text.
- Bidirectional text exploratory test.
- 500-message boundary using fixtures only.

### System states

- Connecting, connected, disconnected, recovery attempt, and failed connection.
- Sending, sent, failed, and unknown outcome.
- New incoming message at latest and while scrolled up.
- Contact save success and every validation failure.
- Resize, suspend/restore where supported, Ctrl+C, renderer failure, and clean terminal restoration.

No verification step should send a real message. Live sending remains a separately authorized acceptance action with an exact recipient and body.

## Research gaps and decisions still requiring evidence

1. **User evidence:** This report synthesizes design principles and documented TUI patterns; it is not a substitute for observing people use prototypes. Test at least a few new terminal users and daily TUI users before polishing shortcuts.
2. **Pinned OpenTUI behavior:** The project pins OpenTUI 0.5.2, while online docs may describe newer APIs. Verify focus traversal, selection boundaries, scroll anchoring, background defaults, capability detection, and test-renderer behavior against the pinned package before implementation.
3. **Screen readers:** OpenTUI's documented cell renderer does not establish AT-SPI semantics. Test Orca with Kitty, GNOME Terminal/VTE, and at least one other target. Decide whether Blupost needs a private-stdin line-oriented interactive mode for nonvisual use.
4. **Bidirectional and complex text:** UTF-8 acceptance does not prove correct BiDi layout, grapheme cursor movement, or cell-width handling. Test and document supported behavior.
5. **Color capability:** Establish how OpenTUI 0.5.2 reports/downsamples truecolor and how terminal-default backgrounds behave before committing to exact tokens.
6. **Minimum viewport:** `40x12` is a proposed functional floor. Prototype evidence may justify a different minimum or a clear “terminal too small” recovery screen.
7. **Thread ordering:** Decide whether contacts stay alphabetical or live session activity moves threads. The engine has monotonic message IDs but no timestamp field.
8. **Timestamp value:** The current protocol has no timestamps. Do not add them merely because other chat apps have them; establish a user need and define session-only time semantics first.
9. **Send-success wording:** Confirm exactly what BlueZ `PushMessage` success proves before choosing between `Sent`, `Sent to phone`, or another phrase.
10. **Clipboard verification:** OSC 52 cannot acknowledge terminal acceptance. Keep status wording capability-aware and test multiplexers/SSH only if they enter supported scope.
11. **Terminal matrix:** Kitty is the primary environment, but portable claims need a named supported matrix and explicit degradation behavior for older terminals.
12. **Privacy mode:** Hiding previews is potentially useful for screen sharing, but it needs a concrete threat/use case before adding preference surface.

## Final direction

The redesign should be judged by one standard:

> At every moment, Blupost makes the conversation obvious, the next action easy, and the limits of its knowledge truthful.

The most important move is structural, not cosmetic: replace the current framed dashboard feeling with an adaptive list/detail conversation experience; then co-locate state with the object it describes, reduce repeated metadata, make focus and commands discoverable, and let a restrained semantic palette support the content.

If that foundation is correct, visual polish will feel inevitable. If it is wrong, more borders, color, glyphs, or animation will only make the interface louder.
