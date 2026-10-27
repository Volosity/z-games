// headless.mjs — Day-1 acceptance test: the bundled game (Figaro, GPL v3,
// a licensed component — see games/figaro/NOTICE.md) boots on the real
// interpreter core, plays, parses, and saves/restores through the game's
// own commands. Run: node test/headless.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GameAdapter } from '../core/adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bytes = new Uint8Array(await readFile(path.join(here, '..', 'games', 'figaro', 'Figaro.zblorb')));

let failures = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

let saved = null;
const adapter = new GameAdapter({
  onSave: (_id, snap) => { saved = snap; return true; },
  onRestore: () => saved,
});

const t0 = adapter.load(bytes, 'figaro');
check('game boots and asks for a line of input', t0.need === 'line');
check('banner names the game', t0.text.includes('Figaro'));
check('banner credits the author', t0.text.includes('Victor Gijsbers'));
check('first room shown in the game\'s own words', t0.text.includes('Bedroom (in the trunk)'));
check('status line parsed: room', t0.room === 'Bedroom', `room=${t0.room}`);
check('status line parsed: moves counting', t0.moves === 1, `moves=${t0.moves}`);

const t1 = adapter.runTurn('look');
check('LOOK repeats the room description', t1.text.includes('trunk'));
check('moves advance', t1.moves === 2, `moves=${t1.moves}`);

const t2 = adapter.runTurn('peek through keyhole');
check('a real game verb answers in prose', t2.text.includes('peek'), t2.text.trim().slice(0, 60));

adapter.runTurn('save');
check('SAVE reaches the save hook', saved !== null);
const t3 = adapter.runTurn('wait');
check('play continues after save', t3.moves === 4, `moves=${t3.moves}`);
const t4 = adapter.runTurn('restore');
check('RESTORE returns to the saved move count', t4.moves === 3, `moves=${t4.moves}`);

const map = adapter.mapSnapshot();
check('fog map holds exactly the visited room', map.rooms.length === 1 && map.rooms[0].name === 'Bedroom');

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
