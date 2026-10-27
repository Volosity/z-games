# Z-Games — Demo Script (run of show)

**The one-line pitch:** Z-Games is an accessible shell for Z-machine
text adventures — bring your own story files, or play the two bundled
games — fully playable by voice, by touch, and by ear, on a
from-scratch interpreter, with a save format that is interchangeable
with the reference interpreter.

**Time:** ~5 minutes live (3.5 of flow, plus the eyes-closed stretch).
**Fallback:** if the venue network fails, open
`demo/recorded-demo.html` (self-contained, offline) — it replays the
final acceptance run with the same captions story. The live flow needs
no network at all once the page is loaded, except the optional API
voice/Spark layer; the shell degrades to the device voice and the
local normalizer on its own.

## Setup (before the audience arrives)

1. `node server/proxy.mjs` in the repo root; open the page it serves.
2. Click **The Lantern Below (showcase)** once to confirm it boots;
   then leave **Figaro** up — the demo button boots Lantern itself.
3. Narration **on**, speed 1.0. If a projector is used, Large type on.

## The live flow — press "▶ Run the demo"

The demo plays itself through the product's real command path; the
caption bar narrates the beats. What to point at, as it runs:

| Beat | Point at |
|---|---|
| Opening room | The compass: north is pre-labeled **Sunken Steps** — a name from the game's own prose. The 3D living map shows it as a dashed stub: shown, named, not yet walked. |
| Status | HP / Stamina / Glimmer — the souls-like stats of our own game, spoken verbatim. |
| The Thrall fight | Telegraphs: big attacks announce a turn early. Strike → Evade → Heavy Strike (punish). This is a real combat system, played by ear. |
| Dusty Gallery | The gallery's exits were named in the *previous* room's prose. Search the crack, take the Glimmer cache. |
| Rest | Lantern rest: heals, respawns lesser enemies — the bonfire rule. |
| Save | A standard **Quetzal** file. The same file loads in Frotz 2.55 — proven both directions in `test/quetzal-frotz.mjs`, transcript committed. |
| The Sentinel | A heavier fight in the Flooded Stacks. |
| Restore | The rewind: back at the lantern, the whole Stacks excursion unwound from that save file. |
| Close | Invite the room: the game is live and theirs now. |

## The eyes-closed stretch (2 minutes, presenter-led)

1. Ask for a volunteer; blindfold or eyes closed, phone in hand.
2. They hold the phone and say **"Sonar"** (tap the Sonar button):
   the phone buzzes the room's exits through the hand, then speaks
   them — with the prose names.
3. They play three turns by voice alone ("north", "strike",
   "evade"). Every answer they hear is the game's own text.
4. Point: this exact loop — spoken synthetic speech in, real
   recognition, the real game — is an automated acceptance test
   (`test/eyes-closed.mjs`, 59 checks on the final build), not a
   stunt we rehearsed once.

## Lines that must stay true

- Figaro is a **licensed component** (GPL v3, by Victor Gijsbers),
  never "our game". **The Lantern Below** is ours, written in-event.
- The interpreter core, shell, and tests were **built during the
  event**; the kickoff packet and BUILD_LOG mark in-event work.
- Muse Spark is leashed to rephrasing a player's sentence into a
  command the interface itself could have composed — it cannot
  invent moves. Voice transcription is Muse Voice Transcribe;
  narration is the device voice (the API has no speech synthesis —
  we say so rather than fake it).
- The map shows only visited rooms; named exits are labels, never
  destinations.
