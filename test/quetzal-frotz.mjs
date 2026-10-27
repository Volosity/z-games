// quetzal-frotz.mjs — Day-3 cross-interpreter proof: Quetzal save files
// written by OUR core restore inside Frotz 2.55 (dfrotz), and save files
// written by Frotz restore inside our core. Day 2 proved our files parse
// back into our own core and match the spec byte-for-byte; this proves
// the stronger claim — the files are real Quetzal, interchangeable with
// the reference interpreter's.
//
// Needs a dfrotz binary: $DFROTZ, ~/workspace/tools/dfrotz, or
// /usr/local/bin/dfrotz. (Built from the pristine Frotz 2.55 source
// release; the Frotz fork vendored in a local bench tree proved inert.)
// Without one the test SKIPs loudly instead of failing — the committed
// transcript (test/quetzal-frotz-transcript.txt) is the standing proof.
//
// The Lantern Below is deterministic, so state can be compared exactly:
// after `north`, the Archive Thrall's rake leaves HP 21/24 on every
// interpreter (verified against Frotz directly). Figaro does one
// direction (ours -> Frotz) on room + move count.
//
// Run: node test/quetzal-frotz.mjs
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';
import { GameAdapter } from '../core/adapter.js';
import { extractStoryFile } from '../core/blorb.js';
import { snapshotToQuetzal, quetzalToSnapshot } from '../core/quetzal.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
let failures = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const dfrotz = [process.env.DFROTZ, path.join(homedir(), 'workspace', 'tools', 'dfrotz'), '/usr/local/bin/dfrotz']
  .find((p) => p && existsSync(p));
if (!dfrotz) {
  console.log('SKIP  no dfrotz binary found ($DFROTZ, ~/workspace/tools/dfrotz, /usr/local/bin/dfrotz)');
  console.log('      The committed transcript test/quetzal-frotz-transcript.txt is the standing proof.');
  process.exit(0);
}
console.log(`dfrotz: ${dfrotz}`);

const tmp = await mkdtemp(path.join('/tmp', 'zg-cross-'));
const transcript = [];
function runFrotz(storyPath, lines) {
  const input = lines.join('\n') + '\n';
  const res = spawnSync(dfrotz, ['-w', '100', storyPath], { input, encoding: 'utf8', timeout: 60000 });
  const out = (res.stdout || '') + (res.stderr || '');
  transcript.push(`$ dfrotz -w 100 ${path.basename(storyPath)} <<EOF\n${input}EOF\n${out}\n`);
  return out;
}

// ---------- The Lantern Below, both directions -------------------------
const lanternPath = path.join(repo, 'games', 'lantern-below', 'lantern-below.z5');
const lanternBytes = new Uint8Array(await readFile(lanternPath));

// Direction A: our core saves -> Frotz restores.
{
  let snapBytes = null;
  const a = new GameAdapter({
    onSave: (_id, snap) => { snapBytes = snapshotToQuetzal(snap, a.vm.original); return !!snapBytes; },
    onRestore: () => null,
  });
  a.load(lanternBytes, 'lantern');
  a.runTurn('look');
  const tNorth = a.runTurn('north');
  check('A: our core reaches the saved state (Sunken Steps, moves 2)',
    tNorth.room === 'Sunken Steps' && tNorth.moves === 2, `room=${tNorth.room} moves=${tNorth.moves}`);
  a.runTurn('save');
  check('A: our core produced a Quetzal save', !!snapBytes);
  // Frotz appends .qzl to save/restore filenames that lack it, so the
  // file must carry the suffix for Frotz to find it at all.
  const savePath = path.join(tmp, 'cross-a.qzl');
  await writeFile(savePath, snapBytes);
  const out = runFrotz(lanternPath, ['restore', savePath, 'status', 'quit', 'y']);
  check('A: Frotz restored our save (status shows the saved fight state)',
    out.includes('HP 21 / 24'), 'looking for "HP 21 / 24" in the Frotz session');
  check('A: Frotz restored our save (status line: Sunken Steps, Moves 2)',
    out.includes('Sunken Steps') && out.includes('Moves: 2'));
}

// Direction B: Frotz saves -> our core restores.
{
  const savePath = path.join(tmp, 'cross-b.sav');
  const out = runFrotz(lanternPath, ['look', 'north', 'save', savePath, 'quit', 'y']);
  check('B: Frotz played to the same state (rake for 3, HP 21/24)',
    out.includes('HP 21/24') || out.includes('HP 21 / 24'));
  // Frotz appends .qzl to save filenames that don't already carry it.
  const written = existsSync(savePath) ? savePath : `${savePath}.qzl`;
  const frotzBytes = new Uint8Array(await readFile(written));
  check('B: Frotz wrote a Quetzal file', frotzBytes.length > 100 &&
    String.fromCharCode(...frotzBytes.subarray(0, 4)) === 'FORM');
  const a = new GameAdapter({
    onSave: () => false,
    onRestore: () => quetzalToSnapshot(frotzBytes, a.vm.original),
  });
  a.load(lanternBytes, 'lantern');
  const tRestore = a.runTurn('restore');
  check('B: our core restored Frotz\'s save (room)', tRestore.room === 'Sunken Steps',
    `room=${tRestore.room}`);
  check('B: our core restored Frotz\'s save (moves)', tRestore.moves === 2, `moves=${tRestore.moves}`);
  const tStatus = a.runTurn('status');
  check('B: our core restored Frotz\'s save (HP 21/24)', tStatus.text.includes('HP 21 / 24'));
}

// ---------- Figaro, ours -> Frotz --------------------------------------
{
  const raw = new Uint8Array(await readFile(path.join(repo, 'games', 'figaro', 'Figaro.zblorb')));
  const storyOnly = extractStoryFile(raw);
  const figStoryPath = path.join(tmp, 'figaro.z5');
  await writeFile(figStoryPath, storyOnly);
  let snapBytes = null;
  const a = new GameAdapter({
    onSave: (_id, snap) => { snapBytes = snapshotToQuetzal(snap, a.vm.original); return !!snapBytes; },
    onRestore: () => null,
  });
  a.load(raw, 'figaro');
  a.runTurn('look');
  a.runTurn('peek through keyhole');
  a.runTurn('save');
  check('Figaro: our core produced a Quetzal save', !!snapBytes);
  const savePath = path.join(tmp, 'cross-figaro.sav');
  await writeFile(savePath, snapBytes);
  const out = runFrotz(figStoryPath, ['restore', savePath, 'look', 'quit', 'y']);
  check('Figaro: Frotz restored our save (Bedroom, the trunk)',
    out.includes('Bedroom') && out.includes('trunk'));
}

await writeFile(path.join(here, 'quetzal-frotz-transcript.txt'),
  `QUETZAL <-> FROTZ CROSS-INTERPRETER PROOF\n` +
  `dfrotz: Frotz 2.55 (dumb interface), built from the pristine source release.\n` +
  `Generated by test/quetzal-frotz.mjs — Frotz sessions verbatim.\n\n` +
  transcript.join('\n================================================================\n'));
await rm(tmp, { recursive: true, force: true });

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
