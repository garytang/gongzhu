# Self-play harness

Headless bot-vs-bot play over the pure engine, for generating training data and for
deciding whether one policy is actually stronger than another.

```bash
npm run selfplay -- --games 1000 --out data/selfplay.jsonl
npm run selfplay -- --games 20000 --workers auto --out data/big.jsonl
npm run selfplay -- --games 200 --policies avoidPoints,random,avoidPoints,random
npm run selfplay -- --games 100 --teams --variant pips

npm run tournament -- --policies cardCounter,avoidPoints --matches 30
npm run tournament -- --policies cardCounter,avoidPoints --matches 30 --teams
```

`--out` is gitignored under `backend/data/`.

## Throughput

About 1,450 matches/second single-threaded and 5,500 with `--workers 8` on an M-series
laptop (~530 decisions per match). Writing JSONL is the bottleneck once `--out` is set,
where the same machine does about 1,000 matches/s: records average roughly 800 bytes, so
a 2,000-match dataset is close to 900 MB. Runs with no `--out` build no records at all.

`--workers N` splits the batch into N contiguous seed ranges, one worker thread each,
and concatenates the shards in range order. The seed of match `i` does not depend on
which worker played it, so **the records are byte-identical for any worker count** —
only the header's timestamp differs. A test asserts this.

## Policies

A policy is `{ name, choose(observation, ctx) }`, choosing from
`observation.legalMoves`. `choose` may return a card or a promise of one, so an LLM or
a model served over the network plugs in unchanged. It sees only what the player
legitimately sees, so anything trained on the resulting logs is learning from a fair
information set.

- `random` — uniform over legal moves.
- `lowest` — always the lowest card.
- `avoidPoints` — duck point cards, dump the pig when void, take the trick when the
  sheep is on the table.
- `cardCounter` — the strongest baseline. Reconstructs the whole trick history from the
  observation stream (see `tracker.js`), so it knows which cards are gone, which
  players have shown void in which suit, and therefore when a card will certainly win.
  Avoids leading into a void while the pig and high hearts are out, feeds the sheep to
  its teammate, and dumps the pig and high hearts on whoever is taking the trick.
  Beats `avoidPoints` by 13–20 points per hand individually and 19–39 in partnerships.

`registerPolicy(name, factory)` adds a policy from outside this directory — an LLM bot
in `src/bots/`, or a trained model — without editing the harness. `factory(name)` is
called once per seat per match, which is where per-match state belongs. Worker threads
start with a clean module registry, so pass `--require ./path/to/module` for a policy
registered elsewhere; the flag is forwarded to every worker.

## Evaluation

`npm run tournament -- --policies a,b,... --matches N` plays every seat arrangement N
times and prints win rate and mean hand score with a 95% confidence interval:

```
mode: individual   seatings: 4   matches: 120   seed: tourney

policy       matches  hands  win rate (95% CI)  mean hand score (95% CI)
-----------  -------  -----  -----------------  ------------------------
cardCounter      120   2430        54.2% ± 8.9               -54.9 ± 4.8
avoidPoints      120   2430        47.5% ± 8.9               -63.3 ± 5.6
```

Seat matters in Gongzhu — the deal is fixed by the seed, and playing last to a trick is
worth something — so every arrangement is played in every rotation and no policy is
credited for its seat. With `--teams` each pair of policies plays as the two
partnerships, in both seatings; so does individual mode when there are more policies
than seats. Everything is derived from `--seed`, so a run replays exactly.

Intervals are normal approximations. Mean hand score is the lower-variance signal and
should be the one you trust: hands within a match are not independent, so a real
interval on it would be slightly wider than the one printed.

## Training records

`--out FILE` writes JSONL. **Line 1 is a header record** carrying the provenance of
everything that follows; every line after it is one decision.

```json
{"type": "header", "meta": {
  "schemaVersion": 1,
  "gitSha": "2811f89ca509…",
  "engineOptions": {"variant": "standard", "teams": null, "targetScore": 1000,
                    "firstLead": "clubs2", "exposuresEnabled": false},
  "policyNames": ["avoidPoints", "avoidPoints", "avoidPoints", "avoidPoints"],
  "seedPrefix": "batch",
  "generatedAt": "2026-09-01T22:14:03.010Z",
  "datasetId": "dd4115727400"
}}
```

`datasetId` is a digest of everything above except `generatedAt`, so two runs of the
same configuration share an id and two different rule configurations never do. Every
decision record repeats `schemaVersion` and `datasetId`, which is what stops datasets
from being silently mixed when files are concatenated: group by `datasetId` before
training, and refuse a `schemaVersion` you do not understand.

```json
{
  "schemaVersion": 1, "datasetId": "dd4115727400",
  "matchId": "batch-0", "seed": "batch-0", "handNumber": 1, "trickNumber": 1,
  "player": "p0", "seat": 0, "policy": "avoidPoints",
  "observation": { "hand": ["Q♥", "..."], "trick": [], "leader": "p0",
                   "exposed": [], "collected": {}, "handCounts": {},
                   "totals": {}, "teamTotals": null, "teammate": null,
                   "variant": "standard" },
  "legalMoves": ["2♣"], "action": "2♣",
  "reward": -170, "handScores": {}, "handTeamScores": null
}
```

Records are buffered until the hand settles so each is stamped with `reward` — the
score the acting player actually ended the hand with. The log is therefore directly
usable for supervised or offline-RL training with no second pass to join decisions
to outcomes. Records appear in play order within a hand, hands in order within a match,
and matches in ascending seed order.

`observation` carries no per-trick history, but the full history is recoverable from
`collected` plus `leader` — `tracker.js` does exactly that, and it is the same
reconstruction a feature extractor should use.
