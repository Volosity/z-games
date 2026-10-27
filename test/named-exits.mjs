// named-exits.mjs — Day-3 test for game-named exit parsing: exits the
// game's own prose names ("The Flooded Stacks lie north", "Passages
// climb north toward the Sunken Steps") are learned as NAMES for the
// compass and sonar, while destinations stay traversal-only (the
// Fairness Law: a name never places a room and never becomes an edge).
//
// Run: node test/named-exits.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GameAdapter } from '../core/adapter.js';
import { sonarSummary } from '../services/sonar.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const lanternBytes = new Uint8Array(await readFile(path.join(here, '..', 'games', 'lantern-below', 'lantern-below.z5')));
const a = new GameAdapter({});
const boot = a.load(lanternBytes, 'lantern');

check('boot: the Atrium\'s north exit is named by the opening prose',
  boot.affordances.exitNamesHere.north === 'Sunken Steps',
  JSON.stringify(boot.affordances.exitNamesHere));
check('boot: the name is not a destination (no edge, room unplaced)',
  !('north' in (boot.map.rooms.find((r) => r.name === 'Lantern Atrium')?.exits || {})) &&
  !boot.map.rooms.some((r) => r.name === 'Sunken Steps'));
check('boot: traversal directions stay empty until walked',
  boot.affordances.directions.length === 0, JSON.stringify(boot.affordances.directions));

const tNorth = a.runTurn('north');
check('Sunken Steps: both prose-named exits learned',
  tNorth.affordances.exitNamesHere.north === 'Flooded Stacks' &&
  tNorth.affordances.exitNamesHere.east === 'Dusty Gallery',
  JSON.stringify(tNorth.affordances.exitNamesHere));
check('Sunken Steps: named exits are still not destinations',
  !tNorth.map.rooms.some((r) => r.name === 'Flooded Stacks' || r.name === 'Dusty Gallery'));
const steps = tNorth.map.rooms.find((r) => r.name === 'Sunken Steps');
check('Sunken Steps: only the walked edge (south) is a real exit',
  steps && steps.exits.south === 'Lantern Atrium' && !('north' in steps.exits) && !('east' in steps.exits),
  JSON.stringify(steps && steps.exits));
check('Sunken Steps: names ride the map snapshot for the compass',
  steps.exitNames.north === 'Flooded Stacks' && steps.exitNames.east === 'Dusty Gallery');
const atrium = tNorth.map.rooms.find((r) => r.name === 'Lantern Atrium');
check('Atrium: after walking it, north is both named and an edge',
  atrium.exits.north === 'Sunken Steps' && atrium.exitNames.north === 'Sunken Steps');

// Sonar speaks the names when they exist, and is unchanged without.
check('sonar summary speaks prose names',
  sonarSummary(['north', 'east'], { north: 'Flooded Stacks', east: 'Dusty Gallery' }) ===
  'Exits shown from here: north toward Flooded Stacks, east toward Dusty Gallery.');
check('sonar summary without names keeps the Day-2 wording',
  sonarSummary(['north']) === 'Exits shown from here: north.');

// Figaro: different prose lineage — names may or may not appear, but
// nothing may be fabricated as a destination.
const figBytes = new Uint8Array(await readFile(path.join(here, '..', 'games', 'figaro', 'Figaro.zblorb')));
const f = new GameAdapter({});
const fBoot = f.load(figBytes, 'figaro');
check('Figaro boot: no destinations fabricated from prose',
  fBoot.map.rooms.length === 1 && Object.keys(fBoot.map.rooms[0].exits).length === 0,
  JSON.stringify(fBoot.map.rooms[0].exits));
console.log('Figaro boot exitNamesHere (informational):', JSON.stringify(fBoot.affordances.exitNamesHere));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
