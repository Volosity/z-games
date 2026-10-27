// lantern-headless.mjs — the showcase game (The Lantern Below, our own
// work) driven through the SAME adapter the shell uses, with the exact
// walkthrough that dfrotz verified (games/lantern-below/walkthrough.txt).
// Proves the shell can load and finish either bundled game.
// Run: node test/lantern-headless.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GameAdapter } from '../core/adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.join(here, '..', 'games', 'lantern-below');
const bytes = new Uint8Array(await readFile(path.join(gameDir, 'lantern-below.z5')));
const scriptText = await readFile(path.join(gameDir, 'walkthrough.txt'), 'utf8');
const commands = scriptText.split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

let saved = null;
const adapter = new GameAdapter({
  onSave: (_id, snap) => { saved = snap; return true; },
  onRestore: () => saved,
});

let failures = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

let allText = '';
const t0 = adapter.load(bytes, 'lantern-below');
allText += t0.text;
check('Lantern Below boots in the shell core', t0.text.includes('Veyra'));
check('first room is the Lantern Atrium', t0.room === 'Lantern Atrium', `room=${t0.room}`);

let died = false, lit = false;
for (const cmd of commands) {
  const turn = adapter.runTurn(cmd);
  allText += '\n' + turn.text;
  if (turn.text.includes('YOU DIED')) died = true;
  if (turn.text.includes('THE LANTERN BELOW IS LIT')) lit = true;
}
check('the scripted loop dies and drops its glimmer', died && allText.includes('fallen glimmer'));
check('the glimmer is recovered', allText.includes('glimmer recovered'));
check('all three enemies fall', (allText.match(/comes apart like wet paper/g) || []).length === 3);
check('the Warden fight reaches its stamina-pressure phase', allText.includes('begins to toll'));
check('the Lantern Core ends the game lit', lit);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
