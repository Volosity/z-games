// demo-rehearsal.mjs — Day-3 gate for the demo flow: plays the exact
// command list of web/demo-script.js through the interpreter on The
// Lantern Below, with the shell's own Quetzal save slot wired the same
// way web/app.js wires it, and asserts every beat the demo captions
// promise. If a beat breaks, the demo script is wrong — fix the flow,
// not the test's expectations.
//
// Run: node test/demo-rehearsal.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GameAdapter } from '../core/adapter.js';
import { snapshotToQuetzal, quetzalToSnapshot } from '../core/quetzal.js';
import { DEMO_STEPS } from '../web/demo-script.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const bytes = new Uint8Array(await readFile(path.join(here, '..', 'games', 'lantern-below', 'lantern-below.z5')));
let slot = null;
const a = new GameAdapter({
  onSave: (_id, snap) => { slot = snapshotToQuetzal(snap, a.vm.original); return !!slot; },
  onRestore: () => (slot ? quetzalToSnapshot(slot, a.vm.original) : null),
});
a.load(bytes, 'lantern-below');

const cmds = DEMO_STEPS.map((s) => s.cmd).filter(Boolean);
check('the demo script issues a real arc of commands', cmds.length >= 18, `${cmds.length} commands`);

let northSeen = 0;
for (const step of DEMO_STEPS) {
  if (!step.cmd) continue;
  const t = a.runTurn(step.cmd);
  const bad = /didn.t understand|Restore failed|Save failed/i.test(t.text);
  check(`"${step.cmd}" plays clean`, t.need === 'line' && !bad,
    bad ? t.text.trim().split('\n').slice(-2).join(' ').slice(0, 90) : `room=${t.room}`);
  if (step.cmd === 'north') {
    northSeen++;
    if (northSeen === 1) check('beat: first north reaches the Sunken Steps', t.room === 'Sunken Steps', `room=${t.room}`);
    if (northSeen === 3) check('beat: the Stacks run reaches the Flooded Stacks', t.room === 'Flooded Stacks', `room=${t.room}`);
  }
  if (step.cmd === 'east') check('beat: east reaches the Dusty Gallery', t.room === 'Dusty Gallery', `room=${t.room}`);
  if (step.cmd === 'take glimmer') check('beat: the cache pays out (+25 glimmer)', t.text.includes('+25 glimmer'),
    t.text.trim().split('\n').filter(Boolean).slice(-1)[0].slice(0, 80));
  if (step.cmd === 'status' && northSeen >= 1) check('beat: status shows the banked glimmer', /Glimmer 55/.test(t.text));
  if (step.cmd === 'save') check('beat: save filled the Quetzal slot', !!slot);
  if (step.cmd === 'restore') check('beat: restore rewinds to the Lantern Atrium', t.room === 'Lantern Atrium', `room=${t.room}`);
}
const end = a.runTurn('status');
check('the game is alive and well after the whole arc', end.need === 'line' && /HP \d+ \/ 24/.test(end.text),
  end.text.match(/HP \d+ \/ 24/)?.[0]);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
