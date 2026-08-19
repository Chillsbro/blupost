# Blupost identity and motion

## Direction: Signal b

Blupost's mark is a bold lowercase `b` with a speech tail trailing directly from its outer bowl.

![Blupost lockup](brand/blupost-lockup.svg)

It reads twice without becoming two icons: first as the initial in **blupost**, then as a conversation bubble. There is no hidden symbol, attached badge, document shape, or containing app tile.

This is a companion to the [Electric Quiet interface direction](TUI_VISUAL_RESEARCH.md). Electric Quiet defines the product experience; Signal b gives it one compact signature. The earlier [product design study](DESIGN_RESEARCH.md) remains background research.

## What the mark means

![Blupost mark](brand/blupost-mark.svg)

- The outer silhouette is an unmistakable lowercase `b`: direct, friendly, and specific to the name.
- The counter remains a clean, ordinary letter counter; the small lower-left tail is the only conversational gesture.
- The tail continues the bowl's silhouette instead of stacking a letter on a generic chat icon.
- The heavy form stays legible at terminal-adjacent sizes while the open center keeps it from feeling like an app tile.
- The shape avoids Apple's exact bubble proportions and blue/green semantics, plus the Bluetooth rune, paper planes, clouds, locks, documents, and delivery checkmarks.

The preferred plain-language descriptor is:

> Messages between devices you own.

An optional editorial line, never part of the logo lockup, is:

> Your messages. Your machines.

## Assets

| Asset | Purpose |
| --- | --- |
| [`preview.html`](brand/preview.html) | Responsive visual brand board and animation preview |
| [`blupost-mark.svg`](brand/blupost-mark.svg) | Primary transparent gradient Signal b |
| [`blupost-mark-mono.svg`](brand/blupost-mark-mono.svg) | Single-color mark for print, masks, and constrained surfaces |
| [`blupost-lockup.svg`](brand/blupost-lockup.svg) | Primary horizontal presentation on the Blupost night surface |
| [`blupost-post.svg`](brand/blupost-post.svg) | Repeating documentation preview of the trailing-tail reveal |

The mark SVG is the source of truth. Raster exports should be generated from it rather than redrawn.

## Construction

The mark has one lowercase form, one counter, and one integrated continuation of the bowl.

- Canvas: square, with the form optically centered rather than mathematically squeezed into every edge.
- Outer form: a rounded lowercase `b` with a tall stem and generous bowl.
- Counter: a plain rounded opening that keeps the letter immediately recognizable.
- Speech tail: a short down-left continuation where the bowl meets the stem, visually fused into the same silhouette.
- Clear space: at least the width of the stem on every side.
- Minimum digital size: 16 px for the mark, 120 px wide for the lockup.
- At 16–20 px, prefer monochrome and accept that the speech tail becomes a subtle discovery.
- Never detach or overgrow the tail, add a badge, place message lines inside the counter, or turn the mark into a rounded-square app icon.
- Never squeeze, shear, rotate, double-outline, shadow, glow, or decorate the source mark.

The wordmark and mark both use lowercase `b`. The checked-in lockup uses an open system-font stack for portability; an approved release lockup should convert the final wordmark to paths before distribution.

## Color

| Token | Value | Use |
| --- | --- | --- |
| Signal cyan | `#57D6D1` | Left edge and beginning of the signature gradient |
| Post blue | `#65A9FF` | Bowl and gradient finish |
| Signal white | `#E6F7F5` | Wordmark on dark surfaces |
| Blupost night | `#071117` | Branded presentation surface only |
| Quiet border | `#173642` | Optional edge on a dark presentation card |

The gradient belongs to the identity; it is not a status scale. Failure must not make the logo red, and success must not make it green.

Inside the terminal, use the asset-derived cyan/blue rendering when image or truecolor support permits it. The reviewed cell mask and monochrome fallback preserve the same silhouette without depending on the gradient.

## Motion concept: The Trail

![Blupost speech-tail reveal](brand/blupost-post.svg)

The lowercase `b` is already in place. Its speech tail trails out from the lower bowl, revealing the second reading without moving the surrounding layout.

The documentation SVG repeats every 3.2 seconds so the motion can be reviewed. Product motion never loops for branding.

### Brand-board timing

| Time | Event |
| ---: | --- |
| 0–80 ms | The mark's location is reserved; surrounding layout is stable |
| 80–160 ms | The clean lowercase `b` is already visible |
| 160–400 ms | The speech tail extends from 35% to its final length |
| 400–480 ms | The finished Signal b remains completely still |

Use `cubic-bezier(.2, .8, .2, 1)` for the speech tail. There is no bounce, overshoot, rotation, blur, wobble, elastic spring, or particle trail.

The product TUI does not attempt to reproduce this vector construction in terminal cells. It reserves the final `6×3` or `4×2` mark immediately and performs one bounded intensity reveal over `200 ms`. Noninteractive and deterministic runs snap directly to full intensity.

### Product behavior

The animation is presentation state only. It cannot initiate, delay, retry, reorder, or imply completion of a transport operation.

- Keep the wordmark, layout, transcript, and composer completely still.
- Do not hide the application behind a logo animation or delay keyboard input.
- Do not replay the mark when switching threads, receiving a message, or focusing the composer.
- On a vector brand surface, play it once when the surface appears and hold the final mark.
- In the TUI, render the actual asset-derived Signal b in the upper-left. Never substitute the word `blupost`, a plain letter, or a generic chat glyph there. Connection and send activity belong beside their literal status text.
- The TUI reveal animates only mark intensity for `200 ms` and never uses that color change as status.
- Noninteractive output and deterministic tests render the final frame directly.
- Idle state has no animation and consumes no render ticks.

This replaces the current full-root startup fade. It does not add a second decorative animation system.

## Terminal translation

The checked-in SVG remains the source of truth, and the bundled TUI carries a transparent raster derived from it. Image-capable terminals render that asset directly; OpenTUI's block fallback produces the reviewed multi-cell silhouette. Roomy and standard layouts reserve `6×3` cells; compact and tiny layouts reserve `4×2`. Monochrome keeps the same mask in the terminal foreground. The upper-left never falls back to a wordmark or lone `b`.

The adjacent connection capsule is authoritative: `● Connected`, `◐ Connecting`, `○ Disconnected`, or explicit failure text. In constrained color modes, the glyph and wording preserve the distinction without color.

For a send, keep the brand mark static and attach progress to the outgoing message:

```text
◌ Sending…
✓ Sent
! Not sent
? Check your phone — outcome unknown
```

That keeps truth attached to the object it describes and prevents the header from appearing to confirm a message outcome.

## Accessibility and restraint

- Every animated operational state has a stable text label.
- Motion never changes layout or blocks keyboard input.
- There is no idle pulse, shimmer, blinking brand mark, or ambient loop.
- The checked-in SVG preview honors `prefers-reduced-motion` and becomes the final static mark.
- The terminal product retains automatic noninteractive/test snapping rather than inventing a terminal preference it cannot detect reliably.
- Color never distinguishes connecting, connected, uncertain, and failed states by itself.

## Review criteria

The identity is ready to integrate when all of the following are true:

1. Viewers read a lowercase `b` immediately and discover the message bubble second.
2. The mark remains legible at 16, 24, 32, 64, and 256 px and in monochrome.
3. The trailing point reads as part of the bowl rather than a second pasted-on icon or a damaged letter.
4. The logo is visibly distinct from Office document marks, Apple Messages, Signal, WhatsApp, Bluetooth, and generic chatbot icons.
5. The TUI renders the actual Signal b asset/fallback at every supported tier and never substitutes a wordmark or lone letter.
6. Idle CPU and render activity remain unchanged after any reveal completes.
7. Light, dark, 256-color, 16-color, and no-color presentations remain legible.

This visual review is not trademark clearance. That should happen after the direction is approved and before release packaging.

## Integration sequence

1. Review Signal b at 16, 24, 32, 64, and 256 px plus monochrome.
2. Render the actual Signal b asset/fallback in the upper-left with literal connection text beside it.
3. Remove the full-root startup fade.
4. If a mark reveal remains, keep it to the bounded tail extension through the existing motion controller.
5. Keep outgoing-message motion local to the message row and label it `Sending…`.
6. Add deterministic frame tests, cell-width checks, idle-render tests, and noninteractive snap tests.
7. Convert the approved wordmark to vector paths and export release PNGs only after the direction is accepted.

## Explicit non-goals

- No separate chat icon plus letter, attached badge, folded document, diamond, relay gate, Bluetooth rune, paper plane, cloud, lock, shield, or delivery checkmark.
- No Apple-style materials, exact Messages bubble proportions, or blue/green delivery semantics.
- No animated Kitty image required for the core identity.
- No logo animation as a substitute for a progress label.
- No claim of encryption, delivery receipts, history sync, or cloud independence beyond what Blupost actually guarantees.
