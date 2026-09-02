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
app and the Socket.IO server and returns them without listening, so tests drive the real
server on an ephemeral port. It holds no rules of its own — legality, trick resolution
and scoring all come from the engine. Delays (`botDelayMs`, `trickDelayMs`,
`emptyRoomTtlMs`, `reconnectGraceMs`) are options so tests need not wait for them.
`rooms.js` holds the room model — join codes, options, seats, spectators, host
succession — with no knowledge of sockets or the engine.

**Rooms.** One server hosts many tables. A room owns its members, its options, its bots
and one engine session, and every table event is emitted to the Socket.IO room named by
the six-character join code. `/room/CODE` on the frontend is the invite link.
- Lifecycle: `waiting` → `playing` → `handOver` / `matchOver`, and back to `playing` when
  the host continues or starts a new game. Phase is derived from the engine, never
  tracked separately.
- An empty room is deleted on a timer (`emptyRoomTtlMs`, five minutes by default) rather
  than when the last member drops, so a refresh does not destroy the table.
- The creator hosts; the role passes to the next member when the host leaves. Only the
  host may `start_game`, `continue_game`, `update_room_options` or `kick`.
- Four seats. A fifth joiner spectates — they see the table and get no hand — and takes a
  seat when one frees before the next hand is dealt. Bots fill whatever seats are still
  empty when the host starts a hand.
- Room options: `variant` (`standard` | `pips`), `teams` (on/off), `targetScore`,
  `visibility` (`public` lists it in the lobby, `private` is invite-link only), and
  `onDisconnect` (`bot` hands a lost seat to a bot, `lobby` ends the hand).

**Real-time Communication:**
- Backend uses Socket.IO server on port 4000
- Frontend connects to `http://localhost:4000`
- Client to server: `register_handle`, `create_room`, `join_room`, `leave_room`,
  `list_rooms`, `update_room_options`, `kick`, `start_game`, `continue_game`, `play_card`
- Server to client, to the caller: `handle_registered`, `room_joined`, `room_left`,
  `room_error`, `room_list`, `invalid_play`
- Server to client, to one room: `room_state`, `player_list`, `game_started`,
  `game_state`, `deal_hand`, `legal_moves`, `collected`, `trick_won`, `game_over`,
  `player_disconnected`, `player_reconnected`, `seat_taken_by_bot`, `hand_abandoned`
- `deal_hand` and `legal_moves` go to one player; `legal_moves` accompanies every
  `deal_hand` and lists exactly the cards that player may play now (empty when it is not
  their turn, and while a completed trick is being displayed)
- `room_list` is pushed to sockets that are not in a room, whenever the public rooms change

**Game State Management:**
- All state is in memory, per room: `Map<code, room>`, each with its own engine session
  and its own bot registry
- Identity is the client's persistent `playerId`, resolved in exactly one place —
  `memberKey(socket)` in `createServer.js`
- Card dealing, trick resolution, and scoring handled server-side

**Frontend State:**
- Uses React Context (`PlayerContext`) for global state management: `room`, `roomList`,
  `roomError`, `isHost`, `isSpectator`, `connectionStatus`, plus the table state
- Routes: `/login`, `/lobby`, `/room/:code`. The room route renders the pre-game screen
  while the room is `waiting` and the table afterwards, so one URL is shareable
  throughout. The static host serves it with `serve -s`, which rewrites deep links
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
- Players register a handle, then create or join a room. Identity is a `playerId` the
  browser mints with `crypto.randomUUID()` and keeps in `localStorage` (with the handle),
  sent with every `register_handle` and confirmed back on `handle_registered`
- The server keys seats, room membership and every `io.to(...)` by that id, resolved in
  one place — `memberKey(socket)` in `createServer.js`. Each socket also joins a
  Socket.IO room named by the id, so all of a player's tabs receive their events and the
  last one to register names them. An id the server does not recognise as client-minted
  is refused and the socket id is used instead, which simply loses the reconnect guarantee
- **Reconnect.** A seated player who drops mid-match keeps their seat while a countdown
  runs (`reconnectGraceMs`, one minute by default). The table waits — no bot and no human
  plays for them — and the room broadcasts `player_disconnected {playerId, handle,
  deadline}`, with the same fact on `room_state.absent` for anyone arriving mid-countdown.
  Rejoining with the same `playerId` cancels it, re-sends `game_state`, `collected`,
  `deal_hand` and `legal_moves` to the returning socket, and broadcasts
  `player_reconnected`
- On timeout, the room option `onDisconnect` decides. `'bot'` (the default) seats a bot
  under the departed id — a dealt hand is fixed to four player ids, so a replacement has
  to answer to the id it replaces — broadcasts `seat_taken_by_bot`, and leaves the human
  to return as a spectator; the seat is no longer theirs to play. `'lobby'` ends the hand,
  broadcasts `hand_abandoned` and returns the room to `waiting`
- Leaving or being kicked mid-match takes the same path, so no route out of a seat can
  wedge the table. A drop while the room is still `waiting` frees the seat immediately

**UI Features:**
- Lobby: create a room (name, visibility, variant, teams, target score, disconnect
  policy), a public room list, and join by code
- Room screen: the code shown large with a copy-invite-link button, seated players with a
  host badge, spectators, options (editable by the host), host-only Start, and Leave
- Spectator view: the table with no hand and a "Spectating" label
- Reconnect overlay on the table naming who dropped and how long they have to return
- Team-based scoring display (players 0&2 vs 1&3), or per-player scores when the room has
  teams off
- Real-time trick display with card color coding  
- Live progress display of each player's collected point cards
- Clickable player tiles to view collected cards in modal
- Game over modal with team scores and collected cards
- Visually distinguish individuals that belong to the same team

**Collected Cards System:**
- Backend tracks collected cards by `playerId` in the engine's `collected` object
- Real-time updates emitted via `collected` event after each trick completion
- Frontend displays only point cards (♥, Q♠, J♦, 10♣) with proper color coding
- During gameplay: collected cards keyed by `playerId` for real-time display
- Game over: collected cards converted to player handles for final summary

**LLM Bot System:**
- Supports multiple LLM providers: Anthropic Claude, Google Gemini, OpenRouter
- Intelligent game analysis considering hand, trick state, collected cards, team dynamics
- Robust fallback to enhanced rule-based AI when LLM fails
- Game memory tracking played cards and player tendencies
- Strategic decision making with various gameplay strategies
- Bots are created by `start_game`, which only a room's host may send, and belong to that
  room. There is no bot HTTP API: `/api/bots/*` was removed because it was unauthenticated
  on a public URL and would let a stranger seat bots at someone else's table
- `LLM_PROVIDER` (anthropic | openrouter | google) picks which provider fills empty seats; unset = first key present. Keys: `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`; models: `*_MODEL`
- Seamless integration with existing Socket.IO game flow

## Development Notes

- Backend logs to `backend.log`, frontend to `frontend.log` when using test script
- CI runs on every push (`.github/workflows/ci.yml`): backend tests, frontend typecheck
  and build, plus a self-play smoke run
- No linter configured yet
- Game state is not persisted - restarting backend resets all games
- CORS configured to allow all origins for development