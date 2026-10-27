// map3d.mjs — Day-3 test for the 3D living map's projection module:
// geometry sanity (iso directions, height) and the fog rules (only
// placed rooms get boxes; edges only between placed rooms; a
// prose-named unwalked exit is a labeled stub, never a room).
// Feeds synthetic adapter-shaped snapshots, plus one real snapshot
// taken from a short Lantern Below session.
//
// Run: node test/map3d.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { projectMap } from '../web/map3d.js';
import { GameAdapter } from '../core/adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}
const center = (box) => ({
  x: (box.top[0].x + box.top[2].x) / 2,
  y: (box.top[0].y + box.top[2].y) / 2,
});

// An L of three visited rooms + one room known only by a prose name.
const map = {
  current: 'Atrium',
  rooms: [
    { name: 'Atrium', x: 0, y: 0, z: 0, placed: true, exits: { north: 'Steps' }, exitNames: { north: 'Steps', east: 'Dusty Gallery' } },
    { name: 'Steps', x: 0, y: -1, z: 0, placed: true, exits: { south: 'Atrium', up: 'Loft' }, exitNames: {} },
    { name: 'Loft', x: 0, y: -1, z: 1, placed: true, exits: { down: 'Steps' }, exitNames: {} },
    { name: 'Dusty Gallery', x: 1, y: 0, z: 0, placed: false, exits: {}, exitNames: {} },
  ],
};
const out = projectMap(map, 680, 560);
const names = out.boxes.map((b) => b.name);
check('only placed rooms get boxes', names.length === 3 && !names.includes('Dusty Gallery'),
  names.join(','));
check('exactly one box is the current room', out.boxes.filter((b) => b.current).length === 1 &&
  out.boxes.find((b) => b.current).name === 'Atrium');
const atrium = center(out.boxes.find((b) => b.name === 'Atrium'));
const steps = center(out.boxes.find((b) => b.name === 'Steps'));
const loft = center(out.boxes.find((b) => b.name === 'Loft'));
check('north projects up-screen from south', steps.y < atrium.y, `steps.y=${steps.y.toFixed(1)} atrium.y=${atrium.y.toFixed(1)}`);
check('a room above (z+1) projects higher than the room below it', loft.y < steps.y,
  `loft.y=${loft.y.toFixed(1)} steps.y=${steps.y.toFixed(1)}`);
check('edges join placed rooms, once per pair', out.edges.length === 2,
  `${out.edges.length} edges for 2 room pairs`);
check('the named-but-unwalked exit is a labeled stub, not geometry',
  out.stubs.length === 1 && out.stubs[0].label === 'Dusty Gallery',
  JSON.stringify(out.stubs.map((s) => s.label)));
check('boxes are painter-sorted far-to-near (north room first)',
  names[0] === 'Steps' || names[0] === 'Loft', names.join(','));

// Real snapshot from a live Lantern session: boot + north.
const bytes = new Uint8Array(await readFile(path.join(here, '..', 'games', 'lantern-below', 'lantern-below.z5')));
const a = new GameAdapter({});
a.load(bytes, 'lantern');
const t = a.runTurn('north');
const live = projectMap(t.map, 680, 560);
check('live snapshot: two visited rooms, both boxed',
  live.boxes.length === 2 && live.boxes.some((b) => b.name === 'Sunken Steps'),
  live.boxes.map((b) => b.name).join(','));
check('live snapshot: the Steps\' named exits appear as stubs',
  live.stubs.length === 2 && live.stubs.every((s) => ['Flooded Stacks', 'Dusty Gallery'].includes(s.label)),
  JSON.stringify(live.stubs.map((s) => s.label)));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
