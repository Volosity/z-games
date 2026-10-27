// proxy.mjs — the key-custody proxy (spec Section 8) + static server for
// local development. The app knows only this proxy; it never sees a key.
//
// API access goes through the registered Meta Model API connector helper
// (meta_api.py), which is where the credential lives — this proxy holds
// no key at all. If the helper is absent or a call fails, endpoints answer
// "unavailable" and the shell runs its fully-local path (device voice,
// device speech, local affordance stub): the spec's stated degradation,
// not an error.
//
// Run: node server/proxy.mjs   (PORT env, default 8377)
import http from 'node:http';
import { readFile, appendFile, access, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8377);
const HELPER = process.env.META_API_HELPER
  || path.join(os.homedir(), 'workspace/custom-connectors/custom.meta-model-api/bin/meta_api.py');
const MODEL = 'muse-spark-1.3'; // Standard tier only — never -contributor
const USAGE_LOG = path.join(root, 'server', 'api-usage.log');

async function helperAvailable() {
  try { await access(HELPER); return true; } catch { return false; }
}

function callHelper(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const p = spawn('python3', [HELPER, ...args], { timeout: timeoutMs });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`helper exit ${code}: ${err.slice(0, 200)}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('helper returned non-JSON')); }
    });
  });
}

function callSpark(prompt, maxTokens = 1500) {
  return callHelper(['chat', MODEL, prompt, String(maxTokens)]);
}

const PURPOSE_MODEL = {
  'spark-normalize': MODEL,
  'voice-transcribe': 'muse-voice-transcribe-1.0',
  'art-generate': 'muse-image-1.0',
};
async function logUsage(purpose, usage) {
  await appendFile(USAGE_LOG, JSON.stringify({
    at: new Date().toISOString(), purpose, model: PURPOSE_MODEL[purpose] || MODEL, usage,
  }) + '\n').catch(() => {});
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.zblorb': 'application/octet-stream',
  '.z5': 'application/octet-stream', '.z8': 'application/octet-stream', '.z3': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/health') {
    const ok = await helperAvailable();
    return json(res, 200, {
      ok: true, apiConfigured: ok, model: MODEL, day: 2,
      // Voice out: the Meta Model API offers NO speech synthesis (checked
      // 2026-10-27: transcription only; Muse Glimmer TTS is a downloadable
      // model, not an API endpoint). Narration stays on the device voice
      // behind the same NarrationService interface.
      voiceIn: ok, voiceOut: 'device', art: ok,
    });
  }
  if (url.pathname === '/api/voice/transcribe' && req.method === 'POST') {
    // Voice in: Muse Voice Transcribe (muse-voice-transcribe-1.0) via the
    // connector helper. The API accepts ONLY mono PCM16 WAV at 16/24 kHz,
    // so whatever the browser recorded (webm/opus, mp4...) is transcoded
    // with ffmpeg first. No ffmpeg -> pass a WAV upload through as-is,
    // anything else is honestly "unavailable" and the shell degrades.
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks);
      if (!raw.length) return json(res, 400, { status: 'bad_request', transcript: null });
      if (!(await helperAvailable())) return json(res, 200, { status: 'unavailable', transcript: null });
      const dir = await mkdtemp(path.join(os.tmpdir(), 'zg-asr-'));
      try {
        const inFile = path.join(dir, 'in.audio');
        const wavFile = path.join(dir, 'in.wav');
        await writeFile(inFile, raw);
        const converted = await new Promise((resolve) => {
          const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', inFile,
            '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavFile], { timeout: 30000 });
          p.on('error', () => resolve(false));
          p.on('close', (code) => resolve(code === 0));
        });
        const sendFile = converted ? wavFile
          : (raw.subarray(0, 4).toString('latin1') === 'RIFF' ? inFile : null);
        if (!sendFile) return json(res, 200, { status: 'unavailable', transcript: null, error: 'no transcoder for this audio format' });
        const data = await callHelper(['transcribe', sendFile]);
        const transcript = typeof data.transcript === 'string' ? data.transcript : null;
        await logUsage('voice-transcribe', { audioDurationMs: data.audioDurationMs ?? null });
        return json(res, 200, {
          status: transcript ? 'ok' : 'unavailable',
          transcript,
          audioDurationMs: data.audioDurationMs ?? null,
        });
      } catch (e) {
        return json(res, 200, { status: 'unavailable', transcript: null, error: String(e.message || e) });
      } finally {
        rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    });
    return;
  }
  if (url.pathname === '/api/art/for-room' && req.method === 'POST') {
    // Discovery art (spec Section 6): decoration only, generated once per
    // room from the room's own printed description, cached on disk forever
    // (never re-billed). Ornament tier: it illustrates what the text
    // already said and carries no game information.
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      try {
        const { gameId, room, description } = JSON.parse(body || '{}');
        if (!room || !description) return json(res, 400, { status: 'bad_request', url: null });
        const key = createHash('sha1').update(`${gameId || 'game'}|${room}`).digest('hex');
        const cacheDir = path.join(root, 'server', 'art-cache');
        const file = path.join(cacheDir, `${key}.webp`);
        const relUrl = `/art-cache/${key}.webp`;
        try { await access(file); return json(res, 200, { status: 'ready', url: relUrl, cached: true }); } catch { /* not yet made */ }
        if (!(await helperAvailable())) return json(res, 200, { status: 'unavailable', url: null });
        await mkdir(cacheDir, { recursive: true });
        const prompt = [
          'Dark-fantasy illustration for a text adventure discovery card.',
          'Cold stone, old machinery, dim lantern light. Moody, painterly, no text, no letters, no words.',
          `The scene, exactly as the game describes it: ${String(description).replace(/\s+/g, ' ').slice(0, 600)}`,
        ].join(' ');
        const data = await callHelper(['image', prompt, file]);
        await logUsage('art-generate', data.usage || null);
        return json(res, 200, { status: 'ready', url: relUrl, cached: false });
      } catch (e) {
        return json(res, 200, { status: 'unavailable', url: null, error: String(e.message || e) });
      }
    });
    return;
  }
  if (url.pathname === '/api/spark/normalize' && req.method === 'POST') {
    // THE LEASH (spec Section 8): Spark's only job is affordance
    // normalization. The prompt enumerates exactly the commands the
    // visible interface could compose right now; the model picks one or
    // declines; this endpoint then VALIDATES the answer against the same
    // list before returning it. Anything else is a decline.
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      try {
        const { sentence, affordances } = JSON.parse(body || '{}');
        if (!sentence || !affordances) return json(res, 400, { status: 'bad_request', command: null });
        if (!(await helperAvailable())) return json(res, 200, { status: 'unavailable', command: null });
        const allowed = [...new Set([
          ...(affordances.allDirections || []),
          ...(affordances.directions || []),
          'look', 'inventory', 'wait', 'help', 'status', 'rest', 'repeat',
          'save', 'restore', 'undo',
        ])];
        const prompt = [
          'You normalize a player\'s sentence into ONE command for a text game.',
          'You may ONLY choose from this exact list of commands:',
          allowed.join(', '),
          'If the sentence clearly means one of them, reply with that command and nothing else.',
          'If it does not clearly mean one of them, reply with the single word DECLINE.',
          'Never invent a command. Never add words.',
          `Player sentence: "${sentence}"`,
        ].join('\n');
        const data = await callSpark(prompt);
        const usage = data.usage || null;
        await appendFile(USAGE_LOG, JSON.stringify({
          at: new Date().toISOString(), purpose: 'spark-normalize', model: MODEL, usage,
        }) + '\n').catch(() => {});
        const raw = (data.choices?.[0]?.message?.content || '').trim().toLowerCase();
        const cmd = raw.replace(/[."]+$/g, '');
        if (cmd && cmd !== 'decline' && allowed.includes(cmd)) {
          return json(res, 200, { status: 'ok', command: cmd, usage });
        }
        return json(res, 200, { status: 'declined', command: null, usage });
      } catch (e) {
        return json(res, 200, { status: 'unavailable', command: null, error: String(e.message || e) });
      }
    });
    return;
  }
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'unknown endpoint' });

  // Static: web/ at /, everything else repo-relative (core/, games/, ...).
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/web/index.html';
  else if (!rel.startsWith('/web/') && !rel.startsWith('/core/') && !rel.startsWith('/games/')
    && !rel.startsWith('/services/') && !rel.startsWith('/test/') && !rel.startsWith('/demo/')
    && !rel.startsWith('/art-cache/')) rel = '/web' + rel;
  const file = rel.startsWith('/art-cache/') ? path.join(root, 'server', rel) : path.join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

server.listen(PORT, async () => {
  const ok = await helperAvailable();
  console.log(`Galileo / Z-Games dev server on http://localhost:${PORT}/  (Spark via connector helper: ${ok ? 'available' : 'unavailable — local path'})`);
});
