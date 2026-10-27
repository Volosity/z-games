// quetzal.mjs — Day-2 acceptance for Quetzal save files.
// For BOTH bundled games: play, SAVE through the game's own command,
// and prove the storage bytes are a real Quetzal (IFZS) file — checked
// by an independent spec parser in this file that shares no code with
// core/quetzal.js — then play on, RESTORE from those bytes through the
// game's own command, and prove the state (room, moves) is the saved
// state and the game is still alive afterwards.
// Run: node test/quetzal.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GameAdapter } from '../core/adapter.js';
import { extractStoryFile } from '../core/blorb.js';
import { snapshotToQuetzal, quetzalToSnapshot } from '../core/quetzal.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

// ---- an independent Quetzal reader, written from the spec alone ----
function specParse(bytes) {
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  const u32 = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  if (tag(0) !== 'FORM' || tag(8) !== 'IFZS') return null;
  if (u32(4) !== bytes.length - 8) return null;
  const chunks = {};
  let o = 12;
  while (o + 8 <= bytes.length) {
    const size = u32(o + 4);
    chunks[tag(o)] = { size, data: bytes.subarray(o + 8, o + 8 + size) };
    o += 8 + size + (size % 2);
  }
  return chunks;
}
function specDecompressCMem(cmem, story, dynLen) {
  const mem = new Uint8Array(story.subarray(0, dynLen));
  let i = 0, o = 0;
  while (i < cmem.length) {
    const b = cmem[i++];
    if (b !== 0) { mem[o++] ^= b; }
    else { o += cmem[i++] + 1; }
  }
  return mem;
}
function specParseStks(stks) {
  const frames = [];
  let p = 0;
  const u16 = (o) => (stks[o] << 8) | stks[o + 1];
  while (p < stks.length) {
    const returnPc = (stks[p] << 16) | (stks[p + 1] << 8) | stks[p + 2]; p += 3;
    const flags = stks[p++];
    const nLocals = flags & 0x0f, discard = !!(flags & 0x10);
    // The result-variable byte is always present (0 when discarded) —
    // Frotz's reader/writer are unconditional about it. This parser
    // originally shared the writer's omission assumption, which is why
    // the Day-2 proof passed files Frotz could only partly read; the
    // cross-interpreter test (test/quetzal-frotz.mjs) is the real check.
    const storeVar = stks[p++];
    const argsMask = stks[p++];
    const nEval = u16(p); p += 2;
    p += nLocals * 2 + nEval * 2;
    frames.push({ returnPc, nLocals, discard, storeVar, argsMask, nEval });
  }
  return { frames, consumedExactly: p === stks.length };
}

async function runGame(label, file, gameId, script) {
  console.log(`\n== ${label} ==`);
  const raw = new Uint8Array(await readFile(file));
  const story = extractStoryFile(raw);
  let savedBytes = null, savedMoves = null, savedRoom = null;
  const adapter = new GameAdapter({
    onSave: (_id, snap) => { savedBytes = snapshotToQuetzal(snap, adapter.vm.original); return true; },
    onRestore: () => savedBytes ? quetzalToSnapshot(savedBytes, adapter.vm.original) : null,
  });
  adapter.load(raw, gameId);
  for (const cmd of script.before) adapter.runTurn(cmd);
  const preSave = adapter.runTurn(script.peekBefore);
  savedRoom = preSave.room; savedMoves = preSave.moves;
  const savedState = script.stateOf ? script.stateOf(adapter.runTurn(script.stateProbe).text) : null;
  const saveTurn = adapter.runTurn('save');
  const movesAtSave = saveTurn.moves;
  check('SAVE produced storage bytes', !!savedBytes);
  if (!savedBytes) return;
  const chunks = specParse(savedBytes);
  check('bytes are a well-formed IFF FORM / IFZS', !!chunks);
  check('file carries IFhd, CMem and Stks', !!(chunks && chunks.IFhd && chunks.CMem && chunks.Stks));
  if (chunks) {
    const h = chunks.IFhd.data;
    const u16 = (b, o) => (b[o] << 8) | b[o + 1];
    check('IFhd release matches the story header', u16(h, 0) === u16(story, 2));
    check('IFhd serial matches the story header',
      [...h.subarray(2, 8)].every((v, i) => v === story[18 + i]));
    check('IFhd checksum matches the story header', u16(h, 8) === u16(story, 28));
    const dynLen = u16(story, 14);
    const mem = specDecompressCMem(chunks.CMem.data, story, dynLen);
    check('CMem spec-decompresses to exactly the dynamic memory size', mem.length === dynLen);
    const { frames, consumedExactly } = specParseStks(chunks.Stks.data);
    check('Stks parses exactly to its end', consumedExactly, `${frames.length} frame(s)`);
    check('bottom frame is the Quetzal zero-return frame', frames.length > 0 && frames[0].returnPc === 0);
  }
  for (const cmd of script.after) adapter.runTurn(cmd);
  if (script.stateOf) {
    const wanderedState = script.stateOf(adapter.runTurn(script.stateProbe).text);
    check('play genuinely moved on after the save (game state changed)', wanderedState !== savedState,
      `state ${savedState} -> ${wanderedState}`);
  }
  const restored = adapter.runTurn('restore');
  check('RESTORE returns to the saved room', restored.room === savedRoom,
    `room=${restored.room} (saved: ${savedRoom})`);
  if (script.stateOf) {
    const restoredState = script.stateOf(adapter.runTurn(script.stateProbe).text);
    check('RESTORE returns to the saved game state', restoredState === savedState,
      `state=${restoredState} (saved: ${savedState})`);
  }
  if (savedMoves !== null && savedMoves !== undefined) {
    // The saved state's counter is movesAtSave (the state probe between
    // the pre-save peek and SAVE advanced it past savedMoves). After the
    // restore, the state probe (when the script has one) and the peek
    // each advance it once more. NOTE: this check never actually ran
    // before the Day-3 status-line fix — Lantern's moves parsed as null
    // (the "Time:" header bug) and the guard skipped it; its original
    // "+1" arithmetic was wrong by those probe turns.
    const expected = movesAtSave + (script.stateOf ? 1 : 0) + 1;
    const after = adapter.runTurn(script.peekBefore);
    check('RESTORE returns to the saved move count', after.moves === expected,
      `moves=${after.moves} (state saved at ${movesAtSave}, +probes/peek = ${expected})`);
  }
  const alive = adapter.runTurn(script.aliveCmd);
  check('the game is alive after restore', alive.text.trim().length > 0 && alive.need === 'line');
}

await runGame('Figaro (licensed starter, GPL v3)', path.join(here, '..', 'games', 'figaro', 'Figaro.zblorb'), 'figaro', {
  before: ['look'],
  peekBefore: 'peek through keyhole',
  stateProbe: 'wait',
  stateOf: null, // Figaro state is proven by room + move count below
  after: ['wait'],
  aliveCmd: 'look',
});

await runGame('The Lantern Below (showcase)', path.join(here, '..', 'games', 'lantern-below', 'lantern-below.z5'), 'lantern-below', {
  before: ['status', 'north', 'strike', 'evade', 'heavy strike'],
  peekBefore: 'look',
  stateProbe: 'status',
  stateOf: (text) => (text.match(/Glimmer\s+(\d+)/) || [])[1] || 'unparsed',
  after: ['east', 'search crack', 'take glimmer'],
  aliveCmd: 'status',
});

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
