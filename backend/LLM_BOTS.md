# LLM bot players

A seat at the table can be played by an LLM. The bot is given an **observation** — the
same information a human in that seat has — and asked for one card.

## How it fits together

| File | Role |
| --- | --- |
| `src/bots/observation.js` | Builds an engine-shaped observation, including from the legacy `game` object |
| `src/bots/prompt.js` | Renders an observation as the prompt for one move |
| `src/bots/llm-policy.js` | `createLLMPolicy(config)` → `{ name, choose(observation, ctx) }` |
| `src/bots/providers.js` | HTTP clients for Anthropic, Google and OpenRouter |
| `llm-bot-player.js` | `LLMBotPlayer`, the adapter the Socket.IO server calls |

Bots see only what `engine.observation(match, playerId)` exposes: their own hand, the
legal moves, the cards on the table, the point cards each player has collected, how many
cards each player has left, the running scores, who their teammate is, exposed cards and
the scoring variant. No other player's hand ever reaches a provider.

The legacy `game` object that `index.js` passes to bots *does* contain every hand.
`observationFromLegacy` reads only the public fields from it, so that leak is structurally
closed rather than merely unused.

## Models

Defaults are the cheap, fast option in each family — a Gongzhu move is a small decision
made 52 times a hand, so per-move cost and latency dominate. Override with the environment
variable, or per bot with `llmConfig.model`.

| Provider | Env var | Default (fast, cheap) | Stronger |
| --- | --- | --- | --- |
| Anthropic | `ANTHROPIC_MODEL` | `claude-haiku-4-5` | `claude-sonnet-5`, then `claude-opus-5` |
| Google | `GOOGLE_MODEL` | `gemini-3.5-flash-lite` | `gemini-3.7-flash` |
| OpenRouter | `OPENROUTER_MODEL` | `anthropic/claude-haiku-4.5` | `anthropic/claude-sonnet-5` |

Retired model IDs that used to appear here and in deployment config — `claude-3-5-haiku-*`
(retired 2026-02-19), `claude-3-haiku-*` (retired 2026-04-20) and `gemini-1.5-*` — no
longer resolve. A request naming one fails, and the bot silently plays the heuristic
fallback for every move.

`temperature` is not sent to Anthropic: Claude 4.7 and later reject a non-default value
with a 400.

## Configuration

```bash
ANTHROPIC_API_KEY=...      # or GOOGLE_API_KEY / OPENROUTER_API_KEY
ANTHROPIC_MODEL=claude-haiku-4-5
LLM_BOT_DEBUG=1            # log each prompt, raw response and parsed reasoning
```

Keys: [Anthropic Console](https://console.anthropic.com/),
[Google AI Studio](https://aistudio.google.com/apikey),
[OpenRouter](https://openrouter.ai/keys).

## One move

1. `LLMBotPlayer.selectCard(hand, trick, gameState)` resolves an observation —
   `gameState.observation` when the server supplies one, otherwise reconstructed from the
   legacy fields.
2. If exactly one move is legal it is played without calling the model at all.
3. `buildPrompt` renders the observation. The prompt is capped at 8,000 characters.
4. The provider is called with a deadline (5s by default, `llmConfig.timeoutMs`). A
   provider that hangs loses its turn rather than stalling the table.
5. The reply is parsed for `<played_card>`, falling back to scanning the whole response
   for a card named in `legalMoves`.
6. Anything short of a legal card — timeout, HTTP error, garbage, an illegal card — falls
   through to a fallback policy: `avoidPoints` from `src/selfplay/policies.js` by default,
   or any policy passed as `llmConfig.fallback`.

Expected reply:

```xml
<reasoning>one or two sentences</reasoning>
<played_card>A♠</played_card>
```

## As a self-play policy

`createLLMPolicy` returns the `Policy` shape used by `src/selfplay/`, so an LLM can be
evaluated head-to-head against the heuristics:

```javascript
const { createLLMPolicy } = require('./src/bots/llm-policy');

const policy = createLLMPolicy({ provider: 'anthropic', model: 'claude-haiku-4-5' });
const card = await policy.choose(engine.observation(match, playerId));
```

`choose` is **async**, unlike the synchronous heuristic policies. A runner must `await` it.

## HTTP API

```bash
POST /api/bots/create   {"type":"llm","llmConfig":{"handle":"Claude Bot","provider":"anthropic"}}
GET  /api/bots/list
DELETE /api/bots/clear
```

`/api/bots/list` reports the resolved provider and model per bot. `llmConfig` accepts
`handle`, `provider`, `model`, `apiKey` and `timeoutMs`. The old `fallbackDifficulty` key
is accepted and ignored — the fallback is a policy now, not a difficulty tier.

## Testing

```bash
npm run test:llm
```

Tests inject a stub provider — an object with `generateResponse(prompt, options)` — into
`llmConfig.provider`, so the suite needs no API key and makes no network calls. The same
hook is the way to script provider behaviour (valid card, illegal card, garbage, throw,
hang) in any new test.
