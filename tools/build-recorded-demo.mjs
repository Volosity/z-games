// build-recorded-demo.mjs — generates demo/recorded-demo.html, the
// offline fallback demo: a step-through replay of the automated
// eyes-closed acceptance transcript (test/eyes-closed-transcript.txt).
// Self-contained (no external assets) so it plays at a venue with no
// network. Re-run after any final-build eyes-closed run:
//
//   node tools/build-recorded-demo.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const transcript = await readFile(path.join(repo, 'test', 'eyes-closed-transcript.txt'), 'utf8');

const steps = [];
let cur = null;
for (const line of transcript.split('\n')) {
  const say = line.match(/^\s+\[[\w-]+\] say "(.*?)" ->/);
  if (say) { cur = { cmd: say[1], heard: '' }; steps.push(cur); continue; }
  const heard = line.match(/^\s+heard back: (.*)$/);
  if (heard && cur && !cur.heard) cur.heard = heard[1].trim();
  const gate = line.match(/^PASS\s+gate after "(.*?)" — (.*)$/);
  if (gate && cur) cur.gate = gate[2];
}
const usable = steps.filter((s) => s.heard);
if (usable.length < 10) throw new Error(`only ${usable.length} replayable steps parsed — transcript shape changed?`);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Z-Games — recorded demo (offline fallback)</title>
<style>
  body { background: #0b0b0f; color: #f2f0e9; font-family: Georgia, serif; margin: 0; padding: 2em 1em; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 1.5em; } .thin { color: #b9b4a6; font-weight: normal; }
  .card { background: #17171f; border: 1px solid #34343f; border-radius: 14px; padding: 1.2em 1.4em; min-height: 220px; }
  .cmd { color: #7fd4ff; font-weight: bold; font-size: 1.15em; }
  .heard { white-space: pre-wrap; line-height: 1.6; margin-top: 0.8em; }
  .gate { color: #ffd257; margin-top: 0.8em; font-style: italic; }
  .bar { display: flex; gap: 0.6em; margin: 1em 0; flex-wrap: wrap; }
  button { background: #1f1f2a; color: inherit; border: 1px solid #34343f; border-radius: 14px; padding: 0.6em 1.1em; font: inherit; cursor: pointer; min-height: 48px; }
  button:hover { border-color: #ffd257; }
  .count { color: #b9b4a6; align-self: center; }
</style>
</head>
<body>
<main>
  <h1>Z-Games <span class="thin">— recorded demo (offline fallback)</span></h1>
  <p class="thin">This is not a video. It steps through the actual transcript of the automated
  eyes-closed acceptance run on the final build: a synthetic voice speaks a command, Muse Voice
  Transcribe hears it, the real game answers, and the answer is captured at the narration boundary —
  the driver never reads the screen. Source: <code>test/eyes-closed-transcript.txt</code>,
  produced by <code>test/eyes-closed.mjs</code>.</p>
  <div class="bar">
    <button id="prev" type="button">← Prev</button>
    <button id="play" type="button">▶ Play</button>
    <button id="next" type="button">Next →</button>
    <span class="count" id="count"></span>
  </div>
  <div class="card">
    <div class="cmd" id="cmd"></div>
    <div class="heard" id="heard"></div>
    <div class="gate" id="gate"></div>
  </div>
</main>
<script>
  const steps = ${JSON.stringify(usable)};
  let i = 0, timer = null;
  function show() {
    const s = steps[i];
    document.getElementById('cmd').textContent = s.cmd ? '> say: "' + s.cmd + '"' : '';
    document.getElementById('heard').textContent = s.heard || '';
    document.getElementById('gate').textContent = s.gate ? '✓ acceptance gate: ' + s.gate : '';
    document.getElementById('count').textContent = (i + 1) + ' / ' + steps.length;
  }
  function step(d) { i = Math.min(steps.length - 1, Math.max(0, i + d)); show(); }
  document.getElementById('prev').onclick = () => step(-1);
  document.getElementById('next').onclick = () => step(1);
  document.getElementById('play').onclick = (e) => {
    if (timer) { clearInterval(timer); timer = null; e.target.textContent = '▶ Play'; return; }
    e.target.textContent = '⏸ Pause';
    timer = setInterval(() => { if (i >= steps.length - 1) { clearInterval(timer); timer = null; document.getElementById('play').textContent = '▶ Play'; return; } step(1); }, 4200);
  };
  show();
</script>
</body>
</html>
`;
await writeFile(path.join(repo, 'demo', 'recorded-demo.html'), html);
console.log(`recorded-demo.html written with ${usable.length} replay steps`);
