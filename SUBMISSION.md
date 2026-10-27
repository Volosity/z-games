# Z-Games (entered as "Galileo / Z-Games") — submission text

*Prepared for the owner's review. Nothing here has been submitted;
the submission itself is the owner's click.*

## Project name

Galileo / Z-Games

## One-liner

An accessible shell for Z-machine text adventures — playable by
voice, touch, and ear — with a from-scratch interpreter, an original
bundled game, and save files that interchange with the reference
interpreter.

## What it is

Millions of classic interactive-fiction games — the Zork lineage —
exist as Z-machine story files, and almost all of them are unplayable
if you cannot read a screen and type. Z-Games is a shell that plays
those files **untouched** and makes the whole game completable
eyes-closed and hands-free:

- The game's own words are narrated aloud, sentence by sentence, with
  the spoken sentence highlighted. Narration is never rewritten.
- Commands arrive by **voice** (Muse Voice Transcribe through a
  key-custody proxy), by tap (a locked compass, room and inventory
  chips, big Save / Restore / Undo buttons), or by typing.
- **Muse Spark** helps phrase commands — under a hard leash: it may
  only turn a player's sentence into a command the visible interface
  could itself have composed from what the game has already shown.
  It never invents an action and never answers for the game.
- A **fog map** (flat and a 3D "living map") draws only rooms the
  player has visited; exits the game's prose has named are labeled
  with that name but never become destinations before they are
  walked. A **haptic sonar** buzzes the room's exits through the
  player's hand and speaks them, names included.
- **Muse Image** discovery art illustrates each newly entered room
  once, cached, labeled as decoration — everything it shows, the
  words already said.

## What was built during the event

Everything except the one licensed component below was written from
zero during the event window (Oct 27 – Nov 4, 2026); `BUILD_LOG.md`
is the dated record:

- A clean-room **Z-machine interpreter core** in JavaScript
  (versions 3–8, focus v5), with a resumable driver and snapshot
  save/undo — no third-party interpreter code.
- **Quetzal** standard save files, proven interchangeable with
  **Frotz 2.55**: saves written by our core restore in Frotz, and
  Frotz's saves restore in our core, state-exact
  (`test/quetzal-frotz.mjs`, transcript committed).
- The accessible shell: narration with sentence highlighting, voice
  input, the leashed Spark normalizer, compass + chips, fog map,
  3D living map, object-tree "here" channel, haptic sonar.
- **The Lantern Below**, an original souls-like text RPG written for
  this event in Inform 6 — seven rooms, telegraphed combat,
  death-and-recovery — with a machine-checked acceptance walkthrough.
- A one-button **demo flow** (`demo/DEMO_SCRIPT.md`) and an offline
  recorded fallback (`demo/recorded-demo.html`).
- A full **eyes-closed acceptance test**: the game played start to
  victory (plus a save/restore session in the second game) by spoken
  synthetic speech → real API transcription → the shell's real
  normalizer chain → the game, gated only on what was heard back —
  59 checks, transcript committed.

## Licensed component (not our work)

**Figaro** by Victor Gijsbers — a Z-machine game bundled, unmodified,
as the shell's starter game under **GPL v3** (full license and source
in `games/figaro/`; see `CREDITS.md`). It is a separate work the
shell plays as data; it is never presented as the entrant's own work.

## Honest limits

- The Meta Model API offers no speech synthesis: narration out is the
  device/browser voice behind the same service interface, labeled as
  device voice in the product. Voice **in** is the API.
- Figaro keeps its object names outside the Z object-name field, so
  the object-tree "here" channel honestly reports nothing for it
  (it works for The Lantern Below) — never guessed from prose.

## How to run

```sh
node server/proxy.mjs   # http://localhost:8377/
```

Press **▶ Run the demo**, or pick a game and play. Tests:
`node test/headless.mjs`, `test/quetzal-frotz.mjs`,
`test/eyes-closed.mjs`, and six more suites in `test/` — all green on
the final build; every API call is costed in `docs/API_LEDGER.md`.
