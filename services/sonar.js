// sonar.js — haptic sonar (spec Section 16: core, not ornament).
//
// The question sonar answers through the skin: "which ways can I go
// from here?" It reads ONLY the exits the game has actually shown from
// this room (the adapter's known-exits list — the same list that lights
// the compass), never the game's hidden geography.
//
// Encoding, deliberately tiny enough to learn in one sitting:
//   - The sweep runs clockwise from north: N NE E SE S SW W NW, then
//     up, down, in, out.
//   - Each known exit is one pulse. A short pulse (60 ms) for the
//     eight compass points; a long pulse (180 ms) for up/down/in/out,
//     so vertical and threshold moves feel different in the hand.
//   - Pulses are separated by 90 ms of quiet; a 300 ms pause leads the
//     pattern so it never blends into the previous buzz.
//   - No known exits: one long low double-thud (two 180 ms pulses) —
//     "this room has shown you nothing yet", which is itself honest
//     information: go by voice and memory.
// The full detail still travels by voice ("Sonar" also narrates the
// exits); the vibration carries the shape of the room at a glance of
// the hand, for the moments a player cannot listen.

export const SONAR_ORDER = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest',
  'west', 'northwest', 'up', 'down', 'in', 'out'];
const LONG = new Set(['up', 'down', 'in', 'out']);

export function sonarPattern(knownDirections) {
  const known = new Set(knownDirections || []);
  const seq = SONAR_ORDER.filter((d) => known.has(d));
  if (!seq.length) return [300, 180, 120, 180];
  const pattern = [300];
  seq.forEach((d, i) => {
    if (i > 0) pattern.push(90);
    pattern.push(LONG.has(d) ? 180 : 60);
  });
  return pattern;
}

export function sonarSummary(knownDirections, namesByDir = null) {
  const known = new Set(knownDirections || []);
  const seq = SONAR_ORDER.filter((d) => known.has(d));
  if (!seq.length) return 'No exits have been shown from here yet.';
  const parts = seq.map((d) => (namesByDir && namesByDir[d] ? `${d} toward ${namesByDir[d]}` : d));
  return `Exits shown from here: ${parts.join(', ')}.`;
}
