// sonar-objects.mjs — Day-2 item 5 checks: the haptic sonar pattern
// function and the object-tree state channel, headless.
// Run: node test/sonar-objects.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameAdapter } from '../core/adapter.js';
import { sonarPattern, sonarSummary, SONAR_ORDER } from '../services/sonar.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
let failures = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

// ---- sonar pattern shape ---------------------------------------------------
check('no known exits gives the double-thud', JSON.stringify(sonarPattern([])) === '[300,180,120,180]');
check('one compass exit: lead pause + one short pulse', JSON.stringify(sonarPattern(['north'])) === '[300,60]');
check('sweep order is clockwise from north regardless of input order',
  JSON.stringify(sonarPattern(['south', 'north', 'east'])) === '[300,60,90,60,90,60]');
check('up is a long pulse', JSON.stringify(sonarPattern(['up'])) === '[300,180]');
check('mixed exits keep order and gaps',
  JSON.stringify(sonarPattern(['down', 'west'])) === '[300,60,90,180]');
check('summary names the exits', sonarSummary(['east', 'north']) === 'Exits shown from here: north, east.');
check('summary is honest when nothing is known', /No exits have been shown/.test(sonarSummary([])));
check('SONAR_ORDER covers the twelve directions', SONAR_ORDER.length === 12);

// ---- object-tree channel ----------------------------------------------------
const lantern = new GameAdapter({});
let t = lantern.load(new Uint8Array(await readFile(path.join(root, 'games', 'lantern-below', 'lantern-below.z5'))), 'lantern-below');
check('Lantern Atrium contents come from the object tree',
  Array.isArray(t.objects) && t.objects.some((n) => /lantern/i.test(n)),
  JSON.stringify(t.objects));
check('the shaft (a door object) is listed in the Atrium',
  Array.isArray(t.objects) && t.objects.some((n) => /shaft/i.test(n)));
t = lantern.runTurn('north');
check('Sunken Steps list the Thrall while it lives',
  Array.isArray(t.objects) && t.objects.some((n) => /thrall/i.test(n)),
  JSON.stringify(t.objects));
lantern.runTurn('strike');
lantern.runTurn('evade');
t = lantern.runTurn('heavy strike');
check('the kill lands (narration: comes apart, glimmer paid)', /comes apart/.test(t.text));
check('the channel reports tree truth: the game keeps the Thrall\'s remains in the room',
  Array.isArray(t.objects) && t.objects.some((n) => /thrall/i.test(n)),
  JSON.stringify(t.objects));

const figaro = new GameAdapter({});
t = figaro.load(new Uint8Array(await readFile(path.join(root, 'games', 'figaro', 'Figaro.zblorb'))), 'figaro');
check('Figaro (Inform 7 build) honestly reports null — its names live outside the Z object-name field',
  t.objects === null, `got ${JSON.stringify(t.objects)}`);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
