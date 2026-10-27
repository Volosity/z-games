// demo-script.js — the continuous demo flow (Day 3): one Lantern Below
// arc, every command proven against the game's acceptance walkthrough,
// each beat captioned for the audience. Pure data: the shell's demo
// driver (web/demo.js) performs it, and test/demo-rehearsal.mjs plays
// the same commands headlessly and gates them, so the flow judges see
// is the flow that was rehearsed.
//
// The arc: explore -> a telegraphed fight -> loot -> rest -> SAVE ->
// a second, harder fight -> RESTORE (the rewind beat) -> close.
export const DEMO_STEPS = [
  { cmd: null, waitMs: 6000, caption: 'Z-Games: classic text adventures, playable with your eyes closed. Every word spoken is the game\'s own text — nothing is rewritten, nothing is invented.' },
  { cmd: 'look', caption: 'The opening room. Watch the compass: the way north is already labeled with the name the game\'s own prose gives it — "Sunken Steps" — and the living map shows it as a dashed stub. Shown, named, not yet walked: the map never claims a place you have not been.' },
  { cmd: 'status', caption: 'The Wayfarer\'s state, in the game\'s own words: health, stamina, Glimmer — the souls-like currency this game spends on strength and loses on death.' },
  { cmd: 'north', caption: 'First contact: the Archive Thrall rakes on arrival. Combat here is telegraphed — big attacks announce themselves a turn early, and the game expects you to answer.' },
  { cmd: 'strike', caption: 'Strike.' },
  { cmd: 'evade', caption: 'Evade — the Thrall\'s heavy blow is coming.' },
  { cmd: 'heavy strike', caption: 'And punish the recovery. That rhythm — strike, evade, punish — is the whole combat language, and every word of it works by voice alone.' },
  { cmd: 'east', caption: 'The Dusty Gallery. Its exits were named in the previous room\'s prose; the compass labeled them before we ever walked here.' },
  { cmd: 'search crack', caption: 'Searching the crack the room description mentioned…' },
  { cmd: 'take glimmer', caption: 'Loot: the cache pays out in Glimmer — this game\'s currency of strength.' },
  { cmd: 'status', caption: 'And STATUS shows the take: Glimmer banked. It is spent at lanterns to grow stronger — and dropped where you fall, to be recovered or lost. Everything on this screen is also a button, a voice command, or a compass tap — three ways in, one game.' },
  { cmd: 'west', caption: 'Back west.' },
  { cmd: 'south', caption: 'And south, to the lantern.' },
  { cmd: 'rest', caption: 'Resting at a lantern heals — and, souls-like, resets the lesser enemies. It is also where the world remembers you.' },
  { cmd: 'save', caption: 'Save — into a standard Quetzal file, the 1990s format Infocom designed. This exact file also loads in Frotz, the reference interpreter; that cross-proof is in the test suite, not just claimed.' },
  { cmd: 'north', caption: 'North again — the Thrall is back, as promised. We walk past the fight this time.' },
  { cmd: 'north', caption: 'The Flooded Stacks, and the Rusted Sentinel: slower, heavier, same honest telegraphs.' },
  { cmd: 'attack sentinel', caption: 'Engage the Sentinel.' },
  { cmd: 'strike', caption: 'Strike.' },
  { cmd: 'guard', caption: 'Guard — its slam is telegraphed for next turn.' },
  { cmd: 'heavy strike', caption: 'Punish.' },
  { cmd: 'restore', caption: 'Now the rewind: restore. We are back at the lantern rest — the Stacks, the Sentinel, all of it unwound, from that same standard save file.' },
  { cmd: 'look', waitMs: 9000, caption: 'That is Z-Games: a from-scratch interpreter, a voice both ways, a map that only shows what you have earned — and a game we wrote for this event, played start to finish with eyes closed in the acceptance test. Thank you.' },
];
