# Blupost TUI visual research

**Date:** 2026-08-18

**Decision:** Replace the current visually neutral shell with **Electric Quiet**: a lively, minimal, logo-led messaging interface whose energy comes from focus, selection, conversation rhythm, and truthful live state.

**Scope:** Visual hierarchy, density, color, focus, responsive layout, message presentation, composer, status, feedback, motion, mouse behavior, and terminal fallbacks. This document does not change transport semantics or authorize new protocol features.

**Evidence labels:** The project descriptions and Apple guidance below are source-backed observations from official repositories, documentation, or project-maintained media. Every Blupost directive, token, component specification, wireframe, and anti-pattern is design synthesis.

## Executive decision

The first redesign fixed the information architecture but overcorrected toward quietness. It removed clutter without introducing a strong visual center. The result is orderly but generic: a word in the header, a thin selection treatment, bodies floating on an undifferentiated canvas, a composer separated by a line, and a footer that reads like documentation.

Electric Quiet keeps the good structural decisions—list/detail when wide, one pane when compact, session truth, message-local outcomes, keyboard and mouse parity—but replaces the visual layer decisively:

1. **The actual lowercase-`b` chat-tail logo owns the upper-left.** The word `blupost` does not appear there. A plain letter `b`, diamond, generic chat glyph, or substitute wordmark is not acceptable.
2. **The selected conversation becomes a real active surface:** full-row tonal fill, bright leading rail, strong alias, and compact unread/draft badge.
3. **The transcript gets rhythm:** grouped messages, restrained incoming treatment, low-contrast blue outgoing slabs, bounded widths, and local outcome labels.
4. **The composer becomes the visual dock:** raised surface, recipient chip, bright focus edge, clear send action, and durable inline transport truth.
5. **The footer becomes a contextual action rail:** a few short key ribbons instead of a sentence of shortcuts.
6. **Color is concentrated, not removed:** a cyan-to-blue identity family, one active surface at a time, and semantic green/amber/red only for outcomes.
7. **Motion is local and truthful:** connection, sending, arrival, and completion may move briefly; the idle interface does not.

The intended feeling is:

> Dark, crisp, human, and electrically alive—never busy, corporate, or game-like.

## What “lively and minimal” actually means

Minimal is not the absence of character. Across the best first-party TUI examples, liveliness comes from five repeatable sources:

- **A recognizable active surface.** Selection is a fill, rail, border, title change, or several of these—not a tiny arrow alone.
- **Unequal hierarchy.** The primary content gets space; navigation and metadata are visibly subordinate.
- **State-driven change.** Search matches, progress, connection, playback, scanning, and new data make the screen feel responsive.
- **A coherent color grammar.** One accent family carries identity and interaction; separate semantic colors carry success, uncertainty, and failure.
- **Fast contextual feedback.** The interface visibly answers each action where it happened.

The opposite is decorative density: more frames, more labels, more icons, idle animation, or every string rendered in the accent color. Those techniques create noise without life.

## Research method

This survey uses only primary sources:

- Official project repositories, documentation, and project-maintained demos/screenshots.
- Apple Human Interface Guidelines and official Apple design sessions.
- The checked-in Blupost identity assets and current implementation for the local audit.

The projects are not presented as an objective popularity ranking. They were selected because they are widely recognized or visually distinctive and provide first-party evidence useful to a messaging TUI. A pattern appearing in another project proves it can work in a terminal; it does not make it appropriate for Blupost automatically.

## First-party TUI survey

### Git and operations interfaces

| Interface | Source-backed observation | Blupost synthesis |
| --- | --- | --- |
| [Lazygit](https://github.com/jesseduffield/lazygit/blob/master/docs/Config.md) | Its configuration distinguishes focused border, active and inactive selection, panel proportions, bottom keybinding line, spinner frames, mouse behavior, and adaptive portrait layout. Its official [keybinding reference](https://github.com/jesseduffield/lazygit/blob/master/docs/keybindings/Keybindings_en.md) exposes full help on `?` and panel expansion modes. | Focus needs redundant visual cues. Resize by changing composition, not squeezing every region. Borrow the contextual action line; reject its density and playful destructive-action treatment for sending. |
| [K9s](https://k9scli.io/topics/skins/) | Skins separately style the logo, header, focused border, menu keys, active crumbs, table cursor, and semantic statuses. The [configuration](https://k9scli.io/topics/config/) allows logo, header, crumbs, icons, and mouse to be independently disabled. | Branding can be a compact mark independent of the app title. Borrow semantic role separation and responsive subtraction; reject the dashboard-level quantity of status color. |
| [GitUI](https://github.com/gitui-org/gitui#1-features) | The project explicitly lists responsive layout, keyboard-first control, themes, and context-based help, and maintains its own [demo](https://github.com/gitui-org/gitui/blob/master/demo.gif). Its [theme guide](https://github.com/gitui-org/gitui/blob/master/THEMES.md) separates selection foreground/background from syntax colors. | Contextual teaching feels more modern than a permanent shortcut manual. Selection should be a surface, not merely colored text. |
| [Lazydocker](https://github.com/jesseduffield/lazydocker) | The maintained demo uses a stable resource list plus changing live detail/log area. The project exposes mouse support but also documents disabling mouse capture when terminal selection is preferred. | List/detail is right for Blupost, but transcript selection is a first-class requirement. Mouse capture must never make chat text feel trapped. |
| [Oxker](https://github.com/mrjackwills/oxker) | Its official documentation describes Tab or click focus changes, wheel scrolling, clickable sorting, a resizable/hideable log region, and a mouse-capture toggle for normal text selection. | Make focus obvious and let secondary regions disappear. Preserve an explicit route to normal terminal selection. |

### Files, search, and navigation

| Interface | Source-backed observation | Blupost synthesis |
| --- | --- | --- |
| [Yazi](https://yazi-rs.github.io/docs/configuration/yazi/) | Its manager is an intentionally unequal parent/current/preview layout. Panels can be removed, previews can include images, and the [theme model](https://yazi-rs.github.io/docs/configuration/theme/) separates selection markers, active tabs, modes, status, progress, notifications, and file-type color. | Use pane weight to announce importance. The current chat must dominate; the conversation list supports it. Remove regions on narrow screens instead of rendering weak fragments. |
| [Superfile](https://superfile.dev/) | The first-party site presents a colorful multi-pane manager with image preview, multiple panels, selection mode, and a maintained hotkey demo. Its [theme documentation](https://superfile.dev/configure/custom-theme/) separates active borders, selected items, footer, sidebar, modal actions, hints, errors, and a two-color gradient. | A controlled two-accent identity can feel energetic. Borrow bold active-state contrast; reject its icon and border density for a messenger. |
| [Broot](https://dystroy.org/broot/) | Broot deliberately omits irrelevant tree rows, searches continuously, keeps previews synchronized to selection, supports panels and mouse opening, and documents full color customization. | Omission is a feature. Do not display phone, cap, session, or keybinding metadata merely because it exists. |
| [Telescope](https://github.com/nvim-telescope/telescope.nvim/blob/master/doc/telescope.txt) | Prompt, results, and preview can use horizontal, vertical, centered, cursor, or bottom-pane arrangements, each with preview cutoffs; preview and titles can disappear. `?`/`Ctrl-/` reveals picker mappings. | Command, contact, and help surfaces should be focused overlays with adaptive preview, not permanent chrome. |
| [Atuin](https://github.com/atuinsh/atuin) | The official demo centers a primary query, results, and secondary command metadata. Its maintained [changelog](https://github.com/atuinsh/atuin/blob/main/CHANGELOG.md) documents highlighted matches, an inspector, numeric shortcuts, mouse support, and ultracompact mode. | A strong primary line plus dim metadata and a small mode chip creates hierarchy with almost no framing. Compact should be explicitly designed, not truncated. |

### Editors and workspaces

| Interface | Source-backed observation | Blupost synthesis |
| --- | --- | --- |
| [Helix](https://docs.helix-editor.com/themes.html) | Theme roles distinguish active/inactive tabs, selected menus, picker headers and active columns, popups, separators, diagnostics, and normal/insert/select status modes. The [statusline configuration](https://docs.helix-editor.com/editor.html) has left/center/right zones. | Separate “selected conversation,” “focused list,” and “active recipient.” One color change cannot communicate all three. |
| [Zellij](https://zellij.dev/tutorials/basic-functionality/) | The top bar carries session/tabs while the bottom bar presents mode and immediate actions. Its [theme model](https://zellij.dev/documentation/themes.html) explicitly separates selected/unselected ribbons, text, lists, tables, and focused/unfocused frames. | Short colored key ribbons are livelier and faster to scan than prose. Use one compact action rail whose contents follow focus. |
| [Posting](https://posting.sh/) | Posting promotes jump navigation, a command palette, autocompletion, syntax color, contextual help, themes, and compact mode. Its [guide](https://posting.sh/guide/) says compact mode removes padding and borders, documents Tab/Shift-Tab and mouse operation, and shows focus-specific help. | This is the strongest precedent for polished modern TUI composition: rich active workspace, coherent palette, progressive disclosure, and optional density without box soup. |
| [Harlequin](https://harlequin.sh/) | The official product page shows a data catalog, tabbed editor, tabbed results, full-screen focus mode, history, and a dozen light/dark themes. | Tabs and color can establish rhythm, but Blupost has only one active conversation view; do not import IDE chrome that has no product meaning. |

### Live systems and media

| Interface | Source-backed observation | Blupost synthesis |
| --- | --- | --- |
| [btop](https://github.com/aristocratos/btop#features) | btop uses dense live graphs, themes, full mouse support, clickable highlighted key labels, rounded and TTY fallbacks, process selection, and continuous data updates. | Liveliness is most convincing when the state is actually alive. Animate connecting and sending, not the wallpaper. Borrow highlighted key labels; reject ambient graph-like movement. |
| [bottom](https://github.com/ClementTsang/bottom) | The official project documents customizable widget layouts, expanded views, basic mode, mouse support, themes, and live charts/tables. | The useful lesson is focus expansion and live feedback, not a grid. A messenger should have one dominant content surface. |
| [Diskonaut](https://github.com/imsnif/diskonaut) | Its maintained [demo](https://github.com/imsnif/diskonaut/blob/main/demo.gif) progressively fills a treemap while scanning and updates reclaimed space after actions. | Progressive rendering and visible outcomes create energy without ornamental animation. |
| [Termusic](https://github.com/tramhao/termusic/tree/master/screenshots) | Project-maintained screenshots show a stable multi-region media layout, strong active-item color, persistent playback state, and optional cover-art protocols. | Treat the active chat like “now playing”: stable, immediately recognizable, and anchored by its current live state. |
| [spotify-player](https://github.com/aome510/spotify-player/blob/master/docs/config.md) | Layout, border, progress, cover image, visualization, and mouse behavior are configurable. Theme roles distinguish playing, selected, metadata, progress, headers, and lyrics. | Active and selected are separate concepts. In Blupost, the engine’s active thread and the list’s keyboard selection must look related but not identical. |
| [ncspot](https://github.com/hrkfdn/ncspot/blob/main/doc/users.md) | It uses library tabs, search/command lines, help, clipboard actions, configurable columns, semantic theme roles, and a persistent progress/status bar, with optional graphical cover art. | One colorful persistent rail can anchor a mostly borderless app better than many framed panels. |

### Chat, conversational, and device interfaces

| Interface | Source-backed observation | Blupost synthesis |
| --- | --- | --- |
| [WeeChat](https://weechat.org/files/doc/weechat/devel/weechat_user.en.html) | The default layout surrounds chat with a buffer list, title, status, input, and optional nick list; bars are independently configurable. The guide explicitly explains that mouse capture intercepts normal terminal selection and how a modifier bypasses it. | The durable list/transcript/composer anatomy is proven, but WeeChat’s metadata density is too high. Borrow the explicit mouse-selection contract. |
| [OpenCode](https://opencode.ai/docs/tui/) | Its conversation TUI combines message entry with slash commands, a command palette, help, session switching, adaptive diff layout, configurable mouse behavior, and optional attention feedback. | A conversational TUI can hide power behind a palette. Blupost should keep ordinary sending immediate and place secondary operations behind `Ctrl+P`. |
| [Crush](https://github.com/charmbracelet/crush) | The official repository presents a session-based conversational terminal app with multiple session contexts and terminal/desktop attention behavior tied to focus state. | Conversation should remain the visual hero. Notifications and motion should occur only when state demands attention. |
| [Bluetui](https://github.com/pythops/bluetui) | Sections are navigated with Tab/Shift-Tab or h/l, list movement uses arrows or j/k, layout alignment and width are configurable, and Nerd Font icons are optional. | A Bluetooth-backed utility can feel intentional with a few semantic sections. Icons must remain optional; Blupost’s identity cannot depend on a font pack. |
| [Impala](https://github.com/pythops/impala) | Its maintained demo and documentation center a small set of mode-specific Wi-Fi actions, optional icons, scanning state, and a QR-sharing interaction. | State, spacing, and a distinctive symbol can brand a small utility without turning it into a dashboard. |

## Cross-interface findings

| Design dimension | Source-backed pattern | Electric Quiet directive |
| --- | --- | --- |
| Visual hierarchy | Yazi, Lazygit, Posting, and WeeChat use stable regions with unequal weight. Apple recommends expressing hierarchy through order, spacing, contrast, layout, and grouping. | Give the transcript most of the screen. Make the list a supporting rail and the composer the primary control surface. |
| Information density | Posting offers standard/compact spacing; Atuin has ultracompact behavior; K9s and btop allow regions or chrome to be suppressed. | Subtract preview, metadata, logo size, and sidebar in that order. Never preserve every region at the expense of the conversation. |
| Color | K9s, Helix, Yazi, Superfile, and media players expose semantic theme roles rather than one undifferentiated accent. | Use the cyan/blue family for brand and interaction. Use green/amber/red only for transport outcomes. Never encode state by color alone. |
| Selection and focus | Lazygit, Helix, Zellij, GitUI, and spotify-player distinguish focus, selection, and active state. | A focused selected row gets fill + rail + bold text. An active-but-unfocused thread keeps a quieter rail. A focused pane changes its local title/action rail too. |
| Headers and tabs | Zellij, Helix, Yazi, and Harlequin use top ribbons/tabs to anchor place and mode. | Blupost needs no permanent tab system. Use the logo at top-left and a strong active-recipient header; palettes/help may use temporary tabs or segmented modes. |
| Borders | btop relies heavily on boxes; Posting compact mode removes them; Zellij uses focused/unfocused frame roles. | Keep one structural divider and one composer focus edge. Do not frame every message, panel, label, or footer. |
| Status bars | Zellij, Lazygit, Helix, ncspot, and WeeChat allocate stable bottom zones to current mode or action. | Replace prose with three or four contextual ribbons. Put durable connection state in the conversation header and outcomes on messages. |
| Empty states | Posting documents the no-request state and teaches the next action through its workflow; Apple emphasizes visible essential actions and progressive disclosure. | Use the logo, one human sentence, and one primary `Add contact` action. Do not show CLI instructions or a feature inventory on the main canvas. |
| Motion and feedback | btop and bottom move because data changes; Diskonaut renders progress; Lazygit and the media TUIs use bounded spinners/progress. Apple says motion should support experience and not be the sole carrier of meaning. | Animate only real operations and one-shot arrival/completion feedback. Every animated state retains text. Idle state has zero animation. |
| Mouse | Posting, Yazi, btop, Oxker, Lazydocker, spotify-player, and WeeChat support clicking/scrolling while documenting selection or capture tradeoffs. | Rows, actions, links, the connection control, and scroll regions are clickable. Transcript drag-selection remains possible, with a documented terminal bypass when capture is active. |

## What Apple contributes—and what it does not

Apple is useful here as a discipline, not a visual costume.

### Source-backed guidance

- Apple’s [Principles of great design](https://developer.apple.com/videos/play/wwdc2026/250/) defines design as intention and frames simplicity as reducing friction, not merely removing visible elements. It describes delight as the accumulated result of care rather than confetti or added flourish.
- [Design foundations from idea to interface](https://developer.apple.com/videos/play/wwdc2025/359/) organizes design around structure, navigation, content, and visual design, and emphasizes that styling should express personality while supporting usability.
- The [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines) call for clear hierarchy and consistent, harmonious components.
- Apple’s [sidebar guidance](https://developer.apple.com/design/human-interface-guidelines/sidebars) says sidebars require substantial space and should yield to a more compact navigation model when space is limited.
- Apple’s [color guidance](https://developer.apple.com/design/human-interface-guidelines/color) recommends consistent semantic use; the [motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion) says motion should be purposeful, optional where possible, and never the only communication channel.
- Apple’s 2025 design-system session explicitly says hierarchy should be expressed through layout and grouping rather than extra backgrounds and borders, and that a task should continue coherently through resizing ([Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/)).

### Translation to Blupost

- Preserve context through resize: selection, active thread, draft, and scroll position do not reset.
- Make one primary action obvious: send the message to the named recipient.
- Use a small number of carefully differentiated surfaces rather than visual emptiness.
- Let the product have personality through its own logo, palette, rhythm, and micro-feedback.
- Keep destructive or uncertain outcomes explicit and local.

### Do not imitate

- No Liquid Glass, blur, translucency, shadows, faux depth, or Apple-style bubble tails.
- No literal Messages blue/green transport semantics.
- No SF Symbols or Apple font dependency.
- No bottom tab bar copied from a touch interface.
- No spring physics, hover-only controls, or gesture-only operations.

## Current Blupost visual audit

The current implementation has a sound skeleton but weak visual emphasis:

- The top bar is the word `blupost` plus connection text. It neither shows the actual mark nor creates a branded composition.
- Conversation selection is mostly a narrow tonal change and small glyph. It does not command enough attention to anchor the list/detail relationship.
- Message bodies sit directly on the canvas under generic group labels. Incoming and outgoing rhythm depends heavily on distant alignment, so the center of the screen feels empty rather than spacious.
- Outgoing messages can sit too far to the right, visually detached from the dialogue.
- The composer is chiefly a divider and text area. It does not read as the app’s primary interactive surface.
- The footer is a sentence of shortcuts. Its typographic rhythm is flat, and it competes poorly with status notices.
- Nearly every quiet state uses the same dark canvas, muted text, and cyan accent. The palette has good individual colors but too little spatial composition.

The solution is not more boxes. It is stronger surfaces, clearer rhythm, and a more decisive allocation of color.

## Electric Quiet visual system

### 1. The logo is the upper-left anchor

Use the checked-in [Signal b mark](brand/blupost-mark.svg) itself, or an asset derived from that exact SVG. Do not render the word `blupost` in the top-left. Do not substitute a plain `b`.

Preferred rendering order:

1. **Image-capable terminal:** render a transparent raster derived from `blupost-mark.svg`, preserving the lowercase-`b` silhouette and lower-left speech tail. Size it to `6×3` cells in roomy/standard layouts and `4×2` cells in compact/tiny layouts.
2. **Cell fallback:** render a checked-in, reviewed half-block mask derived from the same silhouette, colored with Signal cyan on the tail/stem and Post blue on the bowl. It must be snapshot-tested; it is a logo asset, not improvised ASCII text.
3. **Monochrome fallback:** render that same cell mask in the terminal foreground. Never fall back to the product word or a lone letter.

The logo is static in idle state. Its clear space is two columns at roomy/standard sizes and one column at compact/tiny sizes.

### 2. Surface hierarchy

There are only four persistent layers:

1. `canvas`: the terminal background and incoming-message field.
2. `navSurface`: the conversation rail.
3. `activeSurface`: selected rows and outgoing message slabs.
4. `composerSurface`: the raised input dock.

The sidebar and transcript are not separately boxed. One divider separates them in wide mode. The composer gets one top focus edge, not a rounded frame.

### 3. Spatial rhythm

- Base horizontal unit: `2` cells roomy/standard, `1` cell compact/tiny.
- Base vertical unit: `1` row.
- Conversation rows: `3` rows roomy, `2` standard, `2` compact list, `1` tiny list.
- Message groups: `1` blank row between direction changes; no blank row between adjacent messages in one group.
- Message width: maximum `68%` of transcript width roomy, `74%` standard, `88%` compact, `100%` tiny.
- Outgoing content never hugs the terminal edge; retain at least `2` cells right inset, `1` in tiny.
- Composer: `4–6` rows roomy, `4` standard, `3–4` compact, `3` tiny.

### 4. Semantic visual tokens

These values are the proposed dark truecolor baseline. Contrast figures are against `canvas` and are guidance for text roles, not a claim of web conformance for terminal rendering.

| Token | Value | Purpose |
| --- | --- | --- |
| `canvas` | `#061014` | Main transcript background |
| `navSurface` | `#0B1A21` | Conversation rail |
| `surfaceRaised` | `#10252E` | Composer and focused overlays |
| `surfaceHover` | `#14313B` | Pointer hover only |
| `selectionIdle` | `#12313A` | Selected thread while list is unfocused |
| `selectionFocus` | `#174957` | Selected thread while list is focused |
| `messageOutgoing` | `#102A36` | Outgoing message slab |
| `messageIncomingRail` | `#27444B` | Quiet incoming group rail |
| `divider` | `#1E4B57` | Single pane divider and inactive composer edge |
| `textPrimary` | `#E8FBF8` | Message bodies, active alias; about `17.94:1` |
| `textSecondary` | `#9AB5B8` | Labels and metadata; about `8.86:1` |
| `textTertiary` | `#759197` | Low-priority text; about `5.73:1` |
| `signalCyan` | `#57D6D1` | Logo start, links, connected/live state; about `10.94:1` |
| `postBlue` | `#65A9FF` | Logo finish, selection rail, primary action; about `7.94:1` |
| `signalBright` | `#8FEDEA` | Focus edge and brief arrival highlight |
| `success` | `#79DC9A` | Confirmed sent/saved; about `11.46:1` |
| `warning` | `#F1C86B` | Disconnected and indeterminate; about `12.10:1` |
| `danger` | `#FF7B86` | Failed/invalid; about `7.72:1` |
| `inverseText` | `#061014` | Text on bright action ribbons |

Rules:

- Cyan and blue are one identity family, not two competing accents.
- `signalCyan` describes live connectivity and links; `postBlue` describes selection and action.
- Green never means “connected”; it is reserved for confirmed object outcomes such as `Sent` or `Saved`.
- Amber carries both disconnected caution and `Check phone`, always with explicit wording.
- Do not use `dim` as the only hierarchy mechanism; terminal support varies.
- In 16-color/no-color modes, replace fill distinctions with reverse video, bold, underline, rails, and explicit glyphs.

## Component specifications

### Brand/status header

- Upper-left: Signal b logo only.
- Detail side: active alias in primary text, optional phone/device metadata in secondary text, connection capsule at the trailing edge.
- Connected capsule: `● Connected` in cyan plus text.
- Connecting: `◐ Connecting` with bounded spinner.
- Disconnected: `○ Disconnected` in amber; clickable/keyboard-accessible `Reconnect` only when the engine allows it.
- No full-width decorative border. A two-cell cyan/blue signature tick beneath the logo may connect the brand to the divider.

### Conversation row

Focused selected state combines all four cues:

- `▌` leading blue rail.
- Full-row `selectionFocus` fill.
- Bold/primary alias.
- Unread badge rendered as inverse text on `postBlue`.

Active but list-unfocused state keeps the rail and `selectionIdle` fill. A keyboard-selected but not engine-active row uses a thin `›` plus fill until Enter activates it. Draft uses a compact `draft` chip; unread count outranks draft. Preview is one line only and disappears before the alias or badge.

### Transcript group

- Group label appears once: contact alias for incoming, `You` for outgoing.
- Incoming group uses canvas plus a two-cell left inset and quiet rail; it does not get a large box.
- Outgoing group uses `messageOutgoing` fill with one-cell horizontal padding and a bright right rail. It reads as a message surface without drawing a full ASCII bubble.
- Adjacent messages in the same direction share alignment and rail; do not repeat the label.
- Links use cyan **and underline**.
- Selection uses inverse cyan/blue treatment without obscuring outcome text.
- No timestamps, delivery receipts, avatar initials, reactions, or history are invented.

### Message outcome

Outcome stays directly beneath the affected outgoing body:

- `◌ Sending…` — cyan, animated ellipsis/spinner.
- `✓ Sent` — success, then settles to secondary text after `800 ms`.
- `! Not sent` — danger, persistent.
- `? Check your phone — outcome unknown` — warning, persistent and never paired with one-key retry.

### Composer dock

The composer is the most prominent control surface:

- `surfaceRaised` background across the detail pane.
- Two-cell cyan/blue focus line on top; inactive uses `divider`.
- Recipient chip `To Alice` remains visible whenever height permits.
- Text area grows only to the tier’s maximum.
- Primary action is a filled blue ribbon: ` Send  ↵ `.
- Empty or disconnected send is visibly disabled without removing the draft surface.
- Disconnected truth appears inside the dock: `Draft stays here · nothing will queue`.
- Send errors remain inside the dock until resolved; a generic footer notice cannot overwrite them.

### Contextual action rail

Use Zellij-like segments rather than prose:

```text
 Enter  Send     Shift+Enter  New line     Tab  Focus     ?  Help
```

- Key token gets `postBlue` or `selectionIdle` background; action label remains secondary.
- Show no more than four actions at roomy/standard, three compact, and two tiny.
- Contents change with focus.
- Notices temporarily replace the leftmost low-priority action, never critical inline state.

### Command palette and help

- `Ctrl+P` opens a centered palette for `Add contact`, `Reconnect`, `Open help`, and future non-send operations.
- Search line on top, selected result surface, optional short description on roomy terminals.
- `?` opens context-first help, not a global wall of bindings.
- Sending remains direct from the composer and is not buried in the palette.

### Add-contact surface

- Wide/standard: replace the list content in place or use a focused overlay contained to the rail.
- Compact/tiny: full-pane form.
- Persistent labels, visible focus edge, local-save disclosure near `Save contact`, inline validation, and explicit `Save`/`Cancel` ribbons.
- The logo remains in the upper-left; the form does not become an unbranded utility screen.

### Empty state

Wide detail pane:

```text
                         [Signal b mark]

                         Start a conversation
                         Contacts stay on this machine.

                         Add contact  n
```

If contacts exist but none is selected: `Choose a conversation` plus one line explaining that session messages appear here. No CLI command, feature inventory, or decorative border appears in the primary empty state.

## Motion and feedback

Electric Quiet is not motionless, but every motion has a job.

| Event | Treatment | Duration/stop condition |
| --- | --- | --- |
| First interactive frame | The logo tail reveals once without moving layout or blocking input. | `160–220 ms`; skip in tests/non-TTY; never replay during the session. |
| Connecting | Four-frame activity glyph beside `Connecting`. | While a real attempt is active; stop immediately on terminal state. |
| Sending | Message-local spinner or stepped ellipsis. Composer stays usable according to engine rules. | While the exact send is in flight. |
| Incoming message | The relevant row rail and new message marker brighten, then settle. No transcript slide. | Two phases totaling at most `240 ms`. |
| Confirmed sent | `✓ Sent` enters in success color, then settles to secondary. | `800 ms`; final text persists. |
| Failed/unknown | No repeating pulse. Persistent danger/warning text appears immediately. | Until underlying object/state changes. |
| Focus/selection | Immediate cell update; no tween. | One frame. |

No idle pulse, shimmer, bouncing logo, pane slide, transcript flash, confetti, or continuous gradient animation. Static snapshots communicate every state completely.

## Responsive wireframes

The row/column ledgers are normative. The drawings are representative content maps; `▣` denotes the rendered Signal b asset, never a text wordmark.

### `120×34` — roomy list/detail

**Grid:** sidebar columns `0–31` (`32`), divider column `32` (`1`), detail columns `33–119` (`87`). Header rows `0–3` (`4`), transcript/list rows `4–27` (`24`), composer rows `28–31` (`4`), action rail rows `32–33` (`2`).

```text
  ▣▣       Conversations           │  Alice                                             ● Connected · iPhone
  ▣▣                               │  Session messages
  ▣▣       3 nearby                │
                                   │
  ▌ Alice                      2   │        Alice
    Are you still coming?          │        Are you still coming?
                                   │
    Mateo                  draft   │                                             You ▐
    Dinner moved to eight          │                           Yep — leaving in five. ▐
                                   │                                              ✓ Sent
    Casey                          │
    Link from this session         │        Alice
                                   │        Perfect. Door is unlocked.
                                   │
                                   │                              I’ll bring the adapter. ▐
                                   │                                      ◌ Sending… ▐
                                   │
                                   │
                                   │
                                   │
                                   │
                                   │
                                   │
  + Add contact                    │  To Alice
                                   │  ━━  Type a message…                                  Send  ↵
                                   │
 Enter Open   n New   / Find       │ Enter Send   Shift+Enter New line   Tab Focus          ? Help
```

Roomy character comes from the large branded header, confident selected row, message surfaces, and composer dock—not extra panes. Thread preview and device name are allowed here.

### `80×24` — standard list/detail

**Grid:** sidebar columns `0–23` (`24`), divider column `24` (`1`), detail columns `25–79` (`55`). Header rows `0–2` (`3`), transcript/list rows `3–18` (`16`), composer rows `19–22` (`4`), action rail row `23` (`1`).

```text
 ▣▣   Conversations      │ Alice                              ● Connected
 ▣▣                      │ Session messages
 ▣▣                      │
 ▌ Alice             2   │   Alice
   Are you still…        │   Are you still coming?
                         │
   Mateo          draft  │                         You ▐
   Dinner moved…         │       Yep — leaving in five. ▐
                         │                          ✓ Sent
   Casey                 │
   Link from this…       │   Alice
                         │   Perfect. Door is unlocked.
                         │
                         │
                         │
 + Add contact           │ To Alice
                         │ ━━ Type a message…        Send ↵
                         │
 Enter Open  n New       │ Enter Send  Tab Focus  ? Help
```

The preview remains, but secondary phone/session-count details disappear. The logo stays prominent and the wordmark remains absent.

### `60×18` — compact, one pane at a time

**Grid:** all columns `0–59`. Header rows `0–2` (`3`), transcript rows `3–12` (`10`), composer rows `13–16` (`4`), action rail row `17` (`1`). Conversation list is a separate pane reached by Back/Escape.

```text
 ▣▣   ‹ Chats   Alice                       ● Connected
 ▣▣
 ▣▣
      Alice
      Are you still coming?

                                  You ▐
                Yep — leaving in five. ▐
                                   ✓ Sent

      Alice
      Perfect. Door is unlocked.

 To Alice
 ━━ Type a message…                         Send ↵

 Esc Chats   Enter Send   ? Help
```

No stacked mini-sidebar. The logo, breadcrumb, recipient, status, transcript, and composer are all still legible.

### `40×12` — tiny, essential chat

**Grid:** all columns `0–39`. Header rows `0–1` (`2`), transcript rows `2–7` (`6`), composer rows `8–10` (`3`), action rail row `11` (`1`). Use the `4×2` asset-derived logo. Alias truncates before status; phone name, previews, labels, and secondary hints are removed.

```text
 ▣▣  ‹ Alice                 ● Online
 ▣▣
 Alice
 Are you still coming?

                Leaving in five. ▐
                           ✓ Sent

 To Alice
 ━ Type a message…          Send ↵

 Esc Chats       Enter Send       ?
```

At this size, “Online” is permitted as the compact display label only if it maps unambiguously to the existing connected state; otherwise retain `Connected`. The transcript gets every row left after the essential header, composer, and one-line rail.

## Focus, selection, and state matrix

| State | Rail | Fill | Text | Additional cue |
| --- | --- | --- | --- | --- |
| Unselected thread | None | `navSurface` | secondary | Hover may use `surfaceHover` |
| Keyboard-selected, list focused | Blue `▌` | `selectionFocus` | bold primary | `›` only if not engine-active |
| Engine-active, list unfocused | Muted blue `▌` | `selectionIdle` | primary | Detail header repeats alias |
| Unread | Blue rail if active/selected | State-dependent | bold primary | Inverse unread badge |
| Draft | State-dependent | State-dependent | primary | `draft` chip, lower priority than unread |
| Transcript focused | Group rails brighten slightly | unchanged | unchanged | Header/action rail change |
| Composer focused | Cyan/blue top edge | `surfaceRaised` | primary | Real cursor + `Send` ribbon |
| Disabled send | Divider edge | `surfaceRaised` | tertiary | Explicit disconnected/sending reason |

This redundancy is mandatory for no-color and low-contrast terminals.

## Keyboard and mouse contract

- Arrow keys and `j/k` move list selection; Enter activates.
- Tab/Shift-Tab changes regions; visual focus changes with it.
- Escape unwinds hierarchy: palette/help/form → chat → conversation list → quit only through the established safe route.
- Enter sends only from the composer under existing send rules; Shift+Enter inserts a newline.
- Rows, logo-adjacent connection control, add-contact action, send action, help, new-message marker, and HTTP(S) links are clickable.
- Wheel scrolling follows the region under the pointer.
- Drag selection in transcript text remains supported. If terminal mouse capture prevents native selection, help names the platform modifier/bypass; the app must not silently sacrifice copy behavior.
- Hover is additive feedback only. Every action remains visible and keyboard reachable without hover.

## Explicit anti-patterns

Do not ship any of the following in the next visual pass:

- The word `blupost` in the upper-left instead of the actual mark.
- A plain lowercase `b`, diamond, Office-style tile, generic chat icon, paper plane, or Bluetooth rune as the logo.
- A one-row global bar consisting only of wordmark plus status.
- Message bodies floating directly on an undifferentiated canvas with only `Alice`/`You` labels.
- Outgoing bodies pushed against the far-right terminal edge.
- A composer that reads as nothing more than a divider and textarea.
- A prose footer such as `Enter Send · Shift+Enter New line · Tab Focus` with no grouping or hierarchy.
- A tiny arrow as the only distinction between selection, focus, and active thread.
- Rounded or single-line boxes around every region, message, action, or form.
- Cyan applied to every title, label, selection, link, status, and action.
- Green for generic connectivity or blue/green semantics that imply SMS/iMessage transport type.
- Animated idle logo, background gradient, transcript slide, pane fade, bounce, shimmer, or confetti.
- Nerd Font-only icons or ambiguous glyphs without text fallback.
- A persistent multi-row logo at `40×12` that steals transcript space.
- Invented timestamps, synced history, delivery/read receipts, reactions, typing state, or retry affordances.
- A `Check phone` outcome that resembles success/failure or offers instant resend.

## Implementation sequence

1. **Brand shell:** replace header wordmark with the actual Signal b asset/fallback; implement the new surface tokens and connection capsule.
2. **Navigation:** rebuild thread rows with full-width fill, active rail, badges, and tier-specific preview removal.
3. **Conversation:** add incoming rails, outgoing slabs, bounded widths, grouped labels, and refined outcome presentation.
4. **Composer:** build the raised dock, focus edge, recipient chip, filled send ribbon, and inline disconnected/error states.
5. **Action rail:** replace prose keybar with responsive contextual ribbons and notice substitution.
6. **Overlays:** add a Posting/Telescope-style command palette and visually integrated help/contact surfaces.
7. **Motion:** add only the bounded logo reveal and state-driven operation/arrival transitions after static frames pass.
8. **Fallbacks:** verify truecolor, 256-color, 16-color, monochrome, image-capable, and cell-logo presentations.

## Acceptance criteria

The redesign is not complete until deterministic frames prove all of these:

- At `120×34`, `80×24`, `60×18`, and `40×12`, the actual Signal b mark is the upper-left identity and the word `blupost` is absent there.
- A viewer can identify selected thread, focused region, active recipient, and connection state in under a glance.
- The selected contact is a decisive full-row surface, not a faint line or lone arrow.
- Incoming and outgoing messages form a coherent dialogue even in monochrome.
- The outgoing surface never touches the right terminal edge.
- The composer is the strongest interactive surface and always names the recipient when space permits.
- Disconnected drafts remain editable and explicitly say nothing will queue.
- Send outcomes remain attached to their exact messages; `Check phone` is visibly indeterminate.
- Compact sizes show one pane at a time; no miniature stacked list survives.
- The action rail shows at most `4/4/3/2` actions across roomy/standard/compact/tiny.
- No idle render loop exists after bounded motion completes.
- Mouse users can click and scroll without losing a documented way to select/copy transcript text.
- Keyboard-only and no-color reviews preserve every essential distinction.

## Final direction in one frame

Electric Quiet should be recognizable with the transcript removed:

- Signal b in the upper-left.
- Deep ink canvas.
- Cyan-to-blue active rail.
- One strong selected row.
- One raised composer dock.
- A few compact action ribbons.

It should be recognizable with color removed:

- Logo silhouette.
- Stable list/detail or one-pane composition.
- Rails, alignment, fill/reverse video, labels, and glyphs.
- Message-local outcomes and a clearly focused composer.

That combination—not extra decoration—is what will make Blupost feel both lively and minimal.
