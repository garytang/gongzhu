# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Gongzhu (Chinese trick-taking card game) web application with real-time multiplayer functionality. The game requires exactly 4 players and implements the traditional Gongzhu scoring rules with hearts, Queen of Spades, Jack of Diamonds, and 10 of Clubs.

## Architecture

**Monorepo Structure:**
- `/backend/` - Node.js Express server with Socket.IO for real-time communication
- `/frontend/` - React TypeScript application with Socket.IO client
- Root package.json exists but project uses separate frontend/backend package management

**Real-time Communication:**
- Backend uses Socket.IO server on port 4000
- Frontend connects to `http://localhost:4000` 
- Key events: `register_handle`, `start_game`, `play_card`, `game_state`, `deal_hand`, `collected`, `game_over`

**Game State Management:**
- Backend maintains single global game state in memory
- Player identification uses both socket.id and persistent playerId (stored in localStorage)
- Game requires exactly 4 players to start
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
# Run all tests (recommended)
./test.sh

# Individual test suites
cd backend && npm test                    # Unit tests for game logic
cd backend && npm run test:integration   # Socket.IO integration tests
cd backend && npm run test:llm           # LLM bot player tests
cd backend && npm run test:all           # All backend tests
cd frontend && npm test                  # React component tests
```

**Test Coverage:**
- Backend: Game logic, scoring, trick resolution, Socket.IO communication, LLM bot integration
- Frontend: Component rendering, user interactions, turn logic, Socket.IO integration
- Integration: Real-time multiplayer communication
- LLM Bots: Card selection, strategy, provider integration, fallback mechanisms
- E2E: Placeholder for future Playwright/Cypress tests

## Key Implementation Details

**Card Game Logic:**
- 52-card deck, 13 cards per player
- Trick-taking with suit-following rules
- Scoring: Hearts (-10 to -50), Q♠ (-100), J♦ (+100), 10♣ (doubles/+50)
- "Shooting the moon" (collecting all hearts) = +200 points
- Scoring is based on teams of pairs of players; teams are chosen randomly; two players per team and the team score is the summation of individual scores
- After a game ends, the teams can optionally choose to continue playing; the teams stay the same and the winning team is the team that reaches +1000 points first or is not the team that reaches -1000 points first

**Player Management:**
- Players register with handle + persistent playerId
- Socket.IO manages connections/disconnections
- Game state tracks both socket IDs and player handles
- Player identification: socket.id used for internal game state, handles for UI display

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
- No linting or type checking commands currently configured
- Game state is not persisted - restarting backend resets all games
- CORS configured to allow all origins for development