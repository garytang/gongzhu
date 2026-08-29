# Gongzhu engine

A pure, deterministic rules engine. No sockets, no timers, no globals: every function
takes a state and returns a new one. That is what makes the same code usable by the
multiplayer server, the unit tests, and the self-play harness.

## Rules implemented

Sources: [pagat.com](https://www.pagat.com/reverse/gongzhu.html),
[zh.wikipedia 拱豬](https://zh.wikipedia.org/zh-tw/%E6%8B%B1%E7%8C%AA),
[拱豬大賽 (TW)](http://chiuinan.github.io/game/game/intro/ch/c41/pigh.htm),
[百度百科 拱豬](https://baike.baidu.com/item/%E6%8B%B1%E8%B1%AC/996334).

### Card values

| Card | Score |
| --- | --- |
| Q♠ — the pig (豬) | −100 |
| J♦ — the sheep (羊) | +100 |
| 10♣ — the transformer (變壓器) | +50 alone, otherwise doubles that player's total |
| A♥ / K♥ / Q♥ / J♥ | −50 / −40 / −30 / −20 |
| 10♥–5♥ | −10 each |
| 4♥ / 3♥ / 2♥ | 0 |

Two heart tables are supported, selected by `options.variant`:

- `standard` (default) — the table above, as published.
- `pips` — house rule: number cards score their pip value, except 4♥ which scores −10.
  Face cards are unchanged.

Both total exactly −200 across the suit, so 全紅 is worth +200 under either.

### Slams

Scoring is compositional rather than a lookup table of slam totals, and reproduces
every published figure exactly:

| Result | Score |
| --- | --- |
| 全紅 — all thirteen hearts | +200 (hearts flip positive) |
| 全紅 + pig | +300 (the pig flips positive too) |
| 小滿貫 — all hearts + pig + sheep | +400 |
| 大滿貫 — all point cards including the transformer | (200 + 100 + 100) × 2 = +800 |
| 大滿貫, fully exposed | (400 + 200 + 200) × 4 = +3200 |

### Exposure (亮牌)

Scoring honours exposures today; the interactive declare phase is behind
`options.exposuresEnabled` and is off by default until the UI and bot policies
support it. Exposing doubles a card's value **for whoever takes it**, not for the
player who exposed it.

| Exposed | Effect |
| --- | --- |
| A♥ | every heart doubles |
| Q♠ | −200 instead of −100 |
| J♦ | +200 instead of +100 |
| 10♣ | multiplies by 4 instead of 2; +100 alone |

An exposed card may not be played to the first trick in which its suit is led,
unless it is the holder's only card of that suit. `legalMoves` enforces this.

### Play

Thirteen cards each, follow suit if able, highest card of the led suit takes the
trick, no trump. The holder of 2♣ leads the first hand and must play it
(`options.firstLead: 'clubs2'`, or `'free'` to disable); later hands are led by
whoever took the pig.

### Scoring modes

Individual scores are always the source of truth. Passing `options.teams` adds team
totals as a pure aggregation on top — never a separate scoring path — so data
gathered from play stays valid under either mode.

A match ends when any side reaches `+targetScore` or `−targetScore` (default 1000).
If several sides cross at once the highest total wins outright, so the winner is
never ambiguous.

## API

```js
const engine = require('./src/engine');

let match = engine.createMatch({
  playerIds: ['a', 'b', 'c', 'd'],
  seed: 'reproducible',
  options: { variant: 'standard', teams: null, targetScore: 1000 },
});

match = engine.startHand(match);

const moves = engine.legalMoves(match, match.hand.turn);
const { match: next, events } = engine.playCard(match, match.hand.turn, moves[0]);
```

`observation(match, playerId)` returns exactly what one player may see — never
another player's cards. It is the feature vector for bots and the unit of self-play
logging — see `../selfplay/README.md`.

`events` is one of `card_played`, `trick_won`, `hand_complete`, `match_complete`.

## Determinism

`createRng`/`shuffled` back every deal, and each hand is seeded from
`` `${seed}:${handNumber}` ``, so hand N of a seed is reproducible without replaying
hands 1..N−1. The same seed always deals the same cards, forever.
