'use strict';

/* ------------------------------------------------------------------ *
 * REEL — visible animation contract.
 * Order locked to official Vestaboard character codes:
 *   blank, A-Z, 1-9, 0, then punctuation in code order.
 * Gap codes (43,45,51,57,58,61) are simply absent from the reel.
 * Index = reel position (NOT the Vestaboard numeric code).
 * ------------------------------------------------------------------ */
const REEL = [
  ' ',
  'A','B','C','D','E','F','G','H','I','J','K','L','M',
  'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  '1','2','3','4','5','6','7','8','9','0',
  '!','@','#','$','(',')','-','+','&','=',';',':',
  "'",'"','%',',','.','/','?'
];
const REEL_INDEX = (() => {
  const m = new Map();
  REEL.forEach((ch, i) => { if (!m.has(ch)) m.set(ch, i); });
  return m;
})();
const posOf = ch => REEL_INDEX.has(ch) ? REEL_INDEX.get(ch) : 0;

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
  bg:       document.getElementById('bg'),
  font:     document.getElementById('font'),
  flip:     document.getElementById('flip'),
  record:   document.getElementById('record'),
  status:   document.getElementById('status'),
};
const ctx = els.canvas.getContext('2d');

const state = {
  rows: 1,
  cols: 5,
  bg: '#0a0a0a',
  font: els.font.value,
  flipBase: 12,            // retained even while greyed out by auto-loop
  speed: 70,               // ms per flip
  gridManual: false,       // user overrode rows/cols
  cells: [],               // per-cell: {pos, target, remaining, delay, frameAcc}
  running: false,
  looping: false,
  exporting: false,
  fontsReady: false,
};

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

function drawCellGlyph(x, y, w, h, char) {
  ctx.fillStyle = '#f4f4f4';
  ctx.font = state.font.replace('1em', Math.round(h * 0.62) + 'px');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char === ' ' ? '' : char, x + w / 2, y + h / 2 + h * 0.02);
}

function drawCell(x, y, w, h, cell) {
  const r = Math.max(2, w * 0.05);

  // body gradient (top lighter, bottom darker)
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#222');
  g.addColorStop(0.5, '#161616');
  g.addColorStop(0.5, '#0d0d0d');
  g.addColorStop(1, '#040404');
  roundRect(x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();

  // drop shadow rim
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.stroke();

  const midY = y + h / 2;

  if (cell.flipT >= 1) {
    // settled (or between flips): show current glyph whole
    ctx.save();
    roundRect(x, y, w, h, r); ctx.clip();
    drawCellGlyph(x, y, w, h, REEL[cell.pos]);
    ctx.restore();
  } else {
    const nextChar = REEL[cell.pos];
    const prevChar = REEL[cell.prevPos];
    // bottom half already shows the incoming glyph
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, midY, w, h / 2);
    roundRect(x, y, w, h, r); ctx.clip();
    drawCellGlyph(x, y, w, h, nextChar);
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
    drawCellGlyph(x, y, w, h, prevChar);
    ctx.fillStyle = `rgba(0,0,0,${0.35 * cell.flipT})`;
    ctx.fillRect(x, y, w, h / 2);
    ctx.restore();
  }

  // seam
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(1, h * 0.012);
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
  const W = els.canvas.width, H = els.canvas.height;
  ctx.fillStyle = state.bg;
  ctx.fillRect(0, 0, W, H);
  const L = layout(W, H);
  let i = 0;
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const x = L.offX + c * (L.cw + L.gx);
      const y = L.offY + L.gx + r * (L.ch + L.gx);
      drawCell(x, y, L.cw, L.ch, state.cells[i++]);
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
  els.canvas.width = Math.round(w);
  els.canvas.height = Math.round(h);
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

  const stream = els.canvas.captureStream(30);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9' : 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
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

  const blob = new Blob(chunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vestaboard.webm';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  els.canvas.width = prevW;
  els.canvas.height = prevH;
  state.exporting = false;
  state.looping = wasLooping;
  els.record.disabled = false;
  els.flip.disabled = false;
  setStatus('Saved vestaboard.webm', true);
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

els.message.addEventListener('input', () => {
  syncDefaultGrid();
  fitCanvas();
});
els.rows.addEventListener('input', () => {
  state.gridManual = true;
  state.rows = Math.max(1, +els.rows.value || 1);
  rebuildCells();
  fitCanvas();
});
els.cols.addEventListener('input', () => {
  state.gridManual = true;
  state.cols = Math.max(1, +els.cols.value || 1);
  rebuildCells();
  fitCanvas();
});
els.resetGrid.addEventListener('click', () => {
  state.gridManual = false;
  syncDefaultGrid();
  state.rows = +els.rows.value;
  state.cols = +els.cols.value;
  rebuildCells();
  fitCanvas();
});
els.flips.addEventListener('input', () => {
  state.flipBase = Math.max(1, +els.flips.value || 1);
});
els.speed.addEventListener('input', () => {
  state.speed = +els.speed.value;
  els.speedOut.textContent = els.speed.value;
});
els.loop.addEventListener('change', applyLoopUI);
els.bg.addEventListener('input', () => { state.bg = els.bg.value; render(); });
els.font.addEventListener('change', async () => {
  state.font = els.font.value;
  await document.fonts.ready;
  render();
});
els.flip.addEventListener('click', () => { if (!state.looping) startFlip(); });
els.record.addEventListener('click', exportVideo);
window.addEventListener('resize', fitCanvas);

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
(async function init() {
  state.rows = +els.rows.value;
  state.cols = +els.cols.value;
  state.bg = els.bg.value;
  state.flipBase = +els.flips.value;
  state.speed = +els.speed.value;
  syncDefaultGrid();
  state.rows = +els.rows.value;
  state.cols = +els.cols.value;
  rebuildCells();
  fitCanvas();

  setStatus('Loading fonts…');
  try { await document.fonts.ready; } catch (_) {}
  state.fontsReady = true;
  els.record.disabled = false;
  setStatus('');
  render();
})();
