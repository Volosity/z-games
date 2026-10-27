# Meta Model API — usage ledger

Budget frame (owner's numbers, 2026-10-27):

- Total pool: **$150 in free credits** (applied 2026-10-27, confirmed on the
  billing page: "Free credits in use $150.00", balance $0.00).
- Build-phase envelope: **~$80**. Hold **~$70 in reserve for the demo
  phase** — build/API spend stops when remaining free credits reach ~$70.
- Hard stop: **non-free (card) spend is capped at $1** by the owner. Free
  credits are the budget; if the free pool is exhausted, STOP and report —
  never drift onto the card.
- Access: the owner's key is connected through the registered
  `custom.meta-model-api` connector (verified live 2026-10-27 09:24 PT);
  all calls in this ledger go through its helper (`meta_api.py`), which
  is where the credential lives — no key exists in this repo, the app,
  or the proxy. Standard tier models only; the `-contributor` variants
  are forbidden by the owner. The $1 non-free cap remains the owner's
  billing-page setting; spend here is drawn from the free credits and
  tracked per call below.

Estimation rule: when the API reports token usage, tokens are recorded as
reported and cost is read from the billing page. When it does not, cost is
estimated conservatively at $5.00 per million tokens (in + out) and the
row is flagged ESTIMATED.

## Calls

| Date (UTC) | Purpose | Model | Tokens in | Tokens out | Cost |
|---|---|---|---|---|---|
| 2026-10-27T16:25:34Z | runtime: spark-normalize via proxy ("head toward the north please" → "north", accepted) | muse-spark-1.3 | 136 | 402 | $0.0027 ESTIMATED |
| 2026-10-27T16:25:37Z | runtime: spark-normalize via proxy ("sing me a song about ducks" → DECLINE, leash held) | muse-spark-1.3 | 129 | 711 | $0.0042 ESTIMATED |
| 2026-10-27T16:26:22.808Z | build-review (core/zmachine.js, core/adapter.js) — returned NO content: reasoning consumed the whole 4000-token budget | muse-spark-1.3 | 14220 | 4000 | $0.0911 ESTIMATED |

| 2026-10-27T16:27:21.186Z | build-review (core/zmachine.js, core/adapter.js) | muse-spark-1.3 | 14241 | 12000 | $0.1312 ESTIMATED |

| 2026-10-27T16:27:54.122Z | build-review (core/adapter.js, services/spark.js) | muse-spark-1.3 | 2943 | 5449 | $0.0420 ESTIMATED |

| 2026-10-27T16:30:35.095Z | build-review (services/spark.js) | muse-spark-1.3 | 1311 | 5173 | $0.0324 ESTIMATED |

## Day 2 — Tuesday, October 27, 2026 (continued)

Day-2 runtime traffic runs through the proxy, which logs every call to
`server/api-usage.log`; the rows below are aggregates computed from that
log (747 calls), plus the day's direct helper probes. Transcription is
priced per audio time ($0.18 per audio-hour = $0.003/min, per the API
docs); token-billed rows use the ledger's $5.00/Mtok estimate rule.

| Date (UTC) | Purpose | Model | Tokens in | Tokens out | Cost |
|---|---|---|---|---|---|
| 2026-10-27 (day) | helper probes: ASR shape found by iteration — 2 billed successes (1,120 ms each); several 400s during shape discovery produced no transcript and are not billed | muse-voice-transcribe-1.0 | — | 2,240 ms audio | $0.0001 ESTIMATED |
| 2026-10-27 (day) | helper probe: image generation test (Lantern Atrium) | muse-image-1.0 | 10028 | 911 | $0.0547 ESTIMATED |
| 2026-10-27 (day) | runtime aggregate: spark-normalize via proxy (smoke tests + all eyes-closed runs) | muse-spark-1.3 | 47184 | 169477 | $1.0833 ESTIMATED |
| 2026-10-27 (day) | runtime aggregate: voice-transcribe via proxy (smoke tests + all eyes-closed runs; 373 calls, 359,280 ms of audio) | muse-voice-transcribe-1.0 | — | 359280 ms audio | $0.0180 (at documented per-minute price) |
| 2026-10-27 (day) | runtime: art-generate via proxy (Lantern Atrium, cached on disk after one generation) | muse-image-1.0 | 10332 | 1129 | $0.0573 ESTIMATED |

Day-2 subtotal: **$1.2134 ESTIMATED**. Note for the demo phase: the
eyes-closed acceptance is the day's spend driver — each full run is
~370 paired transcribe+normalize calls, and Spark's reasoning tokens
dominate the normalize cost (169k output vs 47k input across the day).

## Day 3 — Tuesday, October 27, 2026 (the finish)

Day-3 spend is the demo phase: two final-build eyes-closed
verification runs through the proxy (the first exposed the
normalizer-chain defect recorded in BUILD_LOG Addendum 3; the second,
on the fixed chain, passed 59/59), plus one focused build-time Spark
inspection of the new Day-3 modules (two helper calls, the first of
which returned empty after spending its budget on reasoning — the
Day-1/2 lesson again).

- Via the proxy (from `server/api-usage.log`, rows after the Day-2
  fold): **270 calls** — 120 Spark normalizes (15,191 in / 60,242
  out), 150 voice transcriptions (146.2 s of audio) → **$0.3275
  ESTIMATED** at this ledger's rules.
- Via the helper directly: **2 calls** (Spark inspection of
  web/map3d.js + web/demo.js; 2,250 in / 9,278 out, one empty
  response) → **$0.0492 ESTIMATED**.
- Day-3 subtotal: **$0.3767 ESTIMATED**, booked against the demo
  reserve, which the owner unlocked for demo-phase work.

## Tally

- Calls made: **6** on Day 1; **752** on Day 2 (747 via the proxy, 5 via
  the helper directly, 2 of the helper calls billed); **272** on Day 3
  (270 via the proxy, 2 via the helper).
- TOTAL_SPENT: $1.8937 ($0.3036 Day 1 + $1.2134 Day 2 + $0.3767 Day 3,
  estimated per the rule above; the billing dashboard is the
  authoritative read).
- Remaining free credits: **~$148.11** (estimate). Build envelope used:
  ~$1.57 of ~$80 (Days 1–2 plus the Day-3 inspection calls). Demo
  reserve used: ~$0.33 of ~$70 (the Day-3 verification runs). The $1
  non-free hard stop was never approached.
- Token profile worth knowing: Spark's reasoning dominates completion
  tokens (e.g. 392 of 402 on a trivial normalize). Large code dumps make
  reasoning consume the entire budget and return no content — two review
  passes over the full interpreter core returned empty at 4,000 and
  12,000 max_tokens. Small, focused prompts (≤ ~3k prompt tokens) answer
  well. The tooling and the BUILD_LOG carry this lesson.
- Status: **API live.** In-product Spark normalization is wired through
  the proxy (affordance-normalization only, validated on both sides of
  the wire). Day-2 update: Muse Voice **input** (transcription) is live
  through the same proxy; the API offers **no speech synthesis** (the
  voice model transcribes only), so narration out stays on the device
  voice behind the one NarrationService interface — recorded in
  BUILD_LOG Day 2. Muse Image discovery art is live (generate-once,
  disk-cached per game+room).
