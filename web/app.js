// app.js — the Galileo / Z-Games shell. Everything the player touches
// lives here; everything the game does lives behind core/adapter.js;
// everything the Meta Model API will do lives behind services/ (voice,
// speech, spark, image) so the polish layer can arrive without the shell
// changing shape.
import { GameAdapter } from '../core/adapter.js';
import { snapshotToQuetzal, quetzalToSnapshot } from '../core/quetzal.js';
import { DeviceVoice } from '../services/voice.js';
import { DeviceSpeech, ApiSpeech } from '../services/speech.js';
import { LocalStubNormalizer, ApiSparkNormalizer } from '../services/spark.js';
import { QueueingArt, ApiArt } from '../services/image.js';
import { sonarPattern, sonarSummary } from '../services/sonar.js';
import { projectMap } from './map3d.js';
import { DemoDriver } from './demo.js';
import { DEMO_STEPS } from './demo-script.js';

const $ = (id) => document.getElementById(id);
const transcriptEl = $('transcript');
const inputEl = $('cmdInput');
const heardEl = $('heardAs');

const voice = new DeviceVoice();
const speech = new DeviceSpeech();
const apiSpeech = new ApiSpeech('');
const normalizer = new LocalStubNormalizer();
const apiNormalizer = new ApiSparkNormalizer('');
let apiConfigured = false;
fetch('/api/health').then((r) => r.json()).then((h) => { apiConfigured = !!h.apiConfigured; }).catch(() => {});
// Discovery art: the API implementation when the proxy reports the API
// configured (per-game instance, rebuilt at boot); the honest queueing
// placeholder otherwise.
let art = new QueueingArt();
let narrationOn = true;

// ---- save slot (per game, in the browser) --------------------------------
// Day 2: the slot holds a real Quetzal (IFZS) save file — the standard
// Z-machine format — so a save made here can travel to any Quetzal
// interpreter, and the Download button hands the player the actual
// file. (Day-1 slots held a private JSON snapshot; those still restore
// through the legacy path below.)
function bytesToB64(bytes) {
  let bin = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function legacySnapFromStore(copy) {
  return { pc: copy.pc, stack: copy.stack, frames: copy.frames, mem: b64ToBytes(copy.mem) };
}
let lastSaveBytes = null; // most recent Quetzal file, for Download
const adapter = new GameAdapter({
  onSave: (gameId, snap) => {
    try {
      const file = snapshotToQuetzal(snap, adapter.vm.original);
      lastSaveBytes = file;
      localStorage.setItem(`zgames.save.${gameId}`, JSON.stringify({ quetzal: bytesToB64(file) }));
      return true;
    } catch { return false; }
  },
  onRestore: (gameId) => {
    try {
      const raw = localStorage.getItem(`zgames.save.${gameId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.quetzal) {
        lastSaveBytes = b64ToBytes(parsed.quetzal);
        return quetzalToSnapshot(lastSaveBytes, adapter.vm.original);
      }
      return legacySnapFromStore(parsed); // Day-1 slot
    } catch { return null; }
  },
});

let currentBytes = null;
let lastInventoryText = '';

function sentencesOf(text) {
  return text.split(/(?<=[.!?…])\s+/).filter((s) => s.trim().length);
}

let narrationBusy = 0; // in-flight narrations; the demo driver paces by it
async function narrate(turnEl, text) {
  if (!narrationOn || !voice.available) return;
  const segs = sentencesOf(text).map((t) => ({ text: t }));
  const spans = turnEl ? [...turnEl.querySelectorAll('.seg')] : [];
  narrationBusy++;
  try {
    await voice.speak(segs, {
      onSegment: (i) => {
        spans.forEach((s, j) => s.classList.toggle('speaking', j === i));
      },
    });
  } finally { narrationBusy--; }
}

function renderTurn(command, turn) {
  const div = document.createElement('div');
  div.className = 'turn';
  if (command) {
    const c = document.createElement('div');
    c.className = 'cmd';
    c.textContent = `> ${command}`;
    div.appendChild(c);
  }
  const body = document.createElement('div');
  for (const segText of sentencesOf(turn.text.trim())) {
    const s = document.createElement('span');
    s.className = 'seg';
    s.textContent = segText + ' ';
    body.appendChild(s);
  }
  if (!body.childNodes.length) body.textContent = turn.text;
  div.appendChild(body);
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  updateChrome(turn);
  narrate(div, turn.text);
}

function updateChrome(turn) {
  $('statusRoom').textContent = turn.room || '—';
  const nums = [];
  if (turn.score !== null && turn.score !== undefined) nums.push(`Score ${turn.score}`);
  if (turn.moves !== null && turn.moves !== undefined) nums.push(`Moves ${turn.moves}`);
  $('statusNums').textContent = nums.join(' · ');
  // HERE chips: the room, in the game's own words.
  $('hereRow').innerHTML = '';
  if (turn.room) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = turn.room;
    $('hereRow').appendChild(chip);
  }
  // Object-tree channel (Day 2): the room's contents by the game's own
  // object names, when the core could identify the room in the tree.
  // Absent (null) means the game keeps its names elsewhere — the shell
  // shows nothing rather than guessing from prose.
  if (Array.isArray(turn.objects)) {
    for (const name of turn.objects) {
      const chip = document.createElement('span');
      chip.className = 'chip obj-chip';
      chip.textContent = name;
      $('hereRow').appendChild(chip);
    }
  }
  updateCompass(turn);
  drawMap(turn.map);
  lastMap = turn.map;
  drawMap3D(turn.map);
  const a = art.forRoom(turn.room, turn.text);
  const img = $('artImg');
  if (a.status === 'ready' && a.url) {
    img.src = a.url;
    img.alt = `Discovery art for ${turn.room} — decoration, illustrating the room's own description`;
    img.hidden = false;
    $('artStatus').textContent = `Discovery art for “${turn.room}” — decoration only; everything it shows, the words above already said.`;
  } else {
    img.hidden = true;
    $('artStatus').textContent = a.status === 'queued'
      ? `Discovery art for “${turn.room}” is being made — it is cached forever once made.`
      : '';
    if (a.status === 'queued') pollArt(turn.room, turn.text);
  }
}

// Art generation is async; poll the (cheap, local) cache entry until it
// lands, then paint it if the player is still in that room.
let artPollTimer = null;
function pollArt(room, text) {
  if (artPollTimer) return;
  artPollTimer = setInterval(() => {
    const a = art.forRoom(room, text);
    if (a.status === 'ready' || a.status === 'unavailable') {
      clearInterval(artPollTimer); artPollTimer = null;
      if (a.status === 'ready' && adapter.currentRoom === room) {
        const img = $('artImg');
        img.src = a.url;
        img.alt = `Discovery art for ${room} — decoration, illustrating the room's own description`;
        img.hidden = false;
        $('artStatus').textContent = `Discovery art for “${room}” — decoration only; everything it shows, the words above already said.`;
      } else if (a.status === 'unavailable') {
        $('artStatus').textContent = '';
      }
    }
  }, 2500);
  setTimeout(() => { if (artPollTimer) { clearInterval(artPollTimer); artPollTimer = null; } }, 90000);
}

function updateCompass(turn) {
  const known = new Map();
  const named = new Map();
  const roomRec = turn.map.rooms.find((r) => r.name === turn.map.current);
  if (roomRec) {
    for (const [dir, dest] of Object.entries(roomRec.exits)) known.set(dir, dest);
    for (const [dir, name] of Object.entries(roomRec.exitNames || {})) named.set(dir, name);
  }
  document.querySelectorAll('#compass button, .compass-row2 button').forEach((btn) => {
    const dir = btn.dataset.dir;
    if (!dir || dir === 'look') return;
    const label = btn.dataset.label || btn.textContent;
    btn.dataset.label = label;
    btn.classList.toggle('known', known.has(dir));
    // A prose-named exit (Day 3) is labeled with the game's own name for
    // it and styled dashed: shown, named, but not yet walked.
    btn.classList.toggle('named', !known.has(dir) && named.has(dir));
    if (known.has(dir)) btn.innerHTML = `${label}<span class="dest">${known.get(dir)}</span>`;
    else if (named.has(dir)) btn.innerHTML = `${label}<span class="dest">${named.get(dir)}</span>`;
    else btn.innerHTML = label;
  });
}

function drawMap(map) {
  const cv = $('fogMap');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const placed = map.rooms.filter((r) => r.placed);
  if (!placed.length) return;
  const xs = placed.map((r) => r.x), ys = placed.map((r) => r.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cell = 54, pad = 30;
  const px = (r) => pad + (r.x - minX) * cell + (r.z || 0) * 10;
  const py = (r) => pad + (r.y - minY) * cell - (r.z || 0) * 10;
  ctx.strokeStyle = '#4a4a58'; ctx.lineWidth = 2;
  for (const r of placed) {
    for (const destName of Object.values(r.exits)) {
      const d = placed.find((q) => q.name === destName);
      if (d) { ctx.beginPath(); ctx.moveTo(px(r), py(r)); ctx.lineTo(px(d), py(d)); ctx.stroke(); }
    }
  }
  for (const r of placed) {
    const isHere = r.name === map.current;
    ctx.fillStyle = isHere ? '#ffd257' : '#2a2a38';
    ctx.strokeStyle = isHere ? '#ffd257' : '#6a6a7a';
    ctx.beginPath(); ctx.arc(px(r), py(r), 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = isHere ? '#ffd257' : '#b9b4a6';
    ctx.font = '11px Georgia';
    ctx.textAlign = 'center';
    ctx.fillText(r.name, px(r), py(r) + 26);
  }
}

// The living map (Day 3): isometric room boxes from web/map3d.js's
// projection of the same fog-of-war snapshot the flat map uses. The
// current room breathes (a slow pulse on its outline) so a watching
// judge can find the player at a glance; the geometry itself never
// moves. Projection is verified headlessly in test/map3d.mjs.
let lastMap = null;
let mapPulse = false;
setInterval(() => { mapPulse = !mapPulse; if (lastMap) drawMap3D(lastMap); }, 850);

function drawMap3D(map) {
  const cv = $('map3d');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const { boxes, edges, stubs } = projectMap(map, cv.width, cv.height);
  const poly = (pts, fill, stroke, width = 1) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  };
  ctx.strokeStyle = '#4a4a58'; ctx.lineWidth = 2;
  for (const e of edges) { ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke(); }
  ctx.strokeStyle = '#7fd4ff'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
  for (const s of stubs) { ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.fillStyle = '#7fd4ff'; ctx.font = 'italic 15px Georgia'; ctx.textAlign = 'center';
  for (const s of stubs) ctx.fillText(s.label, s.labelAt.x, s.labelAt.y - 6);
  for (const b of boxes) {
    poly(b.left, '#22222e', '#55555f');
    poly(b.right, '#1a1a24', '#55555f');
    poly(b.top, b.current ? '#ffd257' : '#2e2e40', b.current ? '#ffd257' : '#6a6a7a', b.current ? (mapPulse ? 3.5 : 2) : 1);
    ctx.fillStyle = b.current ? '#ffd257' : '#b9b4a6';
    ctx.font = b.current ? 'bold 16px Georgia' : '14px Georgia';
    ctx.textAlign = 'center';
    ctx.fillText(b.name, b.labelAt.x, b.labelAt.y);
  }
}

function parseCarrying(text) {
  const lines = text.split('\n');
  const items = [];
  let inList = false;
  for (const line of lines) {
    if (/carrying:/i.test(line)) { inList = true; continue; }
    if (/carrying nothing/i.test(line)) return [];
    if (inList) {
      const m = line.match(/^\s{2,}(.+)$/);
      if (m) items.push(m[1].trim());
      else if (line.trim() === '') continue;
      else break;
    }
  }
  return items;
}

function refreshCarrying(text) {
  const items = parseCarrying(text);
  const row = $('carryRow');
  row.innerHTML = '';
  if (!items.length) {
    row.innerHTML = '<span class="chip ghost">Nothing listed — tap Inventory to refresh</span>';
    return;
  }
  for (const it of items) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = it;
    row.appendChild(chip);
  }
}

async function sendCommand(raw) {
  const sentence = String(raw || '').trim();
  if (!sentence) return;
  let command = sentence;
  let note = '';
  const aff = adapter.affordances();
  // Normalization order: the deterministic local stub FIRST — its
  // whole-phrase aliases are exact knowledge, including repairs for
  // known recognizer mishearings ("strength and" -> "strengthen"), and
  // an exact correction must never be overridden by a model's nearest
  // guess (the Day-3 eyes-closed run: Spark mapped the mishearing to
  // "status" and the strengthen never happened). Spark (through the
  // proxy, leashed to these affordances) takes everything the stub
  // honestly declines; the sentence verbatim if neither maps it.
  // Play never blocks.
  let norm = null;
  norm = await normalizer.normalize(sentence, aff);
  if (!norm && apiConfigured) norm = await apiNormalizer.normalize(sentence, aff);
  if (norm && norm.command.toLowerCase() !== sentence.toLowerCase()) {
    command = norm.command;
    note = `Sent as: ${command}${norm.via === 'spark' ? ' (Spark)' : ''}`;
  } else if (!norm) {
    // Verbatim path: strip trailing sentence punctuation. Speech
    // recognizers append it ("Strike!", "Guard:") and a Z-machine
    // dictionary does not treat "!" or ":" as separators, so the raw
    // transcript would reach the parser as a word it cannot know —
    // found by the Day-2 eyes-closed test, where exactly this ate a
    // GUARD in a boss fight. Trailing punctuation is never the
    // player's command intent.
    command = sentence.replace(/[.!?,;:]+$/, '');
  }
  heardEl.textContent = note;
  voice.stop();
  const turn = adapter.runTurn(command);
  if (/^(inventory|i)$/i.test(command)) { lastInventoryText = turn.text; refreshCarrying(turn.text); }
  renderTurn(command, turn);
  inputEl.value = '';
  inputEl.focus();
}

// ---- favorites (SAY-IT): the player's own sentences, per game ------------
function favKey() { return `zgames.favs.${adapter.gameId}`; }
function loadFavs() {
  try { return JSON.parse(localStorage.getItem(favKey()) || '[]'); } catch { return []; }
}
function renderFavs() {
  const wrap = $('favorites');
  wrap.innerHTML = '';
  for (const fav of loadFavs()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = fav;
    b.addEventListener('click', () => sendCommand(fav));
    wrap.appendChild(b);
  }
}

// ---- wiring ------------------------------------------------------------------
$('sendBtn').addEventListener('click', () => sendCommand(inputEl.value));
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCommand(inputEl.value); });
$('micBtn').addEventListener('click', async () => {
  // Voice in: Muse Voice Transcribe (via the proxy) when the API is
  // configured; the platform recognizer otherwise; typing always works.
  if (apiConfigured && apiSpeech.available) {
    heardEl.textContent = 'Listening… speak your command (up to 6 seconds).';
    const heard = await apiSpeech.listen();
    if (heard) { heardEl.textContent = `Heard: ${heard}`; sendCommand(heard); }
    else heardEl.textContent = 'Did not catch that — try again, or type it.';
    return;
  }
  if (!speech.available) { heardEl.textContent = 'Speech recognition is not available in this browser — typing and tapping always work.'; return; }
  heardEl.textContent = 'Listening…';
  const heard = await speech.listen();
  if (heard) { heardEl.textContent = `Heard: ${heard}`; sendCommand(heard); }
  else heardEl.textContent = 'Did not catch that — try again, or type it.';
});
$('addFavBtn').addEventListener('click', () => {
  const v = inputEl.value.trim();
  if (!v) return;
  const favs = loadFavs();
  if (!favs.includes(v)) favs.push(v);
  localStorage.setItem(favKey(), JSON.stringify(favs));
  renderFavs();
});
$('saveBtn').addEventListener('click', () => sendCommand('save'));
$('restoreBtn').addEventListener('click', () => sendCommand('restore'));
$('downloadSaveBtn').addEventListener('click', () => {
  try {
    const raw = localStorage.getItem(`zgames.save.${adapter.gameId}`);
    const parsed = raw ? JSON.parse(raw) : null;
    const file = parsed && parsed.quetzal ? b64ToBytes(parsed.quetzal) : lastSaveBytes;
    if (!file) { heardEl.textContent = 'No save yet in this game — press Save first.'; return; }
    const url = URL.createObjectURL(new Blob([file], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${adapter.gameId}.sav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    heardEl.textContent = 'Save file downloaded — it is a standard Quetzal (.sav) file, readable by other Z-machine interpreters.';
  } catch { heardEl.textContent = 'Could not prepare the save file.'; }
});
$('loadSaveFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  try {
    localStorage.setItem(`zgames.save.${adapter.gameId}`, JSON.stringify({ quetzal: bytesToB64(bytes) }));
    heardEl.textContent = `Save file loaded for ${adapter.gameId} — restoring…`;
    sendCommand('restore');
  } catch { heardEl.textContent = 'Could not load that save file.'; }
});
$('undoBtn').addEventListener('click', () => sendCommand('undo'));
$('lookBtn').addEventListener('click', () => sendCommand('look'));
$('invBtn').addEventListener('click', () => sendCommand('inventory'));
// Haptic sonar (Day 2): vibrate the pattern of exits the game has
// actually shown from this room, and say them — the shape of the room
// through the skin, the detail by voice. Reads only known exits.
$('sonarBtn').addEventListener('click', () => {
  const aff = adapter.affordances() || {};
  // Sonar speaks every exit the game has SHOWN from here: traversed
  // ones and ones its prose has named (Day 3), with the names spoken.
  const dirs = [...new Set([...(aff.directions || []), ...(aff.namedDirections || [])])];
  if (navigator.vibrate) navigator.vibrate(sonarPattern(dirs));
  const summary = sonarSummary(dirs, aff.exitNamesHere || null);
  heardEl.textContent = summary;
  if (narrationOn && voice.available) voice.speak([{ text: summary }]);
});
$('restartBtn').addEventListener('click', () => { if (currentBytes) boot(currentBytes, adapter.gameId); });
$('narrateToggle').addEventListener('click', (e) => {
  narrationOn = !narrationOn;
  e.target.textContent = `Narration: ${narrationOn ? 'on' : 'off'}`;
  e.target.setAttribute('aria-pressed', String(narrationOn));
  if (!narrationOn) voice.stop();
});
$('stopTalkBtn').addEventListener('click', () => voice.stop());
$('rateSlider').addEventListener('input', (e) => voice.setRate(Number(e.target.value)));
$('largeTypeToggle').addEventListener('click', (e) => {
  const on = document.body.classList.toggle('large-type');
  e.target.setAttribute('aria-pressed', String(on));
});
document.querySelectorAll('#compass button, .compass-row2 button').forEach((btn) => {
  btn.addEventListener('click', () => sendCommand(btn.dataset.dir));
});
$('filePicker').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  boot(bytes, f.name.replace(/\.(zblorb|blorb|z3|z5|z8)$/i, ''));
});

function boot(bytes, gameId) {
  currentBytes = bytes;
  transcriptEl.innerHTML = '';
  art = apiConfigured ? new ApiArt('', gameId) : new QueueingArt();
  const turn = adapter.load(bytes, gameId);
  renderFavs();
  renderTurn(null, turn);
}

// The two bundled games: Figaro (the licensed starter, GPL v3 — see
// CREDITS) and The Lantern Below (our own showcase game, written for
// this event). The demo flow can load either.
function loadBundled(path, gameId) {
  fetch(path)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
    .then((buf) => boot(new Uint8Array(buf), gameId))
    .catch((err) => {
      transcriptEl.textContent = `Could not load ${path} (${err.message}). Serve this folder with the proxy (node server/proxy.mjs) or open a game file above.`;
    });
}
$('gameFigaro').addEventListener('click', () => loadBundled('../games/figaro/Figaro.zblorb', 'figaro'));
$('gameLantern').addEventListener('click', () => loadBundled('../games/lantern-below/lantern-below.z5', 'lantern-below'));
loadBundled('../games/figaro/Figaro.zblorb', 'figaro');

// ---- The demo flow (Day 3) -------------------------------------------
// One button: fresh-boots The Lantern Below and plays the rehearsed
// arc (web/demo-script.js) through the shell's real command path,
// pacing itself by the narration. The flow is gated headlessly by
// test/demo-rehearsal.mjs; if the venue network dies, the recorded
// fallback (demo/recorded-demo.html) tells the same story offline.
let demoDriver = null;
async function whenNarrationIdle(capMs = 30000) {
  const t0 = Date.now();
  while (narrationBusy > 0 && Date.now() - t0 < capMs) {
    await new Promise((r) => setTimeout(r, 350));
  }
}
$('demoBtn').addEventListener('click', async () => {
  if (demoDriver) demoDriver.stop();
  $('demoBtn').hidden = true;
  $('demoStopBtn').hidden = false;
  const capEl = $('demoCaption');
  capEl.textContent = 'Loading The Lantern Below…';
  try {
    const res = await fetch('../games/lantern-below/lantern-below.z5');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    boot(new Uint8Array(await res.arrayBuffer()), 'lantern-below');
  } catch (err) {
    capEl.textContent = `Could not load the demo game (${err.message}).`;
    $('demoBtn').hidden = false; $('demoStopBtn').hidden = true;
    return;
  }
  demoDriver = new DemoDriver({
    issue: (cmd) => sendCommand(cmd),
    caption: (text, i, n) => { capEl.textContent = `${i + 1}/${n} — ${text}`; },
    whenIdle: whenNarrationIdle,
  });
  const result = await demoDriver.run(DEMO_STEPS);
  capEl.textContent = result.stopped
    ? 'Demo stopped.'
    : 'Demo complete — the game is yours. Type, tap, or speak a command.';
  $('demoBtn').hidden = false;
  $('demoStopBtn').hidden = true;
  demoDriver = null;
});
$('demoStopBtn').addEventListener('click', () => { if (demoDriver) demoDriver.stop(); });
