// undo.mjs — Day-3 regression test for the restore_undo fidelity pass
// and the status-line header fix. Two defects are pinned here:
//
//  1. UNDO used to fall through to the parser as an unknown sentence.
//     Root cause: the undo ring mixed @read snapshots in with the
//     library's per-turn @save_undo snapshots, and the restore completed
//     its result into the *restore_undo* call site's variable — in the
//     restored timeline that write landed in the wrong frame's local,
//     the library never saw its "save_undo returned 2" signal, and the
//     turn fell through to a stale parse. The ring now holds @save_undo
//     snapshots only, and the restore completes into the snapshot's own
//     recorded store variable — the same convention as file restore,
//     and the same behavior Frotz 2.55 shows on this game.
//  2. The Lantern Below's status line drew "Time: 12:0-1 am" instead of
//     Score/Moves, leaving the adapter's score/moves null. Root cause:
//     header byte 1 bit 1 — claimed as "boldface available" — is read
//     by the Inform 6 library's ZZInitialise as the game's "status line
//     displays time" signal. The core now claims only the fixed-pitch
//     font it actually renders.
//
// Run: node test/undo.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GameAdapter } from '../core/adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

// ---- The Lantern Below: status line + full undo round-trip ----------
const lanternBytes = new Uint8Array(await readFile(path.join(here, '..', 'games', 'lantern-below', 'lantern-below.z5')));
const lan = new GameAdapter({});
const boot = lan.load(lanternBytes, 'lantern');
check('Lantern status line parses as Score/Moves (not Time:)', boot.score === 0 && boot.moves === 0,
  `score=${boot.score} moves=${boot.moves}`);

const atStart = new GameAdapter({});
atStart.load(lanternBytes, 'lantern');
const tUndoStart = atStart.runTurn('undo');
check('undo before any turn is refused by the game, not the parser',
  /can.t .*undo/i.test(tUndoStart.text), tUndoStart.text.trim().split('\n')[0].slice(0, 60));

lan.runTurn('look');
const tNorth = lan.runTurn('north');
check('north reaches the Sunken Steps, hurt', tNorth.room === 'Sunken Steps' && tNorth.moves === 2,
  `room=${tNorth.room} moves=${tNorth.moves}`);
const tUndo = lan.runTurn('undo');
check('undo prints the game\'s own confirmation', tUndo.text.includes('[Previous turn undone.]'));
check('undo restores the room', tUndo.room === 'Lantern Atrium', `room=${tUndo.room}`);
check('undo restores the move count', tUndo.moves === 1, `moves=${tUndo.moves}`);
const tStatus = lan.runTurn('status');
check('undo restores HP (the Thrall\'s rake never landed)', tStatus.text.includes('HP 24 / 24'));

// ---- Figaro (Inform 7): undo across the other library lineage --------
const figBytes = new Uint8Array(await readFile(path.join(here, '..', 'games', 'figaro', 'Figaro.zblorb')));
const fig = new GameAdapter({});
fig.load(figBytes, 'figaro');
fig.runTurn('wait');
const fUndo = fig.runTurn('undo');
check('Figaro undo rolls the move count back', fUndo.moves === 1, `moves=${fUndo.moves}`);
const fLook = fig.runTurn('look');
check('Figaro plays on normally after undo', fLook.moves === 2 && fLook.room === 'Bedroom');

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
