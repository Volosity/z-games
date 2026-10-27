// probe.mjs — development probe: boot Figaro headlessly and print every
// turn, so the interpreter core can be debugged against the real game.
// Usage: node test/probe.mjs [cmd1, cmd2, ...]
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GameAdapter } from '../core/adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bytes = new Uint8Array(await readFile(path.join(here, '..', 'games', 'figaro', 'Figaro.zblorb')));

let saved = null;
const adapter = new GameAdapter({
  onSave: (_id, snap) => { saved = snap; console.log('   [hook: save]'); return true; },
  onRestore: () => { console.log('   [hook: restore]'); return saved; },
});

function show(turn, label) {
  console.log(`===== ${label} (need=${turn.need}) room=${JSON.stringify(turn.room)} score=${turn.score} moves=${turn.moves}`);
  console.log(turn.text.replace(/\n{3,}/g, '\n\n'));
}

show(adapter.load(bytes, 'figaro'), 'OPENING');
const script = process.argv[2]
  ? process.argv[2].split(',').map((s) => s.trim())
  : ['look', 'inventory', 'about'];
for (const cmd of script) {
  try {
    show(adapter.runTurn(cmd), `> ${cmd}`);
  } catch (e) {
    console.log(`!! command "${cmd}" failed: ${e.message}`);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
    break;
  }
}
console.log('===== map:', JSON.stringify(adapter.mapSnapshot()));
