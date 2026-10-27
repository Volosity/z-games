// spark.js — SparkNormalizer: Muse Spark's ONE job in this product
// (spec Section 8). When a spoken or typed sentence does not match the
// game's grammar directly, Spark may normalize it into a command the
// visible interface itself could have composed. It chooses ONLY among
// the affordances the shell is already showing. It never invents an
// action, never supplies a word the game has not put in front of the
// player, and never answers for the game.
//
// Interface:
//   normalize(sentence, affordances) -> Promise<{command, via} | null>
//     affordances: { room, directions: [...known exits...], allDirections }
//     via: 'direction' | 'verb' | 'spark' | 'verbatim'
//
// Day 1 implementation: LocalStubNormalizer — deterministic, offline,
// affordance-constrained. It handles the mechanical cases (direction
// phrases like "head toward the north", single standing verbs). Anything
// it cannot map honestly returns null, and the caller sends the sentence
// verbatim (typed play is never blocked by the normalizer). The API-backed
// SparkNormalizer will implement this same interface behind the proxy and
// take over the fuzzy cases; the leash below is the contract it must keep.

const DIRECTION_PHRASES = [
  [/\bnorth\b/, 'north'], [/\bsouth\b/, 'south'], [/\beast\b/, 'east'], [/\bwest\b/, 'west'],
  [/\bnortheast\b/, 'northeast'], [/\bnorthwest\b/, 'northwest'],
  [/\bsoutheast\b/, 'southeast'], [/\bsouthwest\b/, 'southwest'],
  [/\bup\b/, 'up'], [/\bdown\b/, 'down'], [/\benter\b/, 'in'], [/\b(?:exit|leave|outside)\b/, 'out'],
];
const NEGATION = /\b(don't|do not|never|not|no)\b/;
// Sentences starting with these verbs are about objects, not travel:
// "look up", "picking up", "sit down" must never become directions.
const NON_MOVE_START = /^(look|examine|x|pick|take|get|drop|put|sit|lie|stand|read|open|close|eat|drink|attack|hit|kick|push|pull)(s|es|ing|ed|d)?\b/;
const VERB_ALIASES = new Map([
  ['look around', 'look'], ['look', 'look'], ['l', 'look'],
  ['inventory', 'inventory'], ['what am i carrying', 'inventory'], ['i', 'inventory'],
  ['wait', 'wait'], ['z', 'wait'], ['help', 'help'], ['score', 'score'],
  // Recognizers hear the verb "strengthen" as the phrase "strength
  // and" — a general speech artifact, found by the Day-2 eyes-closed
  // run; the repair is a whole-phrase alias like the others here.
  ['strength and health', 'strengthen health'],
  ['strength and stamina', 'strengthen stamina'],
]);

export class LocalStubNormalizer {
  async normalize(sentence, affordances) {
    const s = String(sentence || '').trim().toLowerCase().replace(/[.!?,;]+$/, '');
    if (!s) return null;
    if (NEGATION.test(s)) return null; // never invert a player's "don't"
    if (VERB_ALIASES.has(s)) return { command: VERB_ALIASES.get(s), via: 'verb' };
    // Directions: only when the phrase is essentially just the direction
    // (plus a movement verb). A direction buried in a longer sentence is
    // the real Spark's job, not the stub's — honesty over cleverness.
    // Directions offered here are the compass's standing directions —
    // buttons the interface itself shows — never claimed exits.
    const wordCount = s.split(/\s+/).length;
    if (wordCount <= 4 && !NON_MOVE_START.test(s)) {
      // Earliest direction mentioned wins ("south then north" is south).
      let best = null;
      for (const [re, dir] of DIRECTION_PHRASES) {
        if (affordances && Array.isArray(affordances.allDirections)
            && !affordances.allDirections.includes(dir)) continue;
        const idx = s.search(re);
        if (idx >= 0 && (best === null || idx < best.idx)) best = { idx, dir };
      }
      if (best) return { command: best.dir, via: 'direction' };
    }
    return null;
  }
}

// API-backed Spark behind the key-custody proxy (live since Day 1,
// 2026-10-27). The app knows only the proxy; the proxy calls Muse Spark
// through the registered connector helper, where the credential lives.
// The prompt enumerates exactly the affordances passed in; the model
// picks from the list or declines. This client ALSO validates the
// returned command against the affordances before accepting it — the
// leash is enforced on both sides of the wire.
// One shared standing-verb list for both normalizers (the stub's aliases
// and the API client's allow-list must never drift apart).
const STANDING = new Set(['look', 'inventory', 'wait', 'help', 'score', 'status',
  'rest', 'repeat', 'save', 'restore', 'undo']);
export class ApiSparkNormalizer {
  constructor(proxyBase = '') { this.proxyBase = proxyBase; }
  async normalize(sentence, affordances) {
    try {
      const r = await fetch(`${this.proxyBase}/api/spark/normalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sentence, affordances }),
        signal: AbortSignal.timeout(20000), // a hung proxy must never hang a turn
      });
      if (!r.ok) return null;
      const data = await r.json();
      if (data.status !== 'ok' || !data.command) return null;
      const cmd = String(data.command).trim().toLowerCase();
      const allowed = new Set([...(affordances.allDirections || []),
        ...(affordances.directions || []), ...STANDING]);
      if (!allowed.has(cmd)) return null; // leash: refuse anything outside
      return { command: cmd, via: 'spark' };
    } catch {
      return null; // network/proxy down — caller falls back, play never blocks
    }
  }
}
