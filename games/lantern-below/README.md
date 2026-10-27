# The Lantern Below

**An original game, written for this entry during the event** (Oct 27,
2026) — not a licensed component. Figaro, elsewhere in this repo, is
the licensed starter; this one is ours.

A souls-like text RPG in the dark of Veyra, the archive-city that filed
its own light away. You are a Wayfarer who reawakens at lanterns.
Reach the Bell Archive, recover the Lantern Core, defeat the Bell
Warden.

## Play it

- In the shell: `node server/proxy.mjs` from the repo root, open the
  page, choose **The Lantern Below (showcase)**.
- In any Z-machine interpreter (Frotz and friends): open
  `lantern-below.z5`.

## The loop

Explore → fight (STRIKE / HEAVY STRIKE / GUARD / EVADE against enemies
whose heavy blows are telegraphed a round ahead, with punish windows
after) → earn Glimmer → REST at a Lantern (heals, resets the dark,
sells STRENGTHEN) → die, drop your Glimmer where you fell, respawn at
the last Lantern, fight back to it — or lose it forever. Seven rooms, a
lever-locked iron door, a one-way-until-opened shortcut, two enemies
and the Bell Warden (two telegraphs; below half health, a tolling
phase whose hits drain your stamina too). STATUS always reads HP,
Stamina, Glimmer, and your last Lantern. Combat is deterministic:
patterns can be learned exactly.

## Build & test

```sh
INFORM6=/path/to/inform6 INFORM6_LIB=/path/to/inform6/std sh build.sh
DFROTZ=/path/to/dfrotz python3 playtest.py   # writes playtest-transcript.txt
```

- `lantern.inf` — the complete Inform 6 source (engine + world).
- `walkthrough.txt` — the scripted acceptance run: the whole loop.
- `playtest.py` — drives dfrotz through the walkthrough.
- `playtest-transcript.txt` — the recorded passing run (56 turns,
  ending "*** You have won ***"). This transcript is the acceptance
  evidence: a game its own tester cannot finish does not ship.
- The same walkthrough also passes through the shell's own core:
  `node test/lantern-headless.mjs` from the repo root.
