// api-review.mjs — BUILD-TIME use of the Meta Model API (Muse Spark):
// inspection and review passes over this repo's own code ("it does the
// work and does the inspection and complaining" — owner, 2026-10-27).
// Build tooling only — NOT the product's runtime surface (the product's
// one runtime API job is Spark affordance-normalization, behind
// server/proxy.mjs).
//
// Calls go through the registered connector helper (meta_api.py), which
// is where the credential lives. This tool never sees a key.
//
// Usage: node tools/api-review.mjs <file> [more files...]
//
// Discipline (owner's numbers): $150 free-credit pool; ~$80 build
// envelope; ~$70 fenced for the demo — this tool refuses to run when the
// ledger's estimated remaining balance reaches the reserve. Every call
// appends a row to docs/API_LEDGER.md with the usage the API reported;
// dollars are estimated at a conservative $5 per million tokens and
// flagged ESTIMATED (actuals live on the billing dashboard).
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = path.join(repoRoot, 'docs', 'API_LEDGER.md');
const HELPER = process.env.META_API_HELPER
  || path.join(os.homedir(), 'workspace/custom-connectors/custom.meta-model-api/bin/meta_api.py');
const MODEL = 'muse-spark-1.3'; // Standard tier only — never -contributor
const RESERVE_FLOOR = 70;
const EST_RATE_PER_MTOK = 5.0;

const ledger = await readFile(ledgerPath, 'utf8');
const spent = Number((ledger.match(/TOTAL_SPENT:\s*\$([0-9.]+)/) || [])[1] || 0);
if (150 - spent <= RESERVE_FLOOR) {
  console.error(`STOP: estimated remaining credits $${(150 - spent).toFixed(2)} at/below the ~$70 demo reserve.`);
  process.exit(3);
}
const files = process.argv.slice(2);
if (!files.length) { console.error('Give at least one file to review.'); process.exit(1); }

let corpus = '';
for (const f of files) corpus += `\n===== FILE: ${f} =====\n` + await readFile(path.join(repoRoot, f), 'utf8');
const prompt = `You are the inspection pass for an accessibility-first game shell being built in a hackathon. Review the code below the way a strict senior reviewer would: correctness bugs first, then accessibility regressions, then anything that would embarrass a live demo. Be specific: file, line context, failure mode, smallest fix. Do not rewrite the code; complain precisely. IMPORTANT: answer directly with the numbered findings list only — no preamble, no deliberation in the answer.\n${corpus}`;

const data = await new Promise((resolve, reject) => {
  // Spark reasons before answering and reasoning eats the budget; a
  // 4000-token cap returned empty content on a 14k-token prompt. 12000
  // leaves room for both reasoning and the findings themselves.
  const p = spawn('python3', [HELPER, 'chat', MODEL, prompt, '8000'], { timeout: 300000 });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', reject);
  p.on('close', (code) => {
    if (code !== 0) return reject(new Error(`helper exit ${code}: ${err.slice(0, 300)}`));
    try { resolve(JSON.parse(out)); } catch { reject(new Error('helper returned non-JSON')); }
  });
});

const usage = data.usage || {};
const inTok = usage.prompt_tokens ?? Math.ceil(prompt.length / 4);
const outTok = usage.completion_tokens ?? 0;
const est = ((inTok + outTok) / 1e6) * EST_RATE_PER_MTOK;
const row = `| ${new Date().toISOString()} | build-review (${files.join(', ')}) | ${MODEL} | ${inTok} | ${outTok} | $${est.toFixed(4)} ESTIMATED |\n`;
let updated = ledger.replace('## Tally', `${row}\n## Tally`);
updated = updated.replace(/TOTAL_SPENT:\s*\$[0-9.]+/,
  `TOTAL_SPENT: $${(spent + est).toFixed(4)}`);
await writeFile(ledgerPath, updated);
console.log(data.choices?.[0]?.message?.content || JSON.stringify(data, null, 2));
console.error(`\n[ledger] row appended — tokens in=${inTok} out=${outTok}, est $${est.toFixed(4)}, total est $${(spent + est).toFixed(4)}`);
