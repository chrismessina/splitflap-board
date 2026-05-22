# Split-Flap Board

A browser-based split-flap ("clicky-clacky") display generator, inspired by
the Vestaboard. Type a message and watch each cell flip through the character
reel into place — then record the animation as a video for slides or social.

**Live:** https://chrismessina.github.io/splitflap-board/

## Features

- Vestaboard-style split-flap animation with per-cell jitter and stagger
- Configurable grid (defaults to 1 row sized to your text)
- Color themes — built-in Black/White, plus importable and fully custom
  themes with a live hex editor
- Optional colored "bit" tiles
- Synthesized clacky sound (Dry / Woody / Sharp / Random), mixed into exports
- Adjustable flip count and speed; auto-loop mode
- Video export at 1920×1080 (WebM, plus MP4/H.264 where the browser supports it)
- Settings persist across reloads

## Shareable links

Pass an initial message via the `text` query parameter:

```
https://chrismessina.github.io/splitflap-board/?text=HELLO%20WORLD
```

The board opens with that text already set (URL-encoded, so spaces and
punctuation work). It's treated as your saved text and persists on reload.

## Running locally

No build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly also works, though a local server is
recommended so font loading and recording behave consistently.

## Stack

Plain HTML, CSS, and vanilla JavaScript. The board renders to a `<canvas>`
so the animation can be captured via `MediaRecorder`. The only external
dependency is Google Fonts (loaded via `<link>`, with a local font-stack
fallback).
