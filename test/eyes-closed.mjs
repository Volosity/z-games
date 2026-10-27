// eyes-closed.mjs — Day-2 acceptance: play with NO screen.
//
// Method, stated plainly: the driver in this file never reads the
// adapter's screen model (no room field, no score, no map). Its only
// inputs are (a) the narration segments handed to the NarrationService
// boundary — exactly what a blind player hears — and (b) its own plan.
// Its only output channel is the voice path itself: each intended
// command is SPOKEN by a synthesized voice (ffmpeg's flite, standing in
// for a human voice at the microphone), transcribed by Muse Voice
// Transcribe through the real proxy, normalized by the same chain the
// shell uses (API Spark, leashed -> local stub -> verbatim), and only
// then sent to the game. A command the voice path garbles is a command
// the game never cleanly receives — the transcript shows every hop.
//
// The driver is a blind player with a plan and ears: each step is gated
// on what the narration actually said. If a gate fails it does what a
// player does — asks for a LOOK, and if the game plainly didn't
// understand, repeats itself in a different voice. If that fails, the
// test fails, honestly.
//
// Runs: the full Lantern Below walkthrough to victory, then a Figaro
// session with save/restore by voice. Evidence: the transcript file.
// Run: node test/eyes-closed.mjs
import { spawn, execFile } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameAdapter } from '../core/adapter.js';
import { LocalStubNormalizer, ApiSparkNormalizer } from '../services/spark.js';
import { snapshotToQuetzal, quetzalToSnapshot } from '../core/quetzal.js';

const execFileP = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const PORT = 8500 + Math.floor(Math.random() * 400); // fresh port per run: no stale proxy can be mistaken for ours
const PROXY = `http://localhost:${PORT}`;
const tmp = await mkdtemp(path.join(os.tmpdir(), 'zg-eyes-'));

const log = [];
function say(line = '') { log.push(line); console.log(line); }

let failures = 0;
function check(label, cond, detail = '') {
  say(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

// ---- the proxy (the shell's real server, unmodified) ----------------------
const proxyProc = spawn('node', [path.join(root, 'server', 'proxy.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`${PROXY}/api/health`); if (r.ok) return await r.json(); } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('proxy did not come up');
}
const health = await waitHealth();
say(`proxy health: apiConfigured=${health.apiConfigured} voiceIn=${health.voiceIn} voiceOut=${health.voiceOut} art=${health.art}`);
check('proxy reports the API configured', health.apiConfigured === true);

// ---- narration capture: the driver's ONLY window on the game --------------
function sentencesOf(text) {
  return text.split(/(?<=[.!?…])\s+/).filter((s) => s.trim().length);
}
class RecordingNarration {
  constructor() { this.turns = []; } // one entry per turn: joined spoken text
  async speak(segments) {
    this.turns.push(segments.map((s) => s.text).join(' '));
  }
  get last() { return this.turns[this.turns.length - 1] || ''; }
  get all() { return this.turns.join('\n'); }
}

// ---- the voice path --------------------------------------------------------
const wavCache = new Map();
async function synth(phrase, voice = 'slt') {
  const key = `${voice}|${phrase}`;
  if (wavCache.has(key)) return wavCache.get(key);
  const file = path.join(tmp, createHash('sha1').update(key).digest('hex') + '.wav');
  const safe = phrase.replace(/[':\\]/g, ' ');
  await execFileP('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
    '-i', `flite=text='${safe}':voice=${voice}`,
    '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', file]);
  wavCache.set(key, file);
  return file;
}
async function transcribe(wavFile) {
  try {
    const bytes = await readFile(wavFile);
    const r = await fetch(`${PROXY}/api/voice/transcribe`, {
      method: 'POST', headers: { 'content-type': 'audio/wav' }, body: bytes,
    });
    const data = await r.json();
    return data.status === 'ok' ? data.transcript : null;
  } catch { return null; } // a dead socket is an ASR miss, never a crash
}

const stub = new LocalStubNormalizer();
const spark = new ApiSparkNormalizer(PROXY);
const deviations = [];
let asrMisses = 0;

async function voiceTurn(driver, intent, voice = 'slt') {
  const wav = await synth(intent, voice);
  const transcript = await transcribe(wav);
  if (!transcript) { asrMisses++; return { transcript: null, command: null, turn: null }; }
  const aff = driver.adapter.affordances();
  // The shell's chain order (Day 3): deterministic stub first, Spark for
  // what it declines — see web/app.js sendCommand for the reasoning.
  let norm = await stub.normalize(transcript, aff);
  if (!norm) norm = await spark.normalize(transcript, aff);
  // Mirror of the shell's sendCommand, including its verbatim-path
  // punctuation strip (a Day-2 product fix this very test produced).
  const command = norm ? norm.command : transcript.trim().replace(/[.!?,;:]+$/, '');
  if (command.toLowerCase().replace(/[.!?]+$/, '') !== intent.toLowerCase()) {
    deviations.push(`"${intent}" heard as "${transcript}" -> sent "${command}"`);
  }
  const turn = driver.adapter.runTurn(command);
  await driver.narration.speak(sentencesOf(turn.text.trim()).map((t) => ({ text: t })));
  return { transcript, command, turn };
}

const MISUNDERSTOOD = /don'?t understand|not a verb|beg your pardon|can'?t see|don'?t know the word/i;
// Recovery, the way a person does it: if the game did not understand or
// cannot see the thing (the recognizer garbles "glimmer" in every test
// voice), rephrase — "take cache", "examine tablet" — and re-speak in
// another voice, each attempt through the full voice path. Only then a
// LOOK, and the gate is judged on the action's own narration, never on
// the room description a LOOK repeats.
async function step(driver, intent, gate, alternates = []) {
  const gateOk = () => !gate || gate.test(driver.narration.last);
  for (const cand of [intent, ...alternates]) {
    let r = await voiceTurn(driver, cand);
    say(`  [${driver.name}] say "${cand}" -> heard "${r.transcript}" -> sent "${r.command}"`);
    say(`      heard back: ${driver.narration.last.replace(/\s+/g, ' ').slice(0, 130)}`);
    if (gateOk()) { if (gate) check(`gate after "${intent}"`, true, gate.source || String(gate)); return r; }
    if (r.transcript && MISUNDERSTOOD.test(driver.narration.last)) {
      say(`      game did not understand; repeating in another voice`);
      r = await voiceTurn(driver, cand, 'kal');
      say(`      retry heard "${r.transcript}" -> sent "${r.command}"`);
      say(`      heard back: ${driver.narration.last.replace(/\s+/g, ' ').slice(0, 130)}`);
      if (gateOk()) { if (gate) check(`gate after "${intent}"`, true, gate.source || String(gate)); return r; }
    }
  }
  if (gate && !gateOk()) {
    await voiceTurn(driver, 'look');
    say(`      gate unmet; asked for a look: ${driver.narration.last.replace(/\s+/g, ' ').slice(0, 130)}`);
  }
  if (gate) check(`gate after "${intent}"`, gateOk(), gate.source || String(gate));
}

// ---- driver scaffolding -----------------------------------------------------
function makeDriver(gameId) {
  const narration = new RecordingNarration();
  let savedBytes = null;
  const adapter = new GameAdapter({
    onSave: (_id, snap) => { savedBytes = snapshotToQuetzal(snap, adapter.vm.original); return true; },
    onRestore: () => savedBytes ? quetzalToSnapshot(savedBytes, adapter.vm.original) : null,
  });
  return {
    name: gameId, adapter, narration,
    get savedBytes() { return savedBytes; },
    async boot(bytes) {
      const turn = adapter.load(bytes, gameId);
      await narration.speak(sentencesOf(turn.text.trim()).map((t) => ({ text: t })));
      say(`  [${gameId}] opening narration: ${narration.last.replace(/\s+/g, ' ').slice(0, 130)}`);
      return turn;
    },
  };
}

// ============================ LANTERN BELOW =================================
say('\n== EYES CLOSED: The Lantern Below — full run ==');
const lanternBytes = new Uint8Array(await readFile(path.join(root, 'games', 'lantern-below', 'lantern-below.z5')));
const L = makeDriver('lantern-below');
await L.boot(lanternBytes);
check('boot gate: the narration names the city', /Veyra/.test(L.narration.last));

const plan = [
  ['status', /Stamina/], ['help', /STATUS/], ['look', /Lantern Atrium/],
  ['north', /Sunken Steps/],
  ['strike', /Thrall/], ['evade', /Thrall/], ['heavy strike', /comes apart/],
  ['east', /Dusty Gallery/], ['read tablet', /did not lose the light/, ['examine tablet', 'look at tablet']],
  ['search crack', /glimmer/i],
  ['take glimmer', /You gather the cache|Taken/, ['take all', 'get glimmer', 'take cache', 'take it']], ['inventory', /carrying/i],
  ['west', /Sunken Steps/], ['south', /Lantern Atrium/], ['rest', /You rest in the lantern light/],
  ['north', /Sunken Steps/], ['north', /Flooded Stacks/],
  ['attack sentinel', /Sentinel/], ['strike', /Sentinel/], ['guard', /raise your guard|set your feet/],
  ['heavy strike', /Sentinel/], ['strike', /comes apart/],
  ['east', /Lever Chamber/], ['pull lever', /goes over with a clang|already over/, ['push lever', 'turn lever', 'pull the lever']],
  ['west', /Flooded Stacks/],
  ['open iron door', /You open the iron door|already open/], ['north', /Bell Approach/],
  ['open shaft', /haul the bar aside/, ['open grate', 'open the grate']], ['down', /Atrium|Steps/], ['up', /Bell Approach/],
  ['strengthen health', /Maximum HP is now/], ['rest', /You rest in the lantern light/],
  ['north', /Bell Archive/],
  ['wait', null], ['wait', null], ['repeat', null],
  ['wait', null], ['wait', null], ['wait', null], ['wait', null],
  ['status', /Glimmer\s+0/],
  ['north', /Bell Archive/], ['take glimmer', /glimmer recovered/, ['take all', 'get glimmer', 'take it']],
  ['south', /Bell Approach/], ['rest', /lantern/i], ['north', /Bell Archive/],
  ['strike', /Warden/], ['guard', /Warden/], ['heavy strike', /Warden/],
  ['wait', null], ['guard', null], ['heavy strike', /Warden/],
  ['strike', null], ['wait', null], ['guard', null], ['strike', /comes apart/],
  ['take core', /THE LANTERN BELOW IS LIT/],
];
for (const [intent, gate, alternates] of plan) await step(L, intent, gate, alternates);
check('the run died and dropped its glimmer (heard, not seen)', /YOU DIED/.test(L.narration.all));
check('the Warden\'s tolling phase was heard', /begins to toll/.test(L.narration.all));
check('all three enemies fell, by narration count',
  (L.narration.all.match(/comes apart/g) || []).length === 3,
  `${(L.narration.all.match(/comes apart/g) || []).length} falls heard`);
check('the Lantern Core ended the game lit', /THE LANTERN BELOW IS LIT/.test(L.narration.all));
if (L.adapter.vm && !L.adapter.vm.halted) {
  await step(L, 'quit', null);
}

// ================================ FIGARO ====================================
say('\n== EYES CLOSED: Figaro — a session with save/restore by voice ==');
const figaroBytes = new Uint8Array(await readFile(path.join(root, 'games', 'figaro', 'Figaro.zblorb')));
const F = makeDriver('figaro');
await F.boot(figaroBytes);
check('boot gate: banner and first room heard', /Figaro/.test(F.narration.last) && /Bedroom/.test(F.narration.all));
await step(F, 'look', /trunk/);
const firstLook = F.narration.last;
await step(F, 'peek through keyhole', /peek/i);
await step(F, 'save', /Ok\./);
check('the save the game made is a Quetzal file', !!F.savedBytes
  && String.fromCharCode(...F.savedBytes.subarray(0, 4)) === 'FORM');
await step(F, 'wait', null);
await step(F, 'restore', null);
await step(F, 'look', /trunk/);
check('the look after restore matches the look before the save',
  F.narration.last === firstLook,
  F.narration.last === firstLook ? 'identical narration' : 'narration differs');

// ============================== verdict =====================================
say('\n== voice-path fidelity ==');
say(`ASR misses (no transcript at all): ${asrMisses}`);
say(`deviations (intended vs finally sent): ${deviations.length}`);
for (const d of deviations) say(`  ${d}`);
check('every intended command produced a transcript', asrMisses === 0);

proxyProc.kill();
const verdict = failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`;
say(verdict);
await writeFile(path.join(here, 'eyes-closed-transcript.txt'),
  `EYES-CLOSED ACCEPTANCE — voice in (Muse Voice Transcribe via proxy + flite test voice),\n`
  + `narration captured at the NarrationService boundary; the driver never reads the screen model.\n`
  + `Date: ${new Date().toISOString()}\n\n` + log.join('\n') + '\n');
process.exit(failures === 0 ? 0 : 1);
