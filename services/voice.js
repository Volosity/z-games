// voice.js — NarrationService: the game's words, spoken aloud, unaltered
// and complete (spec Sections 5 and 16: personas change HOW it sounds,
// never WHAT it says).
//
// Interface:
//   speak(segments, {onSegment}) -> Promise   segments: [{text, style}]
//   stop()                                    halt narration immediately
//   setRate(r), setPersona(p)
//
// Day 1 implementation: DeviceVoice — the device's own text-to-speech,
// which is exactly the spec's offline-degradation path (Section 8).
// MuseVoice will implement the same interface behind the key-custody
// proxy when the API wiring lands; the shell will not change.

export class DeviceVoice {
  constructor() {
    this.rate = 1.0;
    this.persona = { name: 'default', pitch: 1.0, voiceName: null };
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.current = null;
  }
  get available() { return !!this.synth; }
  setRate(r) { this.rate = Math.min(2, Math.max(0.5, r)); }
  setPersona(p) { this.persona = { ...this.persona, ...p }; }
  stop() {
    if (this.synth) this.synth.cancel();
    this.current = null;
  }
  async speak(segments, { onSegment } = {}) {
    if (!this.synth) return;
    this.stop();
    const queue = segments.filter((s) => s.text.trim().length > 0);
    for (let i = 0; i < queue.length; i++) {
      const seg = queue[i];
      if (onSegment) onSegment(i, seg);
      await this.speakOne(seg.text);
    }
    if (onSegment) onSegment(-1, null);
  }
  speakOne(text) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = this.rate * (this.persona.rateScale || 1);
      u.pitch = this.persona.pitch;
      if (this.persona.voiceName) {
        const v = this.synth.getVoices().find((x) => x.name === this.persona.voiceName);
        if (v) u.voice = v;
      }
      this.current = u;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      this.synth.speak(u);
    });
  }
}

// The API-backed narrator — checked against the real API on Day 2
// (2026-10-27), and the honest answer is that there is nothing to wire:
// the Meta Model API offers NO speech synthesis. Its model list carries
// transcription (muse-voice-transcribe-1.0) only; Meta's docs state the
// voice model "does not synthesize speech", Muse Glimmer (the TTS
// model) is a downloadable open-weight model rather than an API
// endpoint, and Muse Realtime Voice exists only inside Meta's consumer
// app. So narration out stays on DeviceVoice — the platform's own
// speech synthesis — behind this same NarrationService interface, which
// is exactly the fallback the spec names in advance (Section 8). If a
// TTS endpoint ever lands on the API, this class is where it plugs in:
// same interface, requests via the key-custody proxy, no shell change.
export class ApiVoice {
  constructor(proxyBase) { this.proxyBase = proxyBase; this.cache = new Map(); }
  get available() { return false; } // no TTS endpoint exists on the API (verified Day 2)
  async speak() { throw new Error('ApiVoice unavailable: the Meta Model API has no speech-synthesis endpoint (Day 2 check); DeviceVoice narrates'); }
  stop() {}
  setRate() {}
  setPersona() {}
}
