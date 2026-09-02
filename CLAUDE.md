# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Gongzhu (Chinese trick-taking card game) web application with real-time multiplayer functionality. The game requires exactly 4 players and implements the traditional Gongzhu scoring rules with hearts, Queen of Spades, Jack of Diamonds, and 10 of Clubs.

## Architecture

**Monorepo Structure:**
- `/backend/src/engine/` - Pure, deterministic rules engine (no sockets, no timers, no globals)
- `/backend/src/selfplay/` - Headless bot-vs-bot harness that generates training data
- `/backend/src/server/` - Express + Socket.IO adapter over the engine; `index.js` only listens
- `/frontend/` - React TypeScript application with Socket.IO client
- Root package.json exists but project uses separate frontend/backend package management

**Rules engine (`backend/src/engine/`):**
- Every function takes a state and returns a new one, so the same code backs the
  multiplayer server, the unit tests, and the self-play harness.
- Deals are seeded and reproducible; hand N of a seed is derivable without replaying
  hands 1..N-1.
- `observation(match, playerId)` returns only what one player may legitimately see.
- See `backend/src/engine/README.md` for the full ruleset and citations.

**Server (`backend/src/server/`):** `createGongzhuServer(options)` builds the express
app, the Socket.IO server and one table, and returns them without listening, so tests
drive the real server on an ephemeral port. It holds no rules of its own — legality,
trick resolution and scoring all come from the engine. Delays (`botDelayMs`,
`trickDelayMs`) are options so tests need not wait for them.

**Real-time Communication:**
- Backend uses Socket.IO server on port 4000
- Frontend connects to `http://localhost:4000` 
- Client to server: `register_handle`, `start_game`, `continue_game`, `play_card`
- Server to client: `player_list`, `game_started`, `game_state`, `deal_hand`, `legal_moves`, `collected`, `game_over`, `invalid_play`
- `legal_moves` accompanies every `deal_hand` and lists exactly the cards that player may play now (empty when it is not their turn)

**Game State Management:**
- Backend maintains single global game state in memory
- Player identification uses both socket.id and persistent playerId (stored in localStorage)
- Four seats: the first four registered humans are seated and the rest are filled with bots on `start_game`
- Card dealing, trick resolution, and scoring handled server-side

**Frontend State:**
- Uses React Context (`PlayerContext`) for global state management
- Persistent player ID generation using crypto.randomUUID()
- Real-time hand updates and game state synchronization

## Development Commands

**Start Development:**
```bash
# Start both frontend and backend development servers
./test_gongzhu.sh
```

**Manual Development:**
```bash
# Backend (runs on port 4000)
cd backend && npm start

# Frontend (runs on port 3000) 
cd frontend && npm start
cd frontend && npm run build  # Production build
```

**Testing:**
```bash
cd backend && npm test                   # Engine + self-play tests (the real suite)
cd backend && npm run test:engine        # Rules engine only
cd backend && npm run test:selfplay      # Self-play harness only
cd backend && npm run test:integration   # Socket.IO integration tests
cd backend && npm run test:llm           # LLM bot player tests
cd backend && npm run test:all           # Everything
cd frontend && npm test                  # React component tests
cd frontend && npx tsc --noEmit          # Typecheck
```

Tests import production code directly. Never re-implement game logic inside a test
file — that was the previous state of `test/game-logic.test.js`, and it meant the
suite passed regardless of what the server actually did.

**Self-play / training data:**
```bash
cd backend && npm run selfplay -- --games 1000 --out data/selfplay.jsonl
```
See `backend/src/selfplay/README.md` for the record format.

**Test Coverage:**
- Backend: Game logic, scoring, trick resolution, Socket.IO communication, LLM bot integration
- Frontend: Component rendering, user interactions, turn logic, Socket.IO integration
- Integration: Real-time multiplayer communication
- LLM Bots: Card selection, strategy, provider integration, fallback mechanisms
- E2E: Placeholder for future Playwright/Cypress tests

## Key Implementation Details

**Card Game Logic:**
- 52-card deck, 13 cards per player, no trump; highest card of the led suit takes the trick
- Holder of 2♣ leads the first hand and must play it; later hands are led by the pig-taker
- Q♠ (豬) −100, J♦ (羊) +100, 10♣ (變壓器) +50 alone else doubles that player's total
- Hearts: A/K/Q/J = −50/−40/−30/−20, 10♥–5♥ = −10 each, 4♥/3♥/2♥ = 0
- A `pips` variant (number cards score their pip value, except 4♥ = −10) is selectable;
  both tables total −200 across the suit
- 全紅 (all hearts) +200, +300 with the pig, 小滿貫 +400, 大滿貫 +800, fully exposed +3200
- 亮牌 (exposure) doubling is implemented in scoring; the declare phase is behind
  `options.exposuresEnabled` and off by default
- Individual scores are the source of truth. Teams, when configured, are a pure
  aggregation on top — never a separate scoring path
- A match ends when any side reaches +1000 or −1000; simultaneous crossings resolve to
  the highest total, so the winner is never ambiguous

**Player Management:**
- Players register with a handle; identity is currently the raw `socket.id`
- KNOWN GAP: there is no persistent player id and no localStorage. A refresh makes you
  a new player and you lose your seat. Reconnection is not implemented — a disconnect
  mid-hand wedges the table, because the departed socket id stays in `playerOrder` and
  no human or bot can ever take its turn
- KNOWN GAP: a single global game and player map, so only one table can exist per server

**UI Features:**
- Team-based scoring display (players 0&2 vs 1&3)
- Real-time trick display with card color coding  
- Live progress display of each player's collected point cards
- Clickable player tiles to view collected cards in modal
- Game over modal with team scores and collected cards
- Visually distinguish individuals that belong to the same team

**Collected Cards System:**
- Backend tracks collected cards by socket.id in `game.collected` object
- Real-time updates emitted via `collected` event after each trick completion
- Frontend displays only point cards (♥, Q♠, J♦, 10♣) with proper color coding
- During gameplay: collected cards keyed by socket.id for real-time display
- Game over: collected cards converted to player handles for final summary

**LLM Bot System:**
- Supports multiple LLM providers: Anthropic Claude, Google Gemini, OpenRouter
- Intelligent game analysis considering hand, trick state, collected cards, team dynamics
- Robust fallback to enhanced rule-based AI when LLM fails
- Game memory tracking played cards and player tendencies
- Strategic decision making with various gameplay strategies
- API endpoints for bot management: `/api/bots/create`, `/api/bots/list`, `/api/bots/clear`
- Environment variables for API keys: `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`
- Seamless integration with existing Socket.IO game flow

## Development Notes

- Backend logs to `backend.log`, frontend to `frontend.log` when using test script
- CI runs on every push (`.github/workflows/ci.yml`): backend tests, frontend typecheck
  and build, plus a self-play smoke run
- No linter configured yet
- Game state is not persisted - restarting backend resets all games
- CORS configured to allow all origins for development