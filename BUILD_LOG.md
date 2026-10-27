# BUILD LOG — Galileo / Z-Games

All work below was built during the event (Oct 27 – Nov 4, 2026), from
zero. Each day records: what landed, what is real vs stubbed, defects
found and fixed, and the API ledger tally for the day.

---

## Day 1 — Tuesday, October 27, 2026

**Theme: one bulletproof live flow.** The bundled game loads, plays
(text in/out), narrates, and accepts commands by type, tap, and voice.

### Landed

- **Interpreter core** (`core/zmachine.js`, ~900 lines): a clean-room
  Z-machine in dependency-free JavaScript, shared by browser and Node.
  Header/memory/variables, Z-text with abbreviations and ZSCII, output
  streams 1–4 (stream-3 capture), an upper-window **character grid with
  cursor** (status lines are positioned, not padded), snapshot save /
  restore / undo hooks, dictionary tokenise, full object/property
  system, call frames with catch/throw, and a resumable
  `run()`/`provideInput()` driver so the shell never blocks.
  *Deviation from spec, recorded:* the spec's route was the Fizmo C
  library behind the adapter; no Emscripten/Fizmo build path exists in
  this environment, and the adapter boundary (`core/adapter.js`) is
  exactly where a Fizmo build can replace this core later without the
  shell changing. The adapter pattern held; the core behind it is ours.
- **Blorb parsing** (`core/blorb.js`): FORM/IFRS, RIdx, Exec/ZCOD
  extraction. Raw `.z3/.z5/.z8` also accepted.
- **Adapter** (`core/adapter.js`): per-turn text + runs; room / score /
  moves parsed from the game's own status line; exits learned from
  successful moves (with reverse edges); fog map of visited rooms only;
  the affordance list that bounds Spark.
- **Services behind interfaces** (`services/`): `DeviceVoice`
  (speechSynthesis narration with per-sentence highlight callbacks),
  `DeviceSpeech` (platform recognizer), `LocalStubNormalizer`
  (deterministic, affordance-constrained Spark stand-in — anything it
  cannot map honestly returns null and the sentence goes verbatim),
  `QueueingArt` (discovery-art queue). API-backed implementations
  (`ApiVoice`, `ApiSparkNormalizer`) are declared behind the same
  interfaces, to be wired through the proxy.
- **Shell** (`web/`): transcript as an aria-live log with narration
  highlight; locked 3×3 compass + up/down/in/out row (known exits light,
  destinations named only after being visited); HERE chip (the room in
  the game's own words); CARRYING chips parsed from the game's own
  inventory reply; SAY-IT drawer with per-game saved sentences in
  localStorage (ships empty — your sentences are yours); big Save /
  Restore / Undo / Look / Inventory buttons sending the game's own
  commands; canvas fog map (visited rooms only, current room lit);
  narration rate + large-type settings; true-dark high-contrast theme.
- **Proxy** (`server/proxy.mjs`): zero-dependency static server +
  `/api/health` + `/api/spark/normalize` stub. This is the key-custody
  point: the API key will live only here (server environment), never in
  the app. Today it answers `not_configured`, honestly.
- **Bundled starter**: Figaro (Release 2 / Serial 100911) from the IF
  Archive, verified byte-for-byte against its license filing; GPL-3.0
  text and the Inform 7 source zip included under `games/figaro/`;
  `NOTICE.md` there and `CREDITS.md` at root mark it as a licensed
  component, never our work.

### Proof

`node test/headless.mjs` — **13/13 checks pass** against the real
Figaro file: boots, banner + author credit, first room, status parse
(room "Bedroom", moves counting), LOOK, a real verb answering in prose
("peek through keyhole"), SAVE → hook → play → RESTORE returning to the
saved move count, fog map holding exactly the visited room.

Three core bugs were found by playing the real game and fixed at the
root:

1. **VAR opcode numbering** — the first cut keyed VAR opcodes 13+ by a
   table that skipped erase_window / set_cursor / get_cursor /
   set_text_style / buffer_mode / not, so `call_vn2` (VAR:26) threw.
   Corrected against the Z-Machine Standards Document (VAR:243 is
   output_stream … VAR:250 is call_vn2, VAR:255 check_arg_count).
2. **Dictionary encoding** — word padding ran past 9 z-chars, so the
   end-of-string bit landed outside the compared bytes and *every*
   dictionary lookup missed ("That's not a verb I recognise" for all
   input). Padding now stops at exactly 9 z-chars (6 for v3).
3. **Status-line gluing** — fragments were concatenated, gluing the
   moves counter onto the room name ("Bedroom1", "Bedroom2"…). The
   upper window is now a real character grid with a cursor, honoring
   set_cursor / erase_window / erase_line / get_cursor.

### API use today (build-time and runtime are separate ledgers of work)

- **Calls made: 0. Spent: $0.00.** (See `docs/API_LEDGER.md`.)
- The $150 free credits are applied (billing page, 2026-10-27). But no
  API key has been provisioned to this build (keys arrive via the
  owner's Secure Vault flow), and the owner's **$1 non-free spend cap**
  is not yet verified set. Under the owner's budget discipline, no call
  may be made until both change.
- Prepared for the moment they do: `tools/api-review.mjs` — build-time
  inspection/review passes over this repo's code, with the budget rules
  enforced in the tool itself (~$80 build envelope, hard stop when
  remaining credits reach the ~$70 demo reserve, $1 non-free cap,
  per-call ledger rows appended before results are used). Verified
  today: with no credentials it refuses and makes **no network call**.

### Stubbed vs real (honest list)

Real: interpreter core + Figaro play end-to-end; save/restore through
the game's own commands; narration (device voice) with highlight;
speech input where the browser offers it; compass/HERE/map from the
game's own state; SAY-IT favorites; bring-your-own story files.

Stubbed: Muse Voice narration, Muse Image discovery art, API Spark
normalization (local stub stands in), Quetzal-format save files (Day-1
saves are core snapshots behind the game's own SAVE/RESTORE commands),
the 3D living map (Day-1 map is a flat canvas projection of the same
visited-room data), haptic sonar (not yet wired).

### Known defects (Day-1)

- Accented letters that a game defines in its own Unicode table render
  wrongly (Figaro's "Córdoba" shows as "C 4rdoba"): `zsciiToChar` uses a
  built-in extras map and does not yet read the header-extension Unicode
  table. Cosmetic; Day-2 fix.
- `restore_undo` resumes approximately (Frotz-faithful re-prompt not
  implemented); undo through the game's UNDO works via the undo ring.
- The adapter's exit learning knows only moves the player has made;
  exits a game *names* in prose are not yet learned (Day-2: parse the
  game's own exit lines, still Fairness-Law clean).

### Addendum 1 (same day, owner addition 09:09) — THE LANTERN BELOW

Our own showcase game, built alongside the shell to the spec filed at
the goal workspace (design by DeepSeek, adopted by the owner): a
souls-like Z-machine text RPG, **fully original, written in-event**,
source at `games/lantern-below/lantern.inf` (Inform 6.44, standard
library 6.12.8), compiled to `lantern-below.z5`.

- **World:** 7 rooms — Lantern Atrium (hub), Sunken Steps, Dusty Gallery
  (lore tablet + searchable glimmer cache), Flooded Stacks, Lever
  Chamber (the lever frees the iron door), Bell Approach (second
  lantern + the cracked-shaft shortcut, openable only from the far
  side), Bell Archive.
- **Systems:** HP / Stamina / Glimmer; STRIKE (3 stamina) / HEAVY
  STRIKE (6) / GUARD (blocks whole, restores stamina) / EVADE; enemies
  run fixed telegraph patterns with punish windows after their heavy
  blows; overspending stamina staggers you; REST at a lantern heals,
  resets enemies, moves your respawn, and sells STRENGTHEN (health /
  stamina / strength); death drops all glimmer where you fell, respawn
  at the last lantern, recover it or lose it to a second death. STATUS
  reads HP, Stamina, Glimmer, last lantern; REPEAT re-reads the fight
  (pacing aid). Combat is deterministic — patterns can be learned
  exactly, which is what makes the scripted acceptance test honest.
- **Enemies:** Archive Thrall (14 HP), Rusted Sentinel (22 HP), the
  Bell Warden (36 HP; two telegraphs — slam and flurry — and below half
  health a tolling phase whose hits also drain stamina).
- **Acceptance = a VM playtest, and it caught a real bug.** The first
  dfrotz walkthrough (55 scripted commands: both enemies, cache, rest,
  lever door, shortcut, strengthen, a death with a 65-glimmer drop,
  recovery, the Warden kill, the Core) stalled: the Sentinel survived
  its scripted kill. Root cause: the punish check compared each enemy's
  pattern *index* against the RECOVER constant, but only the Thrall's
  recover index happened to equal it. Fixed with a semantic `e_beat`
  property every pattern maintains. Re-run: **the whole loop completes
  — all three enemies die, 4 punish strikes land, YOU DIED → drop →
  recover → phase-two tolling → "THE LANTERN BELOW IS LIT" → "*** You
  have won ***" in 56 turns.** Transcript (the evidence) is committed
  at `games/lantern-below/playtest-transcript.txt`; the driver is
  `playtest.py`, the script `walkthrough.txt`.
- **Second proof, our own core:** `test/lantern-headless.mjs` plays the
  identical walkthrough through the shell's adapter — all checks pass.
  The demo flow can load either bundled game (switcher buttons in the
  shell header; Figaro remains the licensed starter).
- One cosmetic divergence, logged honestly: under our core the library
  status line renders a "Time:" field where Frotz renders Score/Moves
  (root cause not yet pinned); the adapter now parses both formats.

### Addendum 2 (same day, owner update 09:24) — THE API IS LIVE

The owner's key is connected (registered connector, Standard tier
only). The no-calls hold is lifted; budget discipline unchanged and now
exercised for real. Tally: **6 calls, est. $0.30 of the ~$80 build
envelope; the ~$70 demo reserve is untouched.** Full record:
`docs/API_LEDGER.md`.

- **In-product Spark is wired, on its leash.** `server/proxy.mjs` now
  implements `/api/spark/normalize` for real: the prompt enumerates only
  the commands the visible interface could compose from the current
  affordances; the model picks one or declines; the endpoint validates
  the answer against the same list; the client (`ApiSparkNormalizer`)
  validates again before accepting. The proxy holds no key — calls go
  through the connector helper, where the credential lives. Proven
  live: "head toward the north please" → `north`; "sing me a song
  about ducks" → declined. Runtime usage logs to `server/api-usage.log`.
- **Build-time inspection passes (the owner asked for complaining):**
  two passes over the full interpreter core returned *no content* —
  Spark's reasoning consumed the entire budget (4,000, then 12,000
  max_tokens) on a 14k-token prompt. Small focused passes work: the
  adapter + spark pass returned 15 findings, the spark re-check 5 more.
  Real bugs fixed from them: an alternation-precedence regex that
  matched "believe" as an exit command; missing negation handling
  ("don't go north" would have gone north); "look up"/"pick up"
  hijacked as directions; adapter direction-learning missing
  enter/exit synonyms and movement fillers; no fetch timeout on the
  API path; game-specific strings ("examine lantern") baked into the
  generic normalizer (removed); a phantom-room guard in status parsing;
  in/out rooms now placed on the map. Two findings were answered with
  design clarifications instead of code (compass directions are
  interface-offered commands, never claimed exits — comments now say
  exactly that). `tools/api-review.mjs` now runs these passes through
  the connector helper and appends ledger rows itself.
- Still on the local path behind their interfaces (Day-2 queue): Muse
  Voice narration, Muse Image discovery art.

### Day-2 punch list (ordered by judging weight)

Impact (30): Quetzal-standard saves (interoperability = any player can
keep their game anywhere); Unicode-table fix; eyes-closed full-loop
test (start → play → save → restore by voice only).
Meta AI Tooling (25): wire Spark normalization through the proxy the
moment the key lands (affordances-only prompt, decline allowed); first
API inspection pass over the core via `tools/api-review.mjs`, findings
fixed and logged; Muse Voice narration behind `NarrationService`.
Demo (25): scripted continuous demo flow incl. the eyes-closed stretch;
discovery-art first room painting (cached, decoration only).
Technical Depth (20): Fizmo-behind-the-adapter evaluation vs the
clean-room core on a corpus of games; object-tree state channel
(per-turn containment) to replace parsed HERE/CARRYING v1; haptic sonar
core (heading + vibration, exits the game surfaced only).

## Day 2 — Tuesday, October 27, 2026 (in-event work)

The Day-1 punch list, worked in order. All five items landed; the
evidence for each is a committed test or transcript, not a claim.

### 1. Voice, both directions

- **Voice in — LANDED.** Muse Voice Transcribe (`muse-voice-transcribe-1.0`)
  through the proxy: `POST /api/voice/transcribe` takes raw mic audio,
  transcodes to the API's narrow format (mono PCM16 WAV, 16 kHz) with
  ffmpeg, and calls the API through the connector helper. The shell's
  mic prefers the API path (`ApiSpeech`, push-to-talk, 6 s cap) whenever
  the proxy reports the API configured, and falls back to the browser
  recognizer otherwise. Request shape found by iteration against the
  live API (multipart `request` JSON part + `audio` part;
  `audioEncoding: "WAV"`); failures before a transcript are not billed.
- **Narration out — the API offers none.** The voice model's own docs
  state it does not synthesize speech, and no TTS endpoint exists on
  the API (Muse speech synthesis is a downloadable open-weight model,
  not an endpoint). Narration therefore stays on the device/browser
  voice behind the same `NarrationService` interface the shell already
  used — one interface, honest backend label (`voiceOut: "device"` in
  `/api/health`). If a hosted Muse TTS endpoint appears, it slots in
  behind that interface without shell changes.
- ASR costs $0.18 per audio-hour — the day's 373 transcriptions
  (359 s of audio) cost about two cents. Ledger has the aggregates.

### 2. Quetzal saves — LANDED, proven on both games

`core/quetzal.js` implements the Quetzal (IFZS) standard against the
core's snapshots: FORM/IFZS with IFhd (identity checked against the
story header on restore; a save from another game decodes to null,
never a corrupt restore), CMem (XOR against the original story +
RLE), and Stks (frames serialized with the core's documented frame
layout — a zero-return bottom frame holding the pre-first-frame eval
stack; frames declare the core's 15 local slots). The shell's save
slot now stores Quetzal; Day-1 JSON slots still restore through the
legacy fallback. Download/Load buttons hand the player the actual
`.sav` file. `test/quetzal.mjs` verifies the format with an
*independent* spec parser (no shared code): well-formed FORM, IFhd
match, CMem round-trips byte-exactly, Stks parses to its exact end
(Figaro 17 frames, Lantern 8), and save → wander → restore returns the
saved room and state in both games (Lantern Glimmer 30 → 55 → 30).
- **Interop with Frotz: attempted, blocked in this environment, not
  claimed.** The local dumb-Frotz binary produces no output under
  pipe, pty, or `script`; a source rebuild fails; the Jericho Frotz
  wrapper runs the games but exposes raw state tuples, not Quetzal
  bytes. Cross-interpreter restore stays an open item (Day-3 list) —
  the format proof above is spec-level and internal, stated as such.

### 3. Eyes-closed full-loop test — LANDED, ALL CHECKS PASSED

`test/eyes-closed.mjs`: a driver that never reads the screen model.
Every intended command is spoken by a synthesized voice, transcribed
by Muse Voice Transcribe through the real proxy, normalized by the
shell's exact chain (Spark leashed → stub → verbatim), and gated only
on what the narration said. It plays **The Lantern Below start to
victory** — all three enemies, the death and glimmer-drop, the
recovery, the tolling phase, "THE LANTERN BELOW IS LIT" — then a
**Figaro session with save/restore by voice** (the look after restore
is byte-identical narration). 59 PASS, 0 FAIL, 0 ASR misses across
the final run; transcript committed at
`test/eyes-closed-transcript.txt`. Four attempts preceded the pass;
each failure was a real defect, fixed at the root:

- **ASR punctuation broke game verbs.** "Guard:" / "Strike!" reached
  the parser verbatim and were rejected (a Z-machine dictionary does
  not treat `!`/`:` as separators). Fixed in the shell's verbatim
  path (`web/app.js`): trailing sentence punctuation is stripped
  before a verbatim send. This bug ate a GUARD in a boss fight.
- **"Strengthen" is misheard as "strength and"** in every test voice.
  The local normalizer gained whole-phrase aliases
  (`strength and health` → `strengthen health`, same for stamina) —
  a general ASR artifact repair, in the stub's existing charter.
- **"Glimmer" is the test voice's blind spot** (heard as "limer",
  "blame", "cash"…). The driver recovers the way a person does —
  rephrasing ("take all", "examine tablet") and re-speaking in another
  voice, every attempt through the full voice path; the transcript
  lists all 13 deviations honestly.
- **Weak gates lie.** Two gates originally matched room-description
  words a LOOK repeats (a lever that was never pulled "passed"). All
  gates are now action-result text taken from the game's own output.
  One gate also corrected the other way: the Gallery cache's take
  text is "You gather the cache", not "Taken." — the action had
  succeeded under a wrong gate.
- A root Z-text bug surfaced on Day 1's list also closed: Figaro's
  "Córdoba" decoded as "C 4rdoba" — the decoder never entered the
  ten-bit ZSCII escape state (A2 zchar 6), and games with a header
  Unicode table were ignored. Both fixed in `core/zmachine.js`; the
  Figaro boot text now reads Córdoba, and the Day-1 headless suites
  stay green.

### 4. Muse Image discovery art — LANDED

`POST /api/art/for-room`: the style prompt is built from the room's
own description (truncated, nothing invented beyond it); the image is
generated once per (game, room) ever and cached on disk
(`server/art-cache/`, git-ignored runtime cache; the shell also keeps
a device-side room→URL cache). The shell paints it in the discovery
panel labeled, in text, "decoration only; everything it shows, the
words above already said." Proven live: Lantern Atrium art generated
through the proxy (10,332 in / 1,129 out tokens) and served from
cache on the second ask. Output bytes are WebP regardless of the
requested filename — noted in the helper.

### 5. Object-tree state channel + haptic sonar — LANDED

- `core/zmachine.js` gained read-only tree views (`objectCount`,
  `objectName`, `roomObjectByName`, `objectChildren`); the adapter
  exposes `turn.objects` — the current room's contents by the game's
  own object names. Proven: the Atrium lists the wayfarer's lantern
  and the cracked shaft; the Sunken Steps list the Archive Thrall,
  and after the kill the tree truthfully keeps its *remains* (the
  channel reports the tree, not aliveness). Scoped honestly: rooms
  are matched by short name among parentless objects — **Figaro
  returns null**, because its Inform 7 build keeps object print names
  outside the Z object-name field; the shell shows nothing rather
  than guessing from prose. Contents chips render in the HERE row
  when the channel has data.
- Sonar wired: the Sonar button vibrates the pattern of exits the
  game has actually shown from this room (clockwise sweep; short
  pulse per compass exit, long for up/down/in/out; double-thud when
  nothing is known) and narrates the same list. `services/sonar.js`
  + pattern/contents checks in `test/sonar-objects.mjs` — ALL PASS.

### API use today

752 calls, est. **$1.21** (Day-2 subtotal) — cumulative $1.52 of the
~$80 build envelope; the ~$70 demo reserve is untouched and fenced.
The eyes-closed runs are the spend driver (~370 paired
transcribe+normalize calls per full run). Full record:
`docs/API_LEDGER.md`.

### Day-3 queue (as seen from the build)

- Quetzal↔Frotz cross-interpreter restore proof (needs a working
  second interpreter in the environment; blocked, not abandoned).
- The 3D living map layer (fog-of-war room geometry from the
  adapter's map snapshots) — the demo's visual centerpiece.
- Adapter parsing of game-named exits (exits a game names in prose,
  the Day-1 known-defect list) to enrich compass + sonar.
- restore_undo fidelity pass; Lantern adapter "Time:" status variant
  (carried known issue from Day 1).
- Demo script + continuous demo flow (scripted run incl. the
  eyes-closed stretch), and a recorded fallback in case the venue
  network is unkind.

## Addendum 3 — Day 3 (2026-10-27): the finish

The Day-3 queue is closed in full, in its own order. Method note: the
day's biggest defects were found by *reading* — the Inform library
source, Frotz's C source, and byte-level file comparisons — and every
fix is pinned by a test that failed before it.

### (d) restore_undo fidelity + the "Time:" status variant — one core, two roots

- **"Time: 12:0-1 am" root cause (found in the library source):** the
  Inform 6 library's `ZZInitialise` computes
  `sys_statusline_flag = (HDR_TERPFLAGS->0 & $0002) / 2` — header
  byte 1, bit 1 is read as the game's "status line displays time"
  signal. Our core set that bit claiming "boldface available", so
  score-line games drew a clock and the adapter's score/moves parsed
  as null. The core now claims only the fixed-pitch font it actually
  renders (styles are tracked, not drawn) and writes the interpreter
  standard revision word (1.1) like Frotz does. Lantern Below now
  reports Score/Moves — pinned in `test/undo.mjs`.
- **UNDO root cause:** the undo ring mixed snapshots taken at every
  `@read` in with the library's per-turn `@save_undo` snapshots, and
  the restore delivered its result (2) into the *restore_undo* call
  site's variable — in the restored timeline that write landed in the
  wrong frame's local, the library never saw "save_undo returned 2",
  and the turn fell through to a stale parse ("I didn't understand
  that sentence"). The ring now holds `@save_undo` snapshots only
  (Frotz semantics), and the restore completes into the snapshot's own
  recorded store variable — the file-restore convention. UNDO now
  matches Frotz's behavior exactly on both games
  (`test/undo.mjs`: room, move count, and HP all restored).
- Side discovery: the Day-2 Quetzal test's move-count check had never
  actually run — Lantern's null moves (the Time bug) skipped it — and
  its arithmetic was wrong by the probe turns. Fixed in the test;
  the restore it guards was correct.

### (b) Quetzal↔Frotz cross-interpreter proof — SOLVED, and it bit back

- The environment's vendored Frotz fork proved inert (its dfrotz
  exits 0 silently on everything); a **pristine Frotz 2.55** was
  downloaded and built from the source release instead.
- **Direction B (Frotz → ours) failed first**, and the failure was
  real: the Stks result-variable byte is *always present* in a frame
  (0 for discarded-result calls) — Frotz's writer writes it and its
  reader reads it unconditionally. Our writer omitted it on
  discarded frames and our reader skipped it, shifting every later
  frame by one byte in the other interpreter. Our bottom dummy frame
  also carried a non-zero flags byte where Frotz demands six zero
  bytes. Both fixed in `core/quetzal.js`; the Day-2 "independent" spec
  parser in the test had shared the same wrong assumption and is
  fixed too — the cross-interpreter test is the real independence.
- **Direction A "failure" was a filename**: Frotz appends `.qzl` to
  save/restore names that lack it. With the suffix carried, Frotz
  restores our saves perfectly.
- Result (`test/quetzal-frotz.mjs`, transcript committed): both
  directions state-exact on The Lantern Below (room, moves, HP), plus
  Figaro ours→Frotz.

### (c) Game-named exits

- `core/adapter.js` learns exit *names* from the game's prose — two
  conservative shapes ("The Flooded Stacks lie north"; "…climb north
  toward the Sunken Steps"; "…run north, toward the iron door"). A
  name is never a destination: destinations stay traversal-only, the
  fog maps are unchanged in what they place. The compass labels named
  exits (dashed), the sonar speaks them ("north toward Flooded
  Stacks"), and the 3D map draws them as labeled stubs.
  `test/named-exits.mjs` gates the three real Lantern specimens plus
  the fairness invariants; Figaro fabricates nothing.

### (a) The 3D living map

- `web/map3d.js`: pure isometric projection of the adapter's fog
  snapshots (no DOM — verified headlessly in `test/map3d.mjs`):
  visited rooms as boxes, painter-sorted, edges only between visited
  rooms, named exits as dashed labeled stubs from the current room.
  The shell renders it beside the flat map; the current room's box
  pulses gently so a watcher can find the player.

### (e) Demo flow + recorded fallback

- `web/demo-script.js` + `web/demo.js`: a one-button continuous demo
  (fresh-boots Lantern Below; explore → telegraphed fight → loot →
  rest → save → Sentinel fight → restore) played through the shell's
  real command path, captioned, paced by the narration itself.
  Gated headlessly beat-by-beat by `test/demo-rehearsal.mjs` — which
  caught one caption lying (Glimmer is a counter, not a carried item;
  the beat now shows STATUS instead of an empty inventory).
- `demo/DEMO_SCRIPT.md` is the run of show, including the
  presenter-led eyes-closed stretch; `demo/recorded-demo.html`
  (generated by `tools/build-recorded-demo.mjs` from the final
  eyes-closed transcript) is the self-contained offline fallback.
- A focused Spark inspection pass over the new modules returned four
  findings (stub projection math, double-drawn edges, demo stop
  latency, concurrent-run guard) — all four were real, all fixed.

### The normalizer chain order (found by the final verification)

- The first final-build eyes-closed run failed exactly one gate of
  59: the recognizer heard "strengthen health" as "strength and
  health," and because the chain asked Spark *first*, Spark's nearest
  leashed pick was "status" — the deterministic alias written on Day 2
  for exactly this mishearing never got its turn. The chain now runs
  the deterministic stub first (exact whole-phrase knowledge, alias
  repairs included) and Spark for what it honestly declines, in both
  the shell (`web/app.js`) and this test, which mirrors it. The
  re-run passed **59/59 with 0 ASR misses**, the alias firing visibly
  in the transcript at the same sentence.

### Final verification (final build)

- All suites green: headless, lantern-headless, quetzal,
  quetzal-frotz, undo, named-exits, map3d, sonar-objects,
  demo-rehearsal — and the eyes-closed acceptance re-run on the final
  build: **59 checks passed, 0 failed, 0 ASR misses** (Lantern Below
  start-to-victory plus the Figaro voice save/restore session;
  transcript committed).
- The Lantern dfrotz acceptance walkthrough re-ran under Frotz 2.55
  and regenerated its transcript byte-identical (deterministic).

### API use today

272 calls, est. **$0.38** (Day-3 subtotal; two eyes-closed
verification runs via the proxy plus a two-call Spark inspection of
the new modules). Cumulative **$1.89 estimated of the $150** free
credits — build envelope ~$1.57 of ~$80, demo reserve ~$0.33 of ~$70.
Full record: `docs/API_LEDGER.md`.

## Addendum 4 — v1.2 (2026-10-27): the phone-fit pass

Driven by the owner's on-device review of the v1.0.0-final APK —
"Apk needs resizing work, everything huge. Modern ui, triple A…
But it does open so far" — with six screenshots (945×2048) as the
evidence. Fit and look were the priority; no product behavior changed.

### Root causes (three, all measured)

1. **The Android wrapper never enabled a wide viewport.**
   `MainActivity` set neither `setUseWideViewPort` nor
   `setLoadWithOverviewMode`, so the WebView ignored the page's
   correct `<meta name="viewport" content="width=device-width">` and
   laid out at a ~980px desktop viewport, scaled and pannable — the
   owner's screenshots exactly (title clipped, prose off the right
   edge, Send button cut).
2. **The sheet's single-column switch kept shrink-to-fit sizing.**
   Under 900px `main` became a column but kept
   `align-items: flex-start`, so `.stage` sized to its content's
   max-content — and the transcript is `pre-wrap`, whose max-content
   is the longest unwrapped line. Measured in headless Chromium at
   411 CSS px: document scroll width **479** against a 411 viewport,
   `.stage` itself 461px wide, status bar and Send row clipped with
   it.
3. **Desktop chrome at phone width.** An 18px base, 60px action
   buttons, 56px compass cells and 1em paddings, with no breakpoint
   below 900px and an unstyled, non-wrapping header action group —
   "everything huge" even where nothing overflowed.

### What changed

- `web/styles.css` — rewritten fluid, identity intact (true-dark,
  gold accent, serif story text): grid layout with
  `minmax(0, 1fr)` tracks so no content can size the layout;
  wrapping header with a styled action group; fluid type scale
  (16px phone / 18px desktop; Large type 20/22px preserved);
  ~44px targets with tighter padding; big actions as an auto-fit
  grid; command-row input `min-width: 0`; sans UI chrome (header,
  buttons, panel headings) over the serif transcript;
  `-webkit-text-size-adjust: 100%`; `overflow-x: clip` as a guard,
  not the fix. Breakpoints at 960 / 640 / 380px. Desktop structure
  unchanged.
- `web/index.html` — viewport gains `viewport-fit=cover`.
- Wrapper (`android-app/`, outside this repo): the two WebSettings
  lines above; versionName `1.2` / versionCode 2.

### Verification

- Headless Chromium (CDP device emulation), before vs after at the
  owner's screenshot regions (header, story, controls, compass,
  maps): **after — scroll width equals viewport width at 360, 411
  and 1280 CSS px, zero overflowing elements at all three**; Figaro
  boots and plays in every capture. (This VM's Chromium fork blocks
  loopback navigations unless the initiator is a local context; the
  harness launches via a file:// redirect page and fulfills nothing
  late — method noted so the numbers are reproducible.)
- The phone's exact density was unreachable this pass (Termux SSH
  not answering on either route); the screenshots are definitively
  945×2048, which the 360/411 CSS-px pair brackets.
- All suites green on the v1.2 tree: headless, lantern-headless,
  quetzal, quetzal-frotz, undo, named-exits, map3d, sonar-objects,
  demo-rehearsal — and the eyes-closed acceptance: **59 passed,
  0 failed, 0 ASR misses** (transcript regenerated).
- APK: `Z-Games-v1.2.apk`, 431,842 bytes, SHA-256
  `18fc2050c7b3600d8657bd5061d6fc7a89c8abc9dcb002b36030aaf4d95d99a9`;
  badging versionCode 2 / versionName 1.2, minSdk 26, targetSdk 34,
  sole permission VIBRATE; signer is the same debug certificate as
  v1.0 (installs as an update); in-APK web files hash-match this
  tree; bundle smoke ALL CHECKS PASSED; the Drive copy's MD5 equals
  the local build's. No API spend in this pass ($0).
