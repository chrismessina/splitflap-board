'use strict';

/* ------------------------------------------------------------------ *
 * REEL — visible animation contract.
 * Order locked to official Vestaboard character codes:
 *   blank, A-Z, 1-9, 0, then punctuation in code order.
 * Gap codes (43,45,51,57,58,61) are simply absent from the reel.
 * Index = reel position (NOT the Vestaboard numeric code).
 * ------------------------------------------------------------------ */
const REEL_TEXT = [
  ' ',
  'A','B','C','D','E','F','G','H','I','J','K','L','M',
  'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  '1','2','3','4','5','6','7','8','9','0',
  '!','@','#','$','(',')','-','+','&','=',';',':',
  "'",'"','%',',','.','/','?'
];

/* Color chip tiles — Vestaboard codes 63-68 (red, orange, yellow, green,
 * blue, violet). Represented internally as Unicode Private Use Area
 * sentinel chars (U+E001..U+E006) so they slot into REEL like any other
 * glyph but never collide with real text. When 'Show colored bits' is on,
 * these positions are part of the reel; when off, they're excluded.
 */
const CHIP_COLORS = ['#dc3545','#f08a24','#f2c618','#3aa55d','#3e7bd6','#8a4baf'];
const CHIP_KEYS = CHIP_COLORS.map((_, i) => String.fromCharCode(0xE001 + i));
const CHIP_CHARS = {};
CHIP_KEYS.forEach((k, i) => { CHIP_CHARS[k] = CHIP_COLORS[i]; });
const REEL_BITS = REEL_TEXT.concat(CHIP_KEYS);

// Active reel depends on state.showBits; resolved lazily.
let REEL = REEL_TEXT;
let REEL_INDEX = new Map();
function rebuildReelIndex() {
  REEL_INDEX = new Map();
  REEL.forEach((ch, i) => { if (!REEL_INDEX.has(ch)) REEL_INDEX.set(ch, i); });
}
rebuildReelIndex();
const posOf = ch => REEL_INDEX.has(ch) ? REEL_INDEX.get(ch) : 0;
const isChip = ch => Object.prototype.hasOwnProperty.call(CHIP_CHARS, ch);

/* ------------------------------------------------------------------ *
 * Color themes. Each theme defines four colors:
 *   bg     — page/canvas background behind the board
 *   tile   — base tile face color
 *   text   — glyph color
 *   accent — used for seam, shadow rim, and (on light themes) the
 *            "empty slot" outline tint
 * isLight switches the empty-cell rendering: deep recess vs. ghosted slot.
 * ------------------------------------------------------------------ */
const BUILTIN_THEMES = {
  black: {
    name: 'Black', builtin: true, isLight: false,
    bg: '#0a0a0a', tile: '#161616', text: '#f4f4f4', accent: '#000000',
  },
  white: {
    // Matches the off-white Vestaboard product photography.
    name: 'White', builtin: true, isLight: true,
    bg: '#eceaea', tile: '#f7f7f7', text: '#111111', accent: '#b6b6b6',
  },
};

/* Tiny named-color palette used to auto-name imported themes. The importer
 * picks the closest entry to the imported background color. */
const NAMED_COLORS = [
  ['Black',      0x111111], ['Charcoal',   0x2c2c2c], ['Slate',      0x546e7a],
  ['Steel',      0x607d8b], ['Snow',       0xf7f7f7], ['Ivory',      0xf0e9d2],
  ['Sand',       0xd6c79a], ['Stone',      0xa39e93], ['Plum',       0x611f69],
  ['Aubergine',  0x39063a], ['Violet',     0x8a4baf], ['Lavender',   0xc7b8e6],
  ['Magenta',    0xc474d3], ['Rose',       0xe4a0c2], ['Crimson',    0xa3193d],
  ['Brick',      0xa3441f], ['Orange',     0xf08a24], ['Amber',      0xf2c618],
  ['Lemon',      0xfde047], ['Olive',      0x6b7d2c], ['Forest',     0x1f5132],
  ['Emerald',    0x20a271], ['Mint',       0x4cc894], ['Teal',       0x0e7c86],
  ['Aqua',       0x4dd0e1], ['Sky',        0x4ea1d3], ['Cobalt',     0x1f4b99],
  ['Navy',       0x0a1f4a], ['Royal',      0x3e7bd6], ['Indigo',     0x3d2b8f],
];
function hexToRgb(hex) {
  const h = hex.replace('#','');
  const n = parseInt(h.length === 3
    ? h.split('').map(c => c+c).join('')
    : h.slice(0,6), 16);
  return [(n>>16)&255, (n>>8)&255, n&255];
}
function rgbDist2(a, b) {
  const dr=a[0]-b[0], dg=a[1]-b[1], db=a[2]-b[2];
  return dr*dr + dg*dg + db*db;
}
function nearestNamedColor(hex) {
  const rgb = hexToRgb(hex);
  let best = NAMED_COLORS[0], bestD = Infinity;
  for (const [name, color] of NAMED_COLORS) {
    const d = rgbDist2(rgb, [(color>>16)&255,(color>>8)&255,color&255]);
    if (d < bestD) { best = [name,color]; bestD = d; }
  }
  return best[0];
}

/* Permissive hex extractor: pulls any #?RGB / #?RGBA / #?RRGGBB / #?RRGGBBAA
 * tokens out of an arbitrary string and normalizes to #RRGGBB. */
function parseHexList(input) {
  const matches = (input || '').match(/#?[0-9a-fA-F]{3,8}/g) || [];
  const out = [];
  for (let m of matches) {
    m = m.replace('#','');
    if (m.length === 3) m = m.split('').map(c => c+c).join('');
    else if (m.length === 4) m = m.slice(0,3).split('').map(c => c+c).join('');
    else if (m.length === 6) { /* ok */ }
    else if (m.length === 8) m = m.slice(0,6);
    else continue;
    if (!/^[0-9a-fA-F]{6}$/.test(m)) continue;
    out.push('#' + m.toLowerCase());
  }
  return out;
}

/* Build a theme from a list of hex colors. Slack's share format gives 4;
 * we tolerate 2-8 by filling missing slots with sensible derivations. */
function themeFromHexes(hexes, fallbackName) {
  if (hexes.length < 2) return null;
  const bg     = hexes[0];
  const tile   = hexes[1] || bg;
  const text   = hexes[2] || (relativeLuminance(bg) > 0.5 ? '#111111' : '#f4f4f4');
  const accent = hexes[3] || tile;
  const isLight = relativeLuminance(bg) > 0.55;
  return {
    name: fallbackName || nearestNamedColor(bg),
    builtin: false, isLight, bg, tile, text, accent,
  };
}
function relativeLuminance(hex) {
  const [r,g,b] = hexToRgb(hex).map(v => {
    v /= 255;
    return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
  });
  return 0.2126*r + 0.7152*g + 0.0722*b;
}

/* ------------------------------------------------------------------ *
 * Video formats. MediaRecorder can only encode what the browser ships.
 * WebM is universally available. MP4/H.264 exists in some builds.
 * H.265/HEVC is essentially never available client-side and is omitted.
 * ------------------------------------------------------------------ */
const FORMATS = {
  webm:    { label: 'WebM (VP9)',      mime: 'video/webm;codecs=vp9', ext: 'webm' },
  webm8:   { label: 'WebM (VP8)',      mime: 'video/webm;codecs=vp8', ext: 'webm' },
  mp4h264: { label: 'MP4 (H.264)',     mime: 'video/mp4;codecs=avc1', ext: 'mp4'  },
};
function populateFormats() {
  els.format.innerHTML = '';
  let first = null;
  for (const [key, f] of Object.entries(FORMATS)) {
    if (!MediaRecorder.isTypeSupported(f.mime)) continue;
    const o = document.createElement('option');
    o.value = key; o.textContent = f.label;
    els.format.appendChild(o);
    if (!first) first = key;
  }
  if (!first) {                                  // last-ditch fallback
    const o = document.createElement('option');
    o.value = 'webm'; o.textContent = 'WebM';
    els.format.appendChild(o);
  } else {
    els.format.value = first;
  }
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */
const els = {
  canvas:   document.getElementById('board'),
  message:  document.getElementById('message'),
  rows:     document.getElementById('rows'),
  cols:     document.getElementById('cols'),
  resetGrid:document.getElementById('resetGrid'),
  flips:    document.getElementById('flips'),
  speed:    document.getElementById('speed'),
  speedOut: document.getElementById('speedOut'),
  loop:     document.getElementById('loop'),
  sound:    document.getElementById('sound'),
  soundStyle: document.getElementById('soundStyle'),
  theme:    document.getElementById('theme'),
  importTheme: document.getElementById('importTheme'),
  themeEditor: document.getElementById('themeEditor'),
  themeName: document.getElementById('themeName'),
  themeSave: document.getElementById('themeSave'),
  themeDelete: document.getElementById('themeDelete'),
  nativeColor: document.getElementById('nativeColor'),
  bits:     document.getElementById('bits'),
  font:     document.getElementById('font'),
  format:   document.getElementById('format'),
  flip:     document.getElementById('flip'),
  record:   document.getElementById('record'),
  status:   document.getElementById('status'),
  panel:    document.getElementById('panel'),
  sidebarToggle: document.getElementById('sidebarToggle'),
  sidebarRestore: document.getElementById('sidebarRestore'),
  importDialog: document.getElementById('importDialog'),
  importText: document.getElementById('importText'),
  importConfirm: document.getElementById('importConfirm'),
  importError: document.getElementById('importError'),
};
const ctx = els.canvas.getContext('2d');

/* ------------------------------------------------------------------ *
 * Persistence — settings round-trip through localStorage.
 * Saved on every relevant change; restored at boot.
 * ------------------------------------------------------------------ */
const STORAGE_KEY = 'vestaboard-splitflap.v1';

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      text: els.message.value,
      rows: state.rows,
      cols: state.cols,
      gridManual: state.gridManual,
      flipBase: state.flipBase,
      speed: state.speed,
      looping: els.loop.checked,
      sound: els.sound.checked,
      soundStyle: state.soundStyle,
      themeId: state.themeId,
      customThemes: state.customThemes,
      showBits: state.showBits,
      font: els.font.value,
      format: els.format.value,
      sidebarCollapsed: state.sidebarCollapsed,
    }));
  } catch (_) { /* private mode / quota — silently ignore */ }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

const state = {
  rows: 1,
  cols: 5,
  themeId: 'black',         // key into themes() table
  customThemes: {},          // imported themes keyed by id
  draftTheme: null,          // in-progress edits when editor is open
  showBits: false,
  font: els.font.value,
  flipBase: 12,            // retained even while greyed out by auto-loop
  speed: 70,               // ms per flip
  gridManual: false,       // user overrode rows/cols
  cells: [],               // per-cell state
  running: false,
  looping: false,
  exporting: false,
  fontsReady: false,
  sound: false,
  soundStyle: 'dry',
  sidebarCollapsed: false,
};

function themes() { return { ...BUILTIN_THEMES, ...state.customThemes }; }
function currentTheme() {
  // While the user has the editor open (state.themeId === '__custom__',
  // or any saved custom is selected), state.draftTheme reflects the live
  // edits. The render path always reads through currentTheme(), so any
  // mutation to draftTheme + render() shows up instantly on the board.
  if (state.draftTheme) return state.draftTheme;
  return themes()[state.themeId] || BUILTIN_THEMES.black;
}

/* Whether to show the editor for the current selection. */
function isEditorTheme(id) {
  return id === '__custom__' || !!state.customThemes[id];
}

function applyShowBits() {
  REEL = state.showBits ? REEL_BITS : REEL_TEXT;
  rebuildReelIndex();
  // Each existing cell's pos may point past the new reel length — clamp.
  for (const c of state.cells) {
    if (c.pos >= REEL.length) c.pos = 0;
    if (c.prevPos >= REEL.length) c.prevPos = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Audio — synthesized "clack" per flip.
 * A shared AudioContext; during export its output is also routed into a
 * MediaStreamAudioDestinationNode so the recorded video carries sound.
 * ------------------------------------------------------------------ */
let audioCtx = null;
let recDest = null;            // set only while exporting

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/* Voice presets: each (freq, Q, duration, peak gain, attack) shapes the
 * filtered-noise burst into a distinct character. */
const CLACK_VOICES = {
  dry:   { freq: 1500, freqJitter: 400, q: 1.2, dur: 0.04, peak: 0.45, attack: 0.002 },
  woody: { freq:  600, freqJitter: 120, q: 4.0, dur: 0.07, peak: 0.55, attack: 0.004 },
  sharp: { freq: 3500, freqJitter: 600, q: 6.0, dur: 0.02, peak: 0.40, attack: 0.001 },
};
const VOICE_KEYS = ['dry', 'woody', 'sharp'];

function clack() {
  if (!state.sound) return;
  const ac = ensureAudio();
  const t = ac.currentTime;

  const style = state.soundStyle === 'random'
    ? VOICE_KEYS[Math.floor(Math.random() * VOICE_KEYS.length)]
    : state.soundStyle;
  const v = CLACK_VOICES[style] || CLACK_VOICES.dry;

  const len = Math.max(1, Math.floor(ac.sampleRate * v.dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;

  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = v.freq + (Math.random() - 0.5) * 2 * v.freqJitter;
  bp.Q.value = v.q;

  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v.peak, t + v.attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);

  src.connect(bp).connect(g);
  g.connect(ac.destination);
  if (recDest) g.connect(recDest);   // also feed the recording mix
  src.start(t);
  src.stop(t + v.dur + 0.01);
}

/* ------------------------------------------------------------------ *
 * Grid / message
 * ------------------------------------------------------------------ */
function targetsFromMessage() {
  const raw = els.message.value.toUpperCase();
  const total = state.rows * state.cols;
  const out = new Array(total).fill(' ');
  for (let i = 0; i < Math.min(raw.length, total); i++) {
    const ch = raw[i];
    out[i] = REEL_INDEX.has(ch) ? ch : ' ';
  }
  return out;
}

function rebuildCells(initialPos) {
  const targets = targetsFromMessage();
  state.cells = targets.map(t => ({
    pos: initialPos != null ? initialPos : posOf(t),
    target: t,
    remaining: 0,
    delay: 0,
    frameAcc: 0,
    flipT: 1,            // 0..1 fold progress of the current single flip
    prevPos: initialPos != null ? initialPos : posOf(t),
  }));
}

function syncDefaultGrid() {
  if (state.gridManual) return;
  const len = Math.max(1, els.message.value.length);
  state.rows = 1;
  state.cols = len;
  els.rows.value = 1;
  els.cols.value = len;
}

/* ------------------------------------------------------------------ *
 * Canvas sizing & drawing
 * ------------------------------------------------------------------ */
const GAP = 0.10;          // gap as fraction of cell width
const ASPECT = 1.32;       // cell height / width

function layout(canvasW, canvasH) {
  const cols = state.cols, rows = state.rows;
  const cw = canvasW / (cols + (cols + 1) * GAP);
  const ch = cw * ASPECT;
  const gx = cw * GAP;
  const gridH = rows * ch + (rows + 1) * gx;
  const offY = (canvasH - gridH) / 2;
  const offX = gx;
  return { cw, ch, gx, offX, offY };
}

/* Slightly perturb a hex color by `amt` (-1..+1 of channel space). Used to
 * derive the tile's top/bottom gradient from the theme.tile color. */
function shiftColor(hex, amt) {
  const [r,g,b] = hexToRgb(hex);
  const f = v => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/* Draw a single glyph (or a chip solid). The char may be:
 *   - a space        — nothing drawn (blank reel position)
 *   - a CHIP sentinel — paints a solid colored rectangle (no text)
 *   - any other char — drawn as text in theme.text color
 */
function drawCellGlyph(x, y, w, h, char, theme) {
  if (char === ' ') return;
  if (isChip(char)) {
    ctx.fillStyle = CHIP_CHARS[char];
    ctx.fillRect(x, y, w, h);
    return;
  }
  ctx.fillStyle = theme.text;
  ctx.font = state.font.replace('1em', Math.round(h * 0.62) + 'px');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, x + w / 2, y + h / 2 + h * 0.02);
}

function drawCell(x, y, w, h, cell, theme) {
  const r = Math.max(2, w * 0.05);

  // Theme-derived tile gradient (top lighter, bottom darker)
  const top1 = shiftColor(theme.tile, theme.isLight ? -0.02 : +0.04);
  const top2 = shiftColor(theme.tile, theme.isLight ? -0.05 : -0.01);
  const bot1 = shiftColor(theme.tile, theme.isLight ? -0.06 : -0.04);
  const bot2 = shiftColor(theme.tile, theme.isLight ? -0.12 : -0.10);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top1);
  g.addColorStop(0.5, top2);
  g.addColorStop(0.5, bot1);
  g.addColorStop(1, bot2);
  roundRect(x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();

  // Rim — darker on light themes for the slot effect, near-black on dark.
  ctx.strokeStyle = theme.isLight
    ? 'rgba(0,0,0,0.18)'
    : 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.stroke();

  const midY = y + h / 2;

  if (cell.flipT >= 1) {
    ctx.save();
    roundRect(x, y, w, h, r); ctx.clip();
    drawCellGlyph(x, y, w, h, REEL[cell.pos], theme);
    ctx.restore();
  } else {
    const nextChar = REEL[cell.pos];
    const prevChar = REEL[cell.prevPos];
    // bottom half already shows the incoming glyph
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, midY, w, h / 2);
    roundRect(x, y, w, h, r); ctx.clip();
    drawCellGlyph(x, y, w, h, nextChar, theme);
    ctx.restore();
    // top half: the falling leaf of the OUTGOING glyph, foreshortened
    const scaleY = Math.max(0.0, 1 - cell.flipT);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 2, y, w + 4, h / 2);
    ctx.clip();
    ctx.translate(0, midY);
    ctx.scale(1, scaleY);
    ctx.translate(0, -midY);
    drawCellGlyph(x, y, w, h, prevChar, theme);
    ctx.fillStyle = `rgba(0,0,0,${0.35 * cell.flipT})`;
    ctx.fillRect(x, y, w, h / 2);
    ctx.restore();
  }

  // Seam — uses theme.accent so it blends into light themes properly.
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = Math.max(1, h * (theme.isLight ? 0.008 : 0.012));
  ctx.beginPath();
  ctx.moveTo(x, midY);
  ctx.lineTo(x + w, midY);
  ctx.stroke();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function render() {
  // Use CSS-pixel dimensions: during normal render the ctx is scaled by
  // DPR so we draw in CSS pixels; during export the ctx scale is 1 and
  // canvas.width/height are 1920x1080.
  const W = state.exporting ? els.canvas.width : els.canvas.clientWidth;
  const H = state.exporting ? els.canvas.height : els.canvas.clientHeight;
  const theme = currentTheme();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  // Crisper chip rectangles — bilinear smoothing only blurs solid fills.
  ctx.imageSmoothingEnabled = false;
  const L = layout(W, H);
  let i = 0;
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const x = L.offX + c * (L.cw + L.gx);
      const y = L.offY + L.gx + r * (L.ch + L.gx);
      drawCell(x, y, L.cw, L.ch, state.cells[i++], theme);
    }
  }
}

function fitCanvas() {
  if (state.exporting) return;          // export locks size to 1080p
  const stage = document.getElementById('stage');
  const maxW = stage.clientWidth - 64;
  const maxH = stage.clientHeight - 64;
  const cols = state.cols, rows = state.rows;
  const ratio = (cols + (cols + 1) * GAP) /
                (rows * ASPECT + (rows + 1) * GAP);
  let w = maxW, h = w / ratio;
  if (h > maxH) { h = maxH; w = h * ratio; }
  // CSS pixels (what we draw in) vs. backing-store pixels (what the GPU
  // actually paints). On a 2x display, scaling the backing store by DPR
  // means text and chip rectangles render at native physical resolution
  // instead of getting bilinearly upsampled.
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.round(w);
  const cssH = Math.round(h);
  els.canvas.style.width  = cssW + 'px';
  els.canvas.style.height = cssH + 'px';
  els.canvas.width  = Math.round(cssW * dpr);
  els.canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // drawing remains in CSS pixels
  render();
}

/* ------------------------------------------------------------------ *
 * Flip engine
 * ------------------------------------------------------------------ */
function startFlip() {
  rebuildCells();
  // scramble start: each cell begins a few positions "behind" its target
  for (const cell of state.cells) {
    const tgt = posOf(cell.target);
    const base = state.flipBase + Math.floor(Math.random() * 7); // jitter 0..6
    cell.remaining = base;
    cell.delay = Math.floor(Math.random() * 6);  // staggered start (frames)
    cell.pos = ((tgt - base) % REEL.length + REEL.length) % REEL.length;
    cell.prevPos = cell.pos;
    cell.flipT = 1;
    cell.frameAcc = 0;
  }
  state.running = true;
  if (!loopRunning) tick(performance.now());
}

let lastT = 0;
let loopRunning = false;

function step(dt) {
  const perFlip = state.speed;
  let anyActive = false;
  let advancedThisFrame = 0;       // cap clacks/frame so it clatters, not mush
  for (const cell of state.cells) {
    if (cell.delay > 0) { cell.delay -= dt / perFlip; anyActive = true; continue; }
    if (cell.remaining <= 0 && cell.flipT >= 1) continue;
    anyActive = true;
    cell.flipT += dt / perFlip;
    if (cell.flipT >= 1) {
      if (cell.remaining > 0) {
        cell.prevPos = cell.pos;
        cell.pos = (cell.pos + 1) % REEL.length;
        cell.remaining--;
        cell.flipT = cell.remaining > 0 ? 0 : 1;
        if (cell.remaining === 0) cell.flipT = 1;
        if (advancedThisFrame < 4) { clack(); advancedThisFrame++; }
      } else {
        cell.flipT = 1;
      }
    }
  }
  return anyActive;
}

function tick(now) {
  const dt = Math.min(64, now - (lastT || now));
  lastT = now;
  const active = step(dt);
  render();
  if (active) {
    requestAnimationFrame(tick);
  } else {
    state.running = false;
    if (state.looping && !state.exporting) {
      setTimeout(() => { if (state.looping) startFlip(); }, 1400);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Export — deterministic single run, 1920x1080 @ 30fps
 * ------------------------------------------------------------------ */
async function exportVideo() {
  if (state.exporting) return;
  await document.fonts.ready;

  const wasLooping = state.looping;
  state.looping = false;
  state.exporting = true;
  els.record.disabled = true;
  els.flip.disabled = true;
  setStatus('Recording…');

  const prevW = els.canvas.width, prevH = els.canvas.height;
  els.canvas.width = 1920;
  els.canvas.height = 1080;
  ctx.setTransform(1, 0, 0, 1, 0, 0);   // raw 1080p, no DPR upscale

  rebuildCells();
  for (const cell of state.cells) {
    const tgt = posOf(cell.target);
    const base = state.flipBase + Math.floor(Math.random() * 7);
    cell.remaining = base;
    cell.delay = Math.floor(Math.random() * 6);
    cell.pos = ((tgt - base) % REEL.length + REEL.length) % REEL.length;
    cell.prevPos = cell.pos;
    cell.flipT = 1;
  }
  render();

  const fmt = FORMATS[els.format.value] || FORMATS.webm;
  const stream = els.canvas.captureStream(30);

  // mix synthesized clacks into an audio track so the file carries sound
  let recDestNode = null;
  if (state.sound) {
    const ac = ensureAudio();
    recDestNode = ac.createMediaStreamDestination();
    recDest = recDestNode;                       // clack() also feeds this
    recDestNode.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
  }

  const rec = new MediaRecorder(stream, {
    mimeType: fmt.mime,
    videoBitsPerSecond: 8_000_000,
  });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  const done = new Promise(res => { rec.onstop = res; });
  rec.start();

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 1. pre-roll 250ms (scrambled hold)
  let t0 = performance.now();
  while (performance.now() - t0 < 250) { render(); await frame(); }

  // 2. animation
  lastT = performance.now();
  await new Promise(resolve => {
    function run(now) {
      const dt = Math.min(64, now - lastT);
      lastT = now;
      const active = step(dt);
      render();
      active ? requestAnimationFrame(run) : resolve();
    }
    requestAnimationFrame(run);
  });

  // 3. final hold 1500ms
  t0 = performance.now();
  while (performance.now() - t0 < 1500) { render(); await frame(); }

  rec.stop();
  await done;
  recDest = null;

  const blob = new Blob(chunks, { type: fmt.mime.split(';')[0] });
  const fname = 'vestaboard.' + fmt.ext;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  els.canvas.width = prevW;
  els.canvas.height = prevH;
  state.exporting = false;
  state.looping = wasLooping;
  els.record.disabled = false;
  els.flip.disabled = false;
  setStatus('Saved ' + fname, true);
  fitCanvas();
  if (state.looping) startFlip();
}

const frame = () => new Promise(r => requestAnimationFrame(r));

/* ------------------------------------------------------------------ *
 * UI wiring
 * ------------------------------------------------------------------ */
function setStatus(msg, ok) {
  els.status.textContent = msg || '';
  els.status.className = 'status' + (ok ? ' ok' : '');
}

function applyLoopUI() {
  state.looping = els.loop.checked;
  els.flips.parentElement.classList.toggle('disabled', state.looping);
  els.flips.disabled = state.looping;
  els.flip.disabled = state.looping;
  if (state.looping) { startFlip(); }
  else { setStatus(''); }
}

let textDebounce = null;
let justPasted = false;
els.message.addEventListener('paste', () => {
  // Pasting overrides any manual grid sizing — fit to the new text.
  state.gridManual = false;
  justPasted = true;
});
els.message.addEventListener('input', () => {
  if (justPasted) {                  // paste already cleared gridManual
    justPasted = false;
  }
  syncDefaultGrid();
  fitCanvas();                       // immediate: grid resizes as you type
  saveSettings();
  clearTimeout(textDebounce);
  textDebounce = setTimeout(() => {  // settle, then flip to the new text
    if (state.looping) return;       // loop already cycles continuously
    startFlip();
  }, 400);
});
els.rows.addEventListener('input', () => {
  state.gridManual = true;
  state.rows = Math.max(1, +els.rows.value || 1);
  rebuildCells();
  fitCanvas();
  saveSettings();
});
els.cols.addEventListener('input', () => {
  state.gridManual = true;
  state.cols = Math.max(1, +els.cols.value || 1);
  rebuildCells();
  fitCanvas();
  saveSettings();
});
els.resetGrid.addEventListener('click', () => {
  state.gridManual = false;
  syncDefaultGrid();
  state.rows = +els.rows.value;
  state.cols = +els.cols.value;
  rebuildCells();
  fitCanvas();
  saveSettings();
});
els.flips.addEventListener('input', () => {
  state.flipBase = Math.max(1, +els.flips.value || 1);
  saveSettings();
});
els.speed.addEventListener('input', () => {
  state.speed = +els.speed.value;
  els.speedOut.textContent = els.speed.value;
  saveSettings();
});
els.loop.addEventListener('change', () => { applyLoopUI(); saveSettings(); });
function applySoundUI() {
  els.soundStyle.parentElement.style.display = state.sound ? '' : 'none';
}
els.sound.addEventListener('change', () => {
  state.sound = els.sound.checked;
  if (state.sound) ensureAudio();   // unlock AudioContext on user gesture
  applySoundUI();
  saveSettings();
});
els.soundStyle.addEventListener('change', () => {
  state.soundStyle = els.soundStyle.value;
  saveSettings();
});
els.font.addEventListener('change', async () => {
  state.font = els.font.value;
  await document.fonts.ready;
  render();
  saveSettings();
});
els.format.addEventListener('change', saveSettings);
els.flip.addEventListener('click', () => { if (!state.looping) startFlip(); });
els.record.addEventListener('click', exportVideo);
window.addEventListener('resize', fitCanvas);

/* ------------------------------------------------------------------ *
 * Themes — dropdown, editor, import, save/delete.
 * Dropdown order:  Black, White, ...saved customs..., Custom (always last)
 * ------------------------------------------------------------------ */
function populateThemeDropdown() {
  els.theme.innerHTML = '';
  // 1. Built-ins in their declared order
  for (const [id, t] of Object.entries(BUILTIN_THEMES)) {
    const o = document.createElement('option');
    o.value = id; o.textContent = t.name;
    els.theme.appendChild(o);
  }
  // 2. Saved custom themes (insertion order)
  for (const [id, t] of Object.entries(state.customThemes)) {
    const o = document.createElement('option');
    o.value = id; o.textContent = t.name;
    els.theme.appendChild(o);
  }
  // 3. "Custom" is always the last item
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = 'Custom…';
  els.theme.appendChild(customOpt);

  // Restore selection (clamp to a valid option)
  const all = { ...BUILTIN_THEMES, ...state.customThemes, __custom__: true };
  if (!all[state.themeId]) state.themeId = 'black';
  els.theme.value = state.themeId;
  applyEditorUI();
}

function makeThemeId(name) {
  const base = (name || 'custom').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g,'') || 'custom';
  let id = base, n = 2;
  while (BUILTIN_THEMES[id] || state.customThemes[id]) { id = base + '-' + n++; }
  return id;
}

/* Open/close the editor depending on selection. Seed draftTheme from
 * either the saved custom theme or (for "Custom…") the currently-active
 * theme so you can branch off whatever you have selected. */
function applyEditorUI() {
  const id = state.themeId;
  if (id === '__custom__') {
    // Seed from the previously rendered theme (or Black if none).
    const seed = (state.draftTheme && state.draftTheme._seededForCustom)
      ? state.draftTheme
      : { ...currentTheme(), _seededForCustom: true, builtin: false };
    state.draftTheme = {
      name: '',
      builtin: false,
      isLight: seed.isLight,
      bg: seed.bg, tile: seed.tile, text: seed.text, accent: seed.accent,
      _seededForCustom: true,
    };
    syncEditorFromDraft();
    els.themeEditor.hidden = false;
    els.themeDelete.hidden = true;
    els.themeName.value = '';
    els.themeName.placeholder = 'Name (auto-generated on save)';
    els.themeSave.textContent = 'Save as new';
  } else if (state.customThemes[id]) {
    // Editing an existing saved custom theme — Save updates in place.
    state.draftTheme = { ...state.customThemes[id] };
    syncEditorFromDraft();
    els.themeEditor.hidden = false;
    els.themeDelete.hidden = false;
    els.themeName.value = state.draftTheme.name;
    els.themeName.placeholder = 'Theme name';
    els.themeSave.textContent = 'Save';
  } else {
    // Built-in (or unknown) — no editor.
    state.draftTheme = null;
    els.themeEditor.hidden = true;
  }
}

/* Mirror draftTheme colors into the hex-row inputs and wells. */
function syncEditorFromDraft() {
  if (!state.draftTheme) return;
  for (const field of ['bg', 'tile', 'text', 'accent']) {
    const value = (state.draftTheme[field] || '#000000').toLowerCase();
    const input = els.themeEditor.querySelector(`.hex-text[data-field="${field}"]`);
    const well  = els.themeEditor.querySelector(`.hex-well[data-pickfor="${field}"]`);
    if (input) { input.value = value.toUpperCase(); input.classList.remove('invalid'); }
    if (well)  { well.style.background = value; }
  }
}

/* Validate + apply a hex string to one field of the draft. Returns true
 * if applied. Accepts 3/6 digit hex with or without leading '#'. */
function applyHexEdit(field, raw) {
  let v = (raw || '').trim().replace(/^#/, '');
  if (v.length === 3) v = v.split('').map(c => c+c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return false;
  const hex = '#' + v.toLowerCase();
  state.draftTheme[field] = hex;
  // Recompute isLight from bg so the white-bezel rendering toggles.
  state.draftTheme.isLight = relativeLuminance(state.draftTheme.bg) > 0.55;
  // Update the matching well immediately.
  const well = els.themeEditor.querySelector(`.hex-well[data-pickfor="${field}"]`);
  if (well) well.style.background = hex;
  render();
  return true;
}

els.theme.addEventListener('change', () => {
  state.themeId = els.theme.value;
  applyEditorUI();
  render();
  saveSettings();
});

/* --- Hex-row interactions --- */
// Native color picker: anchor it under the well/pencil that was clicked,
// then click() it to open the system color picker in roughly the right spot.
let pickerField = null;
function openPickerFor(field, anchorEl) {
  if (!state.draftTheme) return;
  pickerField = field;
  els.nativeColor.value = state.draftTheme[field] || '#000000';
  // Anchor: position the (invisible) input under the anchor's bottom-left.
  const r = anchorEl.getBoundingClientRect();
  els.nativeColor.style.left = (r.left + window.scrollX) + 'px';
  els.nativeColor.style.top  = (r.bottom + window.scrollY) + 'px';
  els.nativeColor.click();
}
els.themeEditor.addEventListener('click', (e) => {
  const t = e.target.closest('[data-pickfor]');
  if (!t) return;
  openPickerFor(t.dataset.pickfor, t);
});
els.nativeColor.addEventListener('input', () => {
  if (!pickerField || !state.draftTheme) return;
  applyHexEdit(pickerField, els.nativeColor.value);
  const input = els.themeEditor.querySelector(`.hex-text[data-field="${pickerField}"]`);
  if (input) input.value = els.nativeColor.value.toUpperCase();
});

// Text-field editing: validate on input; revert on blur if invalid.
els.themeEditor.addEventListener('input', (e) => {
  const input = e.target.closest('.hex-text');
  if (!input || !state.draftTheme) return;
  const ok = applyHexEdit(input.dataset.field, input.value);
  input.classList.toggle('invalid', !ok);
});
els.themeEditor.addEventListener('blur', (e) => {
  const input = e.target.closest && e.target.closest('.hex-text');
  if (!input || !state.draftTheme) return;
  // If currently invalid, snap back to the last valid value from draft.
  if (input.classList.contains('invalid')) {
    input.value = (state.draftTheme[input.dataset.field] || '#000000').toUpperCase();
    input.classList.remove('invalid');
  } else {
    // Normalize formatting (uppercase, leading #) on commit.
    input.value = (state.draftTheme[input.dataset.field] || '#000000').toUpperCase();
  }
}, true);

els.themeName.addEventListener('input', () => {
  if (state.draftTheme) state.draftTheme.name = els.themeName.value;
});

/* --- Save: creates a new theme (when on "Custom") or updates the
 * selected saved theme in place. --- */
els.themeSave.addEventListener('click', () => {
  if (!state.draftTheme) return;
  const d = state.draftTheme;
  if (state.themeId === '__custom__') {
    // Auto-name if the user didn't provide one.
    const name = (els.themeName.value || '').trim() || nearestNamedColor(d.bg);
    const id = makeThemeId(name);
    state.customThemes[id] = {
      name, builtin: false, isLight: d.isLight,
      bg: d.bg, tile: d.tile, text: d.text, accent: d.accent,
    };
    state.themeId = id;
    state.draftTheme = null;       // exit edit mode for built-in-ish UX
    populateThemeDropdown();
    render();
    saveSettings();
  } else if (state.customThemes[state.themeId]) {
    // Update in place.
    const t = state.customThemes[state.themeId];
    t.name = (els.themeName.value || '').trim() || t.name;
    t.isLight = d.isLight;
    t.bg = d.bg; t.tile = d.tile; t.text = d.text; t.accent = d.accent;
    state.draftTheme = { ...t };
    populateThemeDropdown();
    render();
    saveSettings();
  }
});

els.themeDelete.addEventListener('click', () => {
  if (!state.customThemes[state.themeId]) return;
  delete state.customThemes[state.themeId];
  state.themeId = 'black';
  state.draftTheme = null;
  populateThemeDropdown();
  render();
  saveSettings();
});

/* --- Import button + dialog (unchanged behavior; creates a saved custom) --- */
els.importTheme.addEventListener('click', () => {
  els.importText.value = '';
  els.importError.textContent = '';
  if (typeof els.importDialog.showModal === 'function') {
    els.importDialog.showModal();
    setTimeout(() => els.importText.focus(), 50);
  }
});
els.importDialog.addEventListener('close', () => {
  if (els.importDialog.returnValue !== 'ok') return;
  const hexes = parseHexList(els.importText.value);
  if (hexes.length < 2) {
    els.importError.textContent = 'Need at least 2 valid hex colors.';
    if (typeof els.importDialog.showModal === 'function') els.importDialog.showModal();
    return;
  }
  const theme = themeFromHexes(hexes);
  const id = makeThemeId(theme.name);
  state.customThemes[id] = theme;
  state.themeId = id;
  state.draftTheme = null;
  populateThemeDropdown();
  render();
  saveSettings();
});

/* ------------------------------------------------------------------ *
 * Colored bits toggle
 * ------------------------------------------------------------------ */
els.bits.addEventListener('change', () => {
  state.showBits = els.bits.checked;
  applyShowBits();
  render();
  saveSettings();
});

/* ------------------------------------------------------------------ *
 * Sidebar collapse / restore (with cursor-proximity dimming)
 * ------------------------------------------------------------------ */
function applySidebarState() {
  document.body.dataset.sidebar = state.sidebarCollapsed ? 'collapsed' : 'open';
  // Re-fit canvas after the transition so the board uses reclaimed width.
  setTimeout(fitCanvas, 300);
}
els.sidebarToggle.addEventListener('click', () => {
  state.sidebarCollapsed = true;
  applySidebarState();
  saveSettings();
});
els.sidebarRestore.addEventListener('click', () => {
  state.sidebarCollapsed = false;
  applySidebarState();
  saveSettings();
});
// Cursor proximity: brighten the floating button when cursor is near the
// right edge (~30px). Only matters when collapsed.
window.addEventListener('mousemove', (e) => {
  if (!state.sidebarCollapsed) return;
  const distFromRight = window.innerWidth - e.clientX;
  els.sidebarRestore.classList.toggle('is-near', distFromRight <= 60);
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
(async function init() {
  // 1. Restore saved settings into the DOM controls before reading them.
  const saved = loadSettings();
  if (saved) {
    if (typeof saved.text === 'string')  els.message.value = saved.text;
    if (saved.rows)                       els.rows.value    = saved.rows;
    if (saved.cols)                       els.cols.value    = saved.cols;
    if (saved.flipBase)                   els.flips.value   = saved.flipBase;
    if (saved.speed)                      els.speed.value   = saved.speed;
    if (typeof saved.looping === 'boolean') els.loop.checked = saved.looping;
    if (typeof saved.sound   === 'boolean') els.sound.checked = saved.sound;
    if (saved.soundStyle)                 els.soundStyle.value = saved.soundStyle;
    if (typeof saved.showBits === 'boolean') els.bits.checked = saved.showBits;
    if (saved.customThemes && typeof saved.customThemes === 'object')
      state.customThemes = saved.customThemes;
    if (saved.themeId)                    state.themeId = saved.themeId;
    if (saved.font) {
      const opt = [...els.font.options].find(o => o.value === saved.font);
      if (opt) els.font.value = saved.font;
    }
    els.speedOut.textContent = els.speed.value;
    state.gridManual = !!saved.gridManual;
    state.sidebarCollapsed = !!saved.sidebarCollapsed;
  }

  // 2. Mirror DOM values into state.
  state.rows = +els.rows.value;
  state.cols = +els.cols.value;
  state.font = els.font.value;
  state.flipBase = +els.flips.value;
  state.speed = +els.speed.value;
  state.sound = els.sound.checked;
  state.soundStyle = els.soundStyle.value;
  state.looping = els.loop.checked;
  state.showBits = els.bits.checked;
  applyShowBits();
  applySoundUI();
  applySidebarState();

  // 3. Themes: build dropdown (built-ins + restored custom), restore selection.
  populateThemeDropdown();

  // 4. Populate the format dropdown (browser-dependent), then restore.
  populateFormats();
  if (saved && saved.format) {
    const opt = [...els.format.options].find(o => o.value === saved.format);
    if (opt) els.format.value = saved.format;
  }

  // 5. Grid sizing: respect manual override; otherwise derive from text.
  if (!state.gridManual) {
    syncDefaultGrid();
    state.rows = +els.rows.value;
    state.cols = +els.cols.value;
  }
  rebuildCells();
  fitCanvas();

  setStatus('Loading fonts…');
  try { await document.fonts.ready; } catch (_) {}
  state.fontsReady = true;
  els.record.disabled = false;
  setStatus('');
  render();

  // Auto-loop resume.
  if (state.looping) {
    els.flips.parentElement.classList.add('disabled');
    els.flips.disabled = true;
    els.flip.disabled = true;
    startFlip();
  }
})();
