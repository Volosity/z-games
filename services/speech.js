// speech.js — SpeechInput: voice in (spec Section 5). The microphone
// accepts everything the fingers can do. Whatever is heard is transcribed
// and then constrained by the SparkNormalizer before it can reach the
// game — the shell never sends the game a sentence the visible interface
// could not itself have composed (plus the player's own SAY-IT sentences,
// which are theirs).
//
// Day 1 implementation: DeviceSpeech — the platform speech recognizer
// where available (the spec's degradation path, Section 8). The API
// transcription (Muse Voice) implements this same interface behind the
// proxy when wired.
//
// Day 2: ApiSpeech — Muse Voice Transcribe (muse-voice-transcribe-1.0)
// behind the key-custody proxy. The browser records with MediaRecorder
// (whatever container it offers); the proxy transcodes to the API's
// narrow input (mono PCM16 WAV, 16 kHz) and transcribes. listen() is
// push-to-talk: it records from the call until stop() or a 6-second cap,
// then resolves with the transcript (or null — the caller degrades to
// DeviceSpeech or typing; play never blocks on the API).

export class DeviceSpeech {
  constructor() {
    const Ctor = typeof window !== 'undefined'
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;
    this.recognition = Ctor ? new Ctor() : null;
    if (this.recognition) {
      this.recognition.lang = 'en-US';
      this.recognition.interimResults = false;
      this.recognition.maxAlternatives = 1;
    }
  }
  get available() { return !!this.recognition; }
  // Resolves with the transcript string, or null if nothing was heard.
  listen() {
    if (!this.recognition) return Promise.resolve(null);
    return new Promise((resolve) => {
      const rec = this.recognition;
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      rec.onresult = (ev) => done(ev.results[0][0].transcript);
      rec.onerror = () => done(null);
      rec.onend = () => done(null);
      try { rec.start(); } catch { done(null); }
    });
  }
  stop() { try { this.recognition && this.recognition.stop(); } catch { /* noop */ } }
}

export class ApiSpeech {
  constructor(proxyBase = '') {
    this.proxyBase = proxyBase;
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.stopped = null; // resolver wired by listen()
  }
  get available() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices
      && typeof window !== 'undefined' && !!window.MediaRecorder;
  }
  async listen() {
    if (!this.available) return null;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch { return null; }
    this.chunks = [];
    const rec = new MediaRecorder(this.stream);
    this.recorder = rec;
    const done = new Promise((resolve) => { this.stopped = resolve; });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    rec.onstop = async () => {
      this.stream.getTracks().forEach((t) => t.stop());
      this.recorder = null;
      const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
      const transcript = await this.transcribe(blob);
      if (this.stopped) { const r = this.stopped; this.stopped = null; r(transcript); }
    };
    try { rec.start(); } catch { return null; }
    setTimeout(() => this.stop(), 6000); // one command is a few seconds
    return done;
  }
  async transcribe(blob) {
    try {
      const r = await fetch(`${this.proxyBase}/api/voice/transcribe`, {
        method: 'POST',
        headers: { 'content-type': blob.type || 'application/octet-stream' },
        body: blob,
        signal: AbortSignal.timeout(30000), // a hung proxy must never hang a turn
      });
      if (!r.ok) return null;
      const data = await r.json();
      return data.status === 'ok' && data.transcript ? data.transcript : null;
    } catch { return null; }
  }
  stop() { try { this.recorder && this.recorder.state !== 'inactive' && this.recorder.stop(); } catch { /* noop */ } }
}
