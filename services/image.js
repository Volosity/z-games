// image.js — DiscoveryArt: on first visit, a room receives a small
// generated artwork built from the room's own printed description, under
// a per-zone style prompt (spec Section 6). Decoration only: it shows
// what the text already said and never carries new information (Fairness
// Law, Section 9). Art is generated once per place and cached on the
// device forever — never re-billed, never re-rolled.
//
// Day 1: QueueingArt records discovery requests and serves a labelled
// placeholder; the Muse Image implementation behind the proxy fills the
// same interface. If the API is unreachable, art is skipped and queued —
// exactly the degradation the spec states in advance (Section 8).

export class QueueingArt {
  constructor() {
    this.cache = new Map();  // roomName -> {status:'queued'|'ready', url?}
    this.queue = [];
  }
  // Returns {status, url} for a room; requests generation if first sight.
  forRoom(roomName, descriptionText) {
    if (!roomName) return { status: 'none' };
    if (!this.cache.has(roomName)) {
      this.cache.set(roomName, { status: 'queued' });
      this.queue.push({ roomName, descriptionText });
    }
    return this.cache.get(roomName);
  }
  pending() { return [...this.queue]; }
}

// Day 2: ApiArt — Muse Image (muse-image-1.0) behind the key-custody
// proxy, same interface as QueueingArt. First sight of a room asks the
// proxy to generate; the proxy generates ONCE and caches the image on
// disk forever, so a room is billed at most once, ever. This client also
// remembers room -> url in localStorage (the device-side cache). The
// art is ornament tier: it illustrates the room's own printed words and
// carries no information the text did not already give (Fairness Law).
export class ApiArt {
  constructor(proxyBase = '', gameId = 'game') {
    this.proxyBase = proxyBase;
    this.gameId = gameId;
    this.cache = new Map();   // roomName -> {status, url?}
    this.storeKey = `zgames.art.${gameId}`;
    try {
      const saved = JSON.parse(localStorage.getItem(this.storeKey) || '{}');
      for (const [room, url] of Object.entries(saved)) this.cache.set(room, { status: 'ready', url });
    } catch { /* no device cache yet */ }
  }
  forRoom(roomName, descriptionText) {
    if (!roomName) return { status: 'none' };
    const hit = this.cache.get(roomName);
    if (hit) return hit;
    const entry = { status: 'queued' };
    this.cache.set(roomName, entry);
    this.request(roomName, descriptionText).then((url) => {
      if (url) {
        entry.status = 'ready'; entry.url = url;
        try {
          const saved = JSON.parse(localStorage.getItem(this.storeKey) || '{}');
          saved[roomName] = url;
          localStorage.setItem(this.storeKey, JSON.stringify(saved));
        } catch { /* cache is a courtesy, not a dependency */ }
      } else {
        entry.status = 'unavailable';
      }
    }).catch(() => { entry.status = 'unavailable'; });
    return entry;
  }
  async request(roomName, descriptionText) {
    try {
      const r = await fetch(`${this.proxyBase}/api/art/for-room`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: this.gameId, room: roomName, description: descriptionText }),
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) return null;
      const data = await r.json();
      return data.status === 'ready' ? data.url : null;
    } catch { return null; }
  }
  pending() { return []; }
}
