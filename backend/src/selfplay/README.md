# Self-play harness

Headless bot-vs-bot play over the pure engine, for generating training data.

```bash
npm run selfplay -- --games 1000 --out data/selfplay.jsonl
npm run selfplay -- --games 200 --policies avoidPoints,random,avoidPoints,random
npm run selfplay -- --games 100 --teams --variant pips
```

Roughly 90 matches/second single-threaded (~500 decisions per match).

## Policies

A policy is `(observation) => card`, choosing from `observation.legalMoves`. It sees
only what the player legitimately sees, so anything trained on the resulting logs is
learning from a fair information set.

- `random` — uniform over legal moves.
- `lowest` — always the lowest card.
- `avoidPoints` — heuristic baseline: duck point cards, dump the pig when void,
  take the trick when the sheep is on the table. Beats `random` decisively, which is
  the regression test that the harness produces meaningful signal.

Add new policies in `policies.js` and register them in `POLICIES`.

## Training records

One JSONL record per decision point:

```json
{
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
to outcomes.
