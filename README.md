# Galileo / Z-Games

An accessible shell for Z-machine games — the interactive fiction of the
Zork era — rebuilt for players the original interfaces left out.

Bring your own story files (`.z3`, `.z5`, `.z8`, `.zblorb`); they are
played **untouched**. One game is bundled as a starter: **Figaro** by
Victor Gijsbers (GPL v3), identified in `CREDITS.md` and
`games/figaro/NOTICE.md` as a licensed component — it is not our work.

The whole game is completable eyes-closed and hands-free: the game's own
words are narrated aloud with the spoken sentence highlighted, commands
arrive by voice, tap, or type, a locked compass and room chips answer
"where am I, what am I carrying, where can I go" without reading a
paragraph, and a fog map draws only the rooms you have actually visited.

## Built during the event

Everything in this repository except the bundled Figaro component was
written from zero during the **Meta Global AI Developer Hackathon,
October 27 – November 4, 2026**. `BUILD_LOG.md` is the dated record of
what was built each day, what is real and what is stubbed, and the known
defects. The demo shows only in-event work.

## Run it

```sh
node server/proxy.mjs        # http://localhost:8377/
```

Open the page, and Figaro loads and starts talking. Type or speak a
command (`peek through keyhole`, `look`, `wait`), tap the compass, save
and restore with the big buttons. To play a different game, use
**Open a game file**.

**The demo:** press **▶ Run the demo** — the shell fresh-boots The
Lantern Below and plays the rehearsed arc by itself (explore, a
telegraphed fight, loot, rest, save, a harder fight, restore) with
captions. The run of show is `demo/DEMO_SCRIPT.md`; if a venue has no
network, `demo/recorded-demo.html` replays the acceptance transcript
offline. The demo flow is gated headlessly by
`test/demo-rehearsal.mjs`.

**Tests** (all headless, all green on the final build):

```sh
node test/headless.mjs          # Figaro boots, plays, saves, restores
node test/lantern-headless.mjs  # the showcase game end-to-end on our core
node test/quetzal.mjs           # Quetzal saves, spec-parsed independently
node test/quetzal-frotz.mjs     # saves interchange with Frotz 2.55 (needs dfrotz)
node test/undo.mjs              # UNDO fidelity + the status-line header fix
node test/named-exits.mjs       # exits named by the game's prose
node test/map3d.mjs             # the 3D living map's projection + fog rules
node test/sonar-objects.mjs     # object-tree channel + haptic sonar
node test/demo-rehearsal.mjs    # the demo arc, gated beat by beat
node test/eyes-closed.mjs       # the full voice-only acceptance (API, minutes)
```

## Architecture

```
core/       The interpreter core and its one adapter (spec: adapter pattern)
  blorb.js      Blorb container parsing (Exec/ZCOD chunk extraction)
  zmachine.js   A clean-room Z-machine (v3–v8 focus: v5), resumable
                run/provideInput driver, snapshot save/undo hooks
  adapter.js    The single channel to the shell: per-turn text + the
                game's own room / score / moves, learned exits, exits
                named by the game's prose, fog map, object-tree channel
services/   The API-backed polish layer, behind interfaces
  voice.js      NarrationService — device voice (the API offers no TTS;
                narration stays behind this one interface)
  speech.js     SpeechInput — Muse Voice Transcribe via the API when
                configured; device recognizer as fallback
  spark.js      SparkNormalizer — Spark's ONE job (see the leash below)
  image.js      DiscoveryArt — Muse Image via the API, generated once
                per room and cached; queueing placeholder offline
web/        The shell: transcript + narration highlight, locked compass,
            HERE / CARRYING chips, SAY-IT drawer with your own saved
            sentences, big Save / Restore / Undo, fog-map canvas
  map3d.js      The living map: pure isometric projection of the fog
                snapshot (visited rooms as boxes, traversed edges,
                prose-named exits as labeled stubs) — tested headlessly
  demo.js       The demo driver: plays demo-script.js through the real
  demo-script.js  command path, paced by the narration, captioned
server/     proxy.mjs — static dev server + the key-custody proxy
tools/      api-review.mjs — build-time API inspection passes (see below)
            build-recorded-demo.mjs — the offline fallback demo page
demo/       DEMO_SCRIPT.md (run of show) + recorded-demo.html (offline)
docs/       API_LEDGER.md — every API call, costed
```

## The API layer, and its leash

The product is designed so the Meta Model API does the language heavy
lifting — narration quality (Muse Voice), speech transcription, and
discovery art (Muse Image) — behind the service interfaces above, with
the API key held only by `server/proxy.mjs`. The app never sees a key.

**Spark's leash (a design law, not a guideline):** Muse Spark's only
job in this product is *affordance normalization* — turning "head toward
the north" into `north`. It may choose **only** among commands the
visible interface could itself compose from what the game has already
shown the player. It never invents an action, never supplies a word the
game has not put in front of the player, and never answers for the game.
The game's reply is the only verdict. Offline, Spark is simply absent
and typed/tapped play is untouched.

**Build-time API use is separate from the product's runtime surface.**
`tools/api-review.mjs` runs API inspection/review passes over this
repo's own code during development. Every call — build-time or runtime —
is recorded in `docs/API_LEDGER.md` with its cost.

**API status: LIVE.** The owner's key is connected through the
registered connector (Standard tier only). Spark normalization runs for
real through the proxy — leashed, validated on both sides of the wire —
and Spark also runs build-time inspection passes over this repo's code
(see BUILD_LOG). Muse Voice **input** (transcription) runs through the
proxy — the API offers no speech synthesis, so narration out stays on
the device voice behind the same interface. Muse Image discovery art
is generate-once, disk-cached per room. The eyes-closed acceptance —
a full Lantern Below victory plus a Figaro save/restore session played
with no screen, voice only — is in `test/eyes-closed-transcript.txt`.
Final tally: ≈ $1.89 estimated of the $150 in free credits (build
envelope ~$1.57 of ~$80; demo reserve ~$0.33 of ~$70; see
`docs/API_LEDGER.md` for every call).
Offline, everything degrades to the local paths and play never waits
on the API.

**Day 3 closed the interchange proof.** Quetzal saves written by this
core restore inside **Frotz 2.55**, and Frotz's saves restore here —
both directions, state-exact, in `test/quetzal-frotz.mjs` (transcript
committed). Getting there fixed real format bugs the single-
interpreter tests could not see (see BUILD_LOG). The same pass fixed
UNDO (it silently fell through to the parser) and a header byte that
made score-line games draw a clock instead of Score/Moves.

## The showcase game

**The Lantern Below** (`games/lantern-below/`) is an original
souls-like text RPG written for this entry during the event — Inform 6
source, a compiled `.z5`, and a recorded 56-turn acceptance playtest
under dfrotz that finishes the whole loop (fight, die, drop, recover,
boss, victory). The shell loads it beside Figaro from the header
buttons.

## The Fairness Law

The shell exposes only what the game already put in front of the player:
no hints, no destination spoilers before a room is visited, no
puzzle-state readouts. The score shown is the game's own. The fog map
contains visited rooms only — an unvisited room is absent, not dimmed.
An exit the game's prose has *named* ("The Flooded Stacks lie north")
may be labeled with that name on the compass, the sonar, and the 3D
map's dashed stubs — a name is never a destination: destinations are
earned by walking, and only walking places a room.

## Licenses

- This project's own code: **MIT** (see `LICENSE`).
- Bundled starter game **Figaro**: **GPL v3**, © Victor Gijsbers,
  unmodified, source included in `games/figaro/`. See `CREDITS.md`.
