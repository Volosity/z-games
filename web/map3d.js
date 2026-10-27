// map3d.js — the living map's 3D layer (Day 3): isometric room
// geometry projected from the adapter's map snapshots.
//
// Pure math, no DOM: the shell's renderer (web/app.js) draws what this
// module returns, and test/map3d.mjs verifies the geometry and the fog
// rules headlessly.
//
// Fog rules — the Fairness Law, unchanged from the 2D map:
//   - Only rooms the adapter has PLACED (visited rooms; the adapter
//     places nothing else) get boxes.
//   - Edges are drawn only between two placed rooms (a traversed exit).
//   - An exit the game's prose has NAMED but the player has not walked
//     appears only as a short dashed stub out of the current room,
//     labeled with the prose name. It places nothing and claims no
//     destination.

const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);
const DIRV = {
  north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
  northeast: [1, -1], northwest: [-1, -1], southeast: [1, 1], southwest: [-1, 1],
  up: [0, 0], down: [0, 0],
};

function project(x, y, z) {
  return [(x - y) * COS, (x + y) * SIN - (z || 0) * 0.92];
}

// projectMap(map, width, height) -> {
//   boxes: [{name, current, depth, top, left, right, labelAt}],
//   edges: [{x1, y1, x2, y2}],
//   stubs: [{x1, y1, x2, y2, label, labelAt}],
// }
// All coordinates are canvas pixels for a width x height canvas.
export function projectMap(map, width, height) {
  const placed = (map.rooms || []).filter((r) => r.placed);
  const byName = new Map(placed.map((r) => [r.name, r]));
  const E = 0.30;          // room footprint half-extent, grid units
  const H = 0.34;          // box height, grid units (drawn upward)
  const raw = new Map();   // name -> {cx, cy, top[], left[], right[], depth}
  const allPts = [];
  for (const r of placed) {
    const z = r.z || 0;
    const corner = (dx, dy, dz) => project(r.x + dx, r.y + dy, z + dz);
    const n = corner(0, -E, H), e = corner(E, 0, H), s = corner(0, E, H), w = corner(-E, 0, H);
    const sb = corner(0, E, 0), eb = corner(E, 0, 0), wb = corner(-E, 0, 0);
    const c = project(r.x, r.y, z + H);
    const depth = r.x + r.y - z * 0.01;
    raw.set(r.name, { name: r.name, current: r.name === map.current, depth, top: [n, e, s, w], left: [w, s, sb, wb], right: [s, e, eb, sb], cx: c[0], cy: c[1] });
    allPts.push(n, e, s, w, sb, eb, wb, [c[0], c[1] + 0.55]);
  }
  if (!allPts.length) return { boxes: [], edges: [], stubs: [] };

  // Stubs for the current room's prose-named, unwalked exits.
  const stubRaw = [];
  const cur = byName.get(map.current);
  if (cur) {
    const cTop = project(cur.x, cur.y, (cur.z || 0) + H);
    for (const [dir, name] of Object.entries(cur.exitNames || {})) {
      if (cur.exits && cur.exits[dir]) continue; // walked: a real edge
      const v = DIRV[dir];
      if (!v) continue;
      // Vertical exits stub along z, in world units, before projection.
      const end = (dir === 'up' || dir === 'down')
        ? project(cur.x, cur.y, (cur.z || 0) + H + (dir === 'up' ? 0.55 : -0.55))
        : project(cur.x + v[0] * 0.62, cur.y + v[1] * 0.62, (cur.z || 0) + H);
      stubRaw.push({ x1: cTop[0], y1: cTop[1], x2: end[0], y2: end[1], label: name });
      allPts.push(end);
    }
  }

  const xs = allPts.map((p) => p[0]), ys = allPts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 34;
  const scale = Math.min((width - pad * 2) / Math.max(maxX - minX, 0.001), (height - pad * 2) / Math.max(maxY - minY, 0.001));
  const ox = (width - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (height - (maxY - minY) * scale) / 2 - minY * scale;
  const px = ([x, y]) => ({ x: x * scale + ox, y: y * scale + oy });

  const boxes = [...raw.values()]
    .sort((a, b) => a.depth - b.depth)
    .map((b) => ({
      name: b.name, current: b.current,
      top: b.top.map(px), left: b.left.map(px), right: b.right.map(px),
      labelAt: px([b.cx, b.cy + 0.52]),
    }));
  const edges = [];
  const seenPairs = new Set();
  for (const r of placed) {
    for (const destName of Object.values(r.exits || {})) {
      const d = byName.get(destName);
      if (!d) continue;
      const pair = [r.name, destName].sort().join('|');
      if (seenPairs.has(pair)) continue; // a walked exit is one line, both ways
      seenPairs.add(pair);
      const a = px([raw.get(r.name).cx, raw.get(r.name).cy]);
      const b = px([raw.get(d.name).cx, raw.get(d.name).cy]);
      edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  }
  const stubs = stubRaw.map((s) => ({
    x1: px([s.x1, s.y1]).x, y1: px([s.x1, s.y1]).y,
    x2: px([s.x2, s.y2]).x, y2: px([s.x2, s.y2]).y,
    label: s.label, labelAt: px([s.x2, s.y2]),
  }));
  return { boxes, edges, stubs };
}
