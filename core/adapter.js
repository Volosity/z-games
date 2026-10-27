// adapter.js — the single channel between the shell and the interpreter
// core (spec Section 10). Nothing outside this file knows which core runs
// underneath. After every turn it hands the interface a structured picture
// of the turn, derived only from what the game itself printed and reported
// (the Fairness Law, spec Section 9): the room name from the game's own
// status line, the score and moves the game reports, exits the shell has
// seen traversed or named, and the rooms the player has visited.

import { ZMachine } from './zmachine.js';
import { extractStoryFile } from './blorb.js';

const DIRECTIONS = {
  north: [0, -1, 0], south: [0, 1, 0], east: [1, 0, 0], west: [-1, 0, 0],
  northeast: [1, -1, 0], northwest: [-1, -1, 0], southeast: [1, 1, 0], southwest: [-1, 1, 0],
  up: [0, 0, 1], down: [0, 0, -1],
};
const OPPOSITE = {
  north: 'south', south: 'north', east: 'west', west: 'east',
  northeast: 'southwest', southwest: 'northeast', northwest: 'southeast', southeast: 'northwest',
  up: 'down', down: 'up', in: 'out', out: 'in',
};
const DIR_WORDS = new Set([...Object.keys(DIRECTIONS), 'in', 'out',
  'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'u', 'd', 'enter', 'exit', 'leave']);
const EXPAND = { n: 'north', s: 'south', e: 'east', w: 'west', ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest', u: 'up', d: 'down', enter: 'in', exit: 'out', leave: 'out' };
const MOVE_FILLER = new Set(['go', 'walk', 'head', 'run', 'move', 'proceed', 'travel', 'toward', 'towards', 'to', 'the', 'into', 'onto']);

export class GameAdapter {
  constructor({ onSave, onRestore } = {}) {
    this.saveHook = onSave || (() => false);
    this.restoreHook = onRestore || (() => null);
    this.vm = null;
    this.gameId = 'none';
    this.rooms = new Map();   // roomName -> {name, x, y, z, exits: Map(dir->roomName)}
    this.exitNames = new Map(); // roomName -> Map(dir -> name the game's prose
    // gives that exit, e.g. "Sunken Steps" or "iron door"). A name is NOT a
    // destination: destinations are recorded only by traversal (recordEdge).
    this.currentRoom = null;
    this.score = null;
    this.moves = null;
    this.started = false;
  }

  load(bytes, gameId = 'game') {
    const story = extractStoryFile(bytes);
    this.gameId = gameId;
    this.vm = new ZMachine(story, {
      onSave: (snap) => this.saveHook(this.gameId, snap),
      onRestore: () => this.restoreHook(this.gameId),
    });
    this.rooms = new Map();
    this.exitNames = new Map();
    this.currentRoom = null;
    this.score = null;
    this.moves = null;
    this.started = true;
    return this.runTurn(null); // opening turn: banner + first room
  }

  // Send one command (or null for the opening run). Returns the turn:
  // { text, runs, room, score, moves, need, map }
  runTurn(command) {
    if (!this.vm) throw new Error('No game loaded');
    const beforeRoom = this.currentRoom;
    let result;
    if (command !== null && command !== undefined) {
      this.vm.provideInput(command);
    }
    result = this.vm.run();
    const runs = this.vm.flushMainText();
    const text = runs.map((r) => r.text).join('');
    this.readStatusLine();
    const afterRoom = this.currentRoom;
    if (command && beforeRoom && afterRoom && beforeRoom !== afterRoom) {
      const dir = firstDirectionWord(command);
      if (dir) this.recordEdge(beforeRoom, dir, afterRoom);
    }
    this.ensureRoom(afterRoom);
    if (text) this.noteExitNames(text);
    return {
      text, runs,
      room: this.currentRoom,
      score: this.score, moves: this.moves,
      need: result.need,
      map: this.mapSnapshot(),
      affordances: this.affordances(),
      // Object-tree state channel (Day 2): the current room's contents
      // by the game's own object names, or null when the room object
      // cannot be identified — never guessed from prose.
      objects: this.roomContents(),
    };
  }

  roomContents() {
    try {
      if (!this.vm || !this.currentRoom) return null;
      const roomObj = this.vm.roomObjectByName(this.currentRoom);
      if (!roomObj) return null;
      return this.vm.objectChildren(roomObj);
    } catch { return null; }
  }

  readStatusLine() {
    const rawLine = this.vm.statusText().split('\n')[0] || '';
    if (!rawLine.trim()) return;
    // Inform library format: "Room   Score: 0   Moves: 12".
    const im = rawLine.match(/^(.*?)\s+Score:\s*(-?\d+)\s+Moves:\s*(\d+)\s*$/i);
    if (im) {
      this.currentRoom = im[1].trim();
      this.score = Number(im[2]);
      this.moves = Number(im[3]);
      return;
    }
    // Inform library time format: "Room   Time: 9:15 pm" (some games /
    // interpreter states render the clock instead of score/moves).
    const tm = rawLine.match(/^(.*?)\s{2,}Time:.*$/i);
    if (tm) {
      this.currentRoom = tm[1].trim();
      return;
    }
    // Right-hand fields are separated from the room name by a wide gap.
    // Formats seen in the wild: "Room   12 / 34" (score/moves) and
    // "Room   5" (moves only, for games without a score).
    const m = rawLine.match(/^(.*?)\s{2,}(-?\d+)(?:\s*\/\s*(\d+))?\s*$/);
    if (m) {
      this.currentRoom = m[1].trim();
      if (m[3] !== undefined) { this.score = Number(m[2]); this.moves = Number(m[3]); }
      else { this.moves = Number(m[2]); }
    } else {
      const clean = rawLine.replace(/\s+/g, ' ').trim();
      // Refuse to adopt a line ending in a bare number as a room name:
      // that is a number format we did not parse, not a place, and
      // adopting it would mint phantom rooms keyed by the counter.
      if (clean.length <= 80 && !/\s\d+$/.test(clean)) this.currentRoom = clean;
    }
  }

  ensureRoom(name) {
    if (!name) return null;
    if (!this.rooms.has(name)) {
      this.rooms.set(name, { name, x: 0, y: 0, z: 0, placed: false, exits: new Map() });
      const r = this.rooms.get(name);
      if (this.rooms.size === 1) { r.placed = true; }
    }
    return this.rooms.get(name);
  }
  recordEdge(fromName, dir, toName) {
    const from = this.ensureRoom(fromName);
    const to = this.ensureRoom(toName);
    if (!from || !to) return;
    from.exits.set(dir, toName);
    const back = OPPOSITE[dir];
    if (back && !to.exits.has(back)) to.exits.set(back, fromName);
    const v = DIRECTIONS[dir];
    if (v && from.placed && !to.placed) {
      to.x = from.x + v[0]; to.y = from.y + v[1]; to.z = from.z + v[2];
      to.placed = true;
    } else if (!v && from.placed && !to.placed) {
      // in/out have no compass vector: the destination shares the
      // footprint of the room it is inside/outside of.
      to.x = from.x; to.y = from.y; to.z = from.z;
      to.placed = true;
    }
  }
  exitsHere() {
    const r = this.currentRoom ? this.rooms.get(this.currentRoom) : null;
    return r ? [...r.exits.keys()] : [];
  }
  // Named exits (Day 3): the game's prose often names where a way leads
  // before the player has been there — "The Flooded Stacks lie north",
  // "a Dusty Gallery opens east", "Passages climb north toward the
  // Sunken Steps", "The pipes run north, toward the iron door." The
  // name is learned as a NAME only: the compass may label the exit with
  // it and the sonar may speak it, but it never becomes a destination
  // and never places a room on the map — the Fairness Law is untouched.
  // Two conservative shapes, both anchored on a real direction word:
  //   A. <article> <Capitalized Name> <journey verb> <direction>
  //   B. <direction> [,] toward(s) the <name words>
  noteExitNames(text) {
    if (!this.currentRoom) return;
    let byDir = this.exitNames.get(this.currentRoom);
    if (!byDir) { byDir = new Map(); this.exitNames.set(this.currentRoom, byDir); }
    const dira = '(north|south|east|west|northeast|northwest|southeast|southwest|up|down)';
    const verb = '(?:lies|lie|leads|lead|climbs|climb|descends|descend|ascends|ascend|runs|run|stretches|stretch|opens|open|continues|continue)';
    const reA = new RegExp(`(?:The|the|A|a|An|an)\\s+([A-Z][\\w'’-]*(?:\\s+(?:of|the|and|de|von)\\s+[\\w'’-]+|\\s+[A-Z][\\w'’-]*)*)\\s+${verb}\\s+${dira}\\b`, 'g');
    const reB = new RegExp(`\\b${dira}(?:\\s*,\\s*|\\s+)towards?\\s+the\\s+([\\w'’-]+(?:\\s+[\\w'’-]+){0,3})`, 'g');
    for (const m of text.matchAll(reA)) {
      const name = m[1].replace(/\s+/g, ' ').trim();
      if (name) byDir.set(m[2], name);
    }
    for (const m of text.matchAll(reB)) {
      const name = m[2].replace(/\s+/g, ' ').trim();
      if (name) byDir.set(m[1], name);
    }
  }
  exitNamesHere() {
    const byDir = this.currentRoom ? this.exitNames.get(this.currentRoom) : null;
    return byDir ? Object.fromEntries(byDir) : {};
  }
  // What the shell may honestly offer right now. Two different lists,
  // kept distinct: `directions` = exits the game has actually shown from
  // this room (these light the compass and may be NAMED as known);
  // `allDirections` = the compass's standing buttons, which the visible
  // interface always offers — Spark may choose one of those as a command
  // (the game remains the only judge of whether it works), but neither
  // list ever claims a destination the player has not reached.
  affordances() {
    const names = this.exitNamesHere();
    return {
      room: this.currentRoom,
      directions: this.exitsHere(),
      allDirections: Object.keys({ ...DIRECTIONS, in: 1, out: 1 }),
      // Exits the game's prose has named from here (Day 3): the compass
      // labels them and the sonar speaks them; `directions` above stays
      // traversal-only, and a name here is never a destination claim.
      exitNamesHere: names,
      namedDirections: Object.keys(names),
    };
  }
  mapSnapshot() {
    return {
      current: this.currentRoom,
      rooms: [...this.rooms.values()].map((r) => ({
        name: r.name, x: r.x, y: r.y, z: r.z, placed: r.placed,
        exits: Object.fromEntries(r.exits),
        exitNames: Object.fromEntries(this.exitNames.get(r.name) || []),
      })),
    };
  }
}

function firstDirectionWord(command) {
  const words = String(command).toLowerCase().trim().split(/\s+/);
  for (const w of words) {
    if (DIR_WORDS.has(w)) return EXPAND[w] || w;
    if (MOVE_FILLER.has(w)) continue;
    break;
  }
  return null;
}
