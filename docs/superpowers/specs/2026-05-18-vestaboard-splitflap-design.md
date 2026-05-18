# Vestaboard Split-Flap Web App — Design

**Date:** 2026-05-18
**Status:** Approved (pending spec review)

## Purpose

A throwaway browser prototype that renders a typed message as an animated
Vestaboard-style split-flap ("clicky-clacky") display, with the ability to
export the animation as a downloadable video for a pitch deck.

This is a prototype to demo to a stakeholder. No tests, no build tooling, no
framework. Optimize for speed of delivery and visual credibility, not code
hygiene.

## Stack

- Single-page app: `index.html`, `app.js`, `style.css`. No build step, no
  server, no dependencies except Google Fonts via `<link>`.
- Opens by double-clicking `index.html` in a modern browser (Chrome/Safari).
- Board is rendered on an HTML `<canvas>` (2D context). Chosen over DOM tiles
  so `MediaRecorder` can capture the canvas stream natively and reliably for
  video export.
- **Font loading reliability:** all canvas drawing (first paint, every flip
  frame, and especially export) is gated on `await document.fonts.ready`.
  The default font stack lists a real local fallback first
  (`Helvetica Neue, Helvetica, Arial, sans-serif`) so the board renders
  correctly even fully offline; Google Fonts are progressive enhancement,
  never a hard dependency. The export button stays disabled until fonts have
  resolved at least once.

## Character Set / Flip Reel

The reel order is a **visible animation contract** (cells flip forward through
it), so it is locked here exactly, derived from the official Vestaboard
character codes (https://docs.vestaboard.com/docs/charactercodes/).

The reel is the ordered sequence of (code, glyph) pairs below. Unused/gap
codes (43, 45, 51, 57, 58, 61) simply do not exist on the reel — a flipping
cell advances to the next *present* entry, wrapping from the last back to
code 0.

```
 0  (blank)
 1–26  A B C D E F G H I J K L M N O P Q R S T U V W X Y Z
 27–35 1 2 3 4 5 6 7 8 9
 36  0
 37  !
 38  @
 39  #
 40  $
 41  (
 42  )
 44  -
 46  +
 47  &
 48  =
 49  ;
 50  :
 52  '
 53  "
 54  %
 55  ,
 56  .
 59  /
 60  ?
```

Implemented as a single ordered constant array `REEL` (index = reel position,
not Vestaboard code). Color chips (codes 62–71) and the degree/heart glyph
are intentionally excluded — out of scope.

- Input is uppercased. Characters not present on the reel render as blank
  (reel position 0).
- Each cell flips **forward through `REEL`**, wrapping past the end, from its
  current position until it reaches its target glyph — mimicking a physical
  split-flap reel.

## Board Model

- Grid is `rows × cols`, both user-configurable.
- **Default:** `rows = 1`, `cols = message length including spaces`.
- The default `cols` re-derives from message length whenever the message
  changes, *unless* the user has manually edited rows/cols (manual override
  sticks until they hit a "reset to message length" affordance).
- Message is laid into the grid left-to-right, top-to-bottom. Cells with no
  character show the blank reel position.

## Cell Rendering (visual fidelity: option C)

Each cell is drawn on the canvas as a split-flap tile:

- Top half and bottom half with subtle vertical gradients (top lighter,
  bottom darker).
- 1px black seam across the horizontal midline.
- Soft drop shadow around the tile.
- White glyph (`#f4f4f4`-ish) in the chosen typeface, centered, spanning the
  seam.
- Tile and glyph sizes scale so the full grid fits the viewport/canvas.

The flip is rendered as a sequence of discrete frames: the top half visually
"falls" to reveal the next reel glyph (a vertical scale/skew on the top half
per intermediate step). Fidelity of the fold can be approximate — the
staggered timing sells the effect more than per-flap 3D accuracy.

## Animation Engine

- **Flip count:** user-set base integer = number of intermediate flips per
  cell before it lands. Each cell adds a random jitter (e.g. `base + rand(0..6)`)
  AND a small random start delay, so cells finish at different times — an
  organic ripple, never a synchronized thump.
- **Speed:** adjustable control setting per-flip duration in ms, independent
  of flip count.
- **Auto-loop toggle:**
  - ON → board cycles indefinitely: hold target → scramble → reflip to
    target → hold → repeat. The flip-count input is **disabled and visually
    greyed out** (loop manages its own counts), but the app **retains the
    last flip-count value** in state so export and a later toggle-off can
    use it.
  - OFF → flip-count input active. Pressing **Flip** runs the sequence once
    and holds on the final message.

## Controls Panel

- Message text input.
- **Flip** button (runs one animation when not auto-looping).
- Rows number input + Cols number input + a "reset to message length" control.
- Flip-count number input (disabled when auto-loop is on).
- Speed slider (per-flip duration).
- Auto-loop toggle switch.
- Background color picker — default near-black `#0a0a0a`.
- Typeface dropdown — curated set of ~4–5:
  - **Geist Mono Light (default)** — loaded via Google Fonts, weight 300
  - Helvetica / Inter
  - DM Mono
  - a condensed sans
  - a humanist sans
  - loaded via Google Fonts where not web-safe.

All defaults are derived from the Vestaboard samples and remain user-overridable.

## Video Export

A **Record & Download** button. Export is a **dedicated, deterministic
sequence** that takes over animation state — it does NOT capture whatever the
board happens to be doing. This guarantees a clean, repeatable deck asset
regardless of the auto-loop toggle.

**Export contract (locked):**

- **Canvas size during export:** `1920 × 1080`. The board is laid out and
  centered within this frame on the chosen background. (The on-screen canvas
  may be a different size; export uses a fixed 1080p backing store so the
  asset is deck-ready.)
- **Frame rate:** `canvas.captureStream(30)` → 30 fps.
- **Fonts:** `await document.fonts.ready` before the first export draw. Export
  button is disabled until fonts have loaded at least once.
- **Recorded timeline (single run, deterministic):**
  1. **Pre-roll:** 250 ms holding the fully-scrambled / blank start state.
  2. **Animation:** one full flip run to the target message, using the
     current flip-count + speed settings (jitter still applies for the
     organic ripple; not seeded — acceptable for a prototype, each export
     varies slightly).
  3. **Final hold:** 1500 ms holding the completed message.
- **Auto-loop is ignored during export.** If auto-loop is ON, export
  temporarily suspends the loop, runs the deterministic single-run timeline
  above, then restores the prior loop state when done. The flip-count value
  used is the last value the user set even though its input was greyed out
  (the app retains it).
- Output is a `.webm` blob (VP8/VP9 via `MediaRecorder`), auto-downloaded.
  Contains only the board on the chosen background — no cursor, no chrome.
- WebM imports into Keynote/PowerPoint. The UI shows a documented ffmpeg
  one-liner (`ffmpeg -i vestaboard.webm vestaboard.mp4`) for users needing
  MP4.

## Defaults Summary

| Setting     | Default                          |
|-------------|----------------------------------|
| Background  | `#0a0a0a` (near-black)           |
| Typeface    | Geist Mono Light (weight 300)    |
| Grid        | 1 × message-length               |
| Speed       | "snappy" per-flip duration       |
| Flip count  | a sensible mid value (e.g. 12)   |
| Auto-loop   | off                              |

## Out of Scope

- Color chip tiles.
- Persisting settings between sessions.
- Mobile layout polish.
- Tests, build pipeline, framework.

## Open Questions

None outstanding. All design decisions resolved during brainstorming.
