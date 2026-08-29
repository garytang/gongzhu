# TODO

## Done
- lobby is accessible even if you dont enter a handle; it should show the current people in the lobby ✅
- team scoring and game carry over is broken ✅
- continue new game doesnt work ✅
- team mates must not be adjacent on the table ✅
- Get rid of git submodules ✅
- fix the dumbed down front end and integration tests ✅ (engine + self-play suites now
  import production code; the old copy-pasted `game-logic.test.js` is gone)
- create ability to play with fewer than 4 ✅
- fix the scoring to be consistent with rules ✅ (engine implements the published table;
  see note below)

## Rules note
The earlier note here — "number cards have points equal to their number except for 4
which is -10" — matches no published ruleset. Every authoritative source (pagat,
zh.wikipedia, the TW tournament rules, 百度百科) gives 4♥/3♥/2♥ = 0. Both are now
supported as selectable variants: `standard` (default) and `pips`. Notably the pips
table also totals exactly −200 across the suit, so 全紅 stays +200 either way.

## Phase 1–2 complete: engine + self-play
- Pure deterministic rules engine at `backend/src/engine/` ✅
- Real test suite importing production code, 64 tests ✅
- CI on every push ✅
- Self-play harness with JSONL training records at `backend/src/selfplay/` ✅

## Next
- **Phase 3 — rooms.** Replace the single global game/player map with real rooms, so
  more than one table can exist. Migrate `backend/index.js` onto the engine; delete its
  duplicate rules logic. Add a host who controls start, and enforce max seats (a 5th
  player is currently seated silently with no hand).
- **Phase 4 — identity and reconnect.** Persistent playerId in localStorage, seat
  reclaim on reconnect, pause-with-countdown, bot takeover or lobby-punt on timeout.
- **Phase 5 — frontend.** Wire to rooms; sort the hand; show legal moves rather than
  rejecting illegal clicks; positional seating; trick-winner feedback; round history.

## Known bugs still open in the legacy server
- the last card played in trick still doesnt always show
- `cumulativeTeamScores?.team1 || calculated` in App.tsx: a legitimate score of 0 falls
  through to the fallback
- `game.scores` is initialised to 0 and never written, so the in-game team display reads
  0/0 all round
- `handleBotTurn`'s catch block duplicates ~40 lines of its try block; a bot whose
  fallback card fails validation stalls the table forever
- `trickDisplayDelay`'s pending 1s timer writes into whatever `game` object exists when
  it fires, so starting a new game within 1s of a trick clears the new game's trick
- bot API endpoints (`/api/bots/*`) are unauthenticated on a public deploy
