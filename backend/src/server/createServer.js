'use strict';

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const engine = require('../engine');
const { createBotRegistry } = require('./bots');
const { PROVIDER_KEYS } = require('../bots/providers');

const { SEATS } = engine;

/**
 * Resolve the allowed CORS origins. `CORS_ORIGIN` is a comma-separated list; an entry
 * without a scheme gets `https://`, because a browser sends a full origin and the
 * comparison is verbatim, so a bare hostname never matches. An unset value allows any
 * origin in development and is fatal in production.
 */
function corsOrigins(value = process.env.CORS_ORIGIN, env = process.env.NODE_ENV) {
  const entries = String(value || '').split(',').map(entry => entry.trim()).filter(Boolean);
  if (entries.length === 0) {
    if (env === 'production') {
      throw new Error('CORS_ORIGIN must list the allowed origins in production');
    }
    return '*';
  }
  return entries.map(origin => (/^[a-z][a-z0-9+.-]*:\/\//i.test(origin) ? origin : `https://${origin}`));
}

/**
 * Which LLM provider fills empty seats. `LLM_PROVIDER` names one explicitly and must
 * have its key set; otherwise the first provider in `PROVIDER_KEYS` order whose key is
 * present is used. Returns null when no provider is usable, in which case seats are
 * filled with rule-based bots.
 */
function resolveLLMProvider(env = process.env) {
  const chosen = String(env.LLM_PROVIDER || '').trim().toLowerCase();
  if (chosen) {
    if (!PROVIDER_KEYS[chosen]) {
      throw new Error(`Unknown LLM_PROVIDER "${chosen}"; expected one of ${Object.keys(PROVIDER_KEYS).join(', ')}`);
    }
    if (!env[PROVIDER_KEYS[chosen]]) {
      throw new Error(`LLM_PROVIDER is ${chosen} but ${PROVIDER_KEYS[chosen]} is not set`);
    }
    return chosen;
  }
  return Object.keys(PROVIDER_KEYS).find(name => env[PROVIDER_KEYS[name]]) || null;
}

/**
 * The Socket.IO adapter over the rules engine.
 *
 * All rules live in `src/engine`. This file owns only what the engine deliberately does
 * not have: sockets, handles, bots, and the timers that pace the table for human eyes.
 *
 * A "session" is one seating of four players; `session.match` is engine state, replaced
 * wholesale on every play. Anything asynchronous captures its session and checks
 * `retired` before touching the table, so a game started while a timer or an LLM call is
 * in flight is never corrupted by the old one finishing.
 */
function createGongzhuServer({
  botDelayMs = 1000,
  trickDelayMs = 1000,
  corsOrigin = corsOrigins(),
  llmProvider = resolveLLMProvider(),
  targetScore = 1000,
  log = console,
} = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: false },
    transports: ['websocket', 'polling'],
  });

  const players = new Map(); // socketId -> handle, humans and bots alike
  const botRegistry = createBotRegistry(log);
  let session = null;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const handleOf = id => players.get(id) || id;
  const seatHandles = s => s.match.playerIds.map(id => ({ playerId: id, handle: handleOf(id) }));

  // --- Lobby -----------------------------------------------------------------

  function broadcastPlayerList() {
    io.emit('player_list', [...players.entries()].map(([playerId, handle]) => ({
      playerId,
      handle,
      isBot: botRegistry.has(playerId),
    })));
  }

  function removeAllBots() {
    for (const id of botRegistry.removeAll()) players.delete(id);
  }

  function seat(bot) {
    players.set(bot.socketId, bot.handle);
    return bot;
  }

  // --- Broadcasting ----------------------------------------------------------

  /**
   * The public view of the table. While a completed trick is held on screen the client
   * is shown the trick as it finished, not the position the engine has already moved to.
   */
  function stateFor(s) {
    const hand = s.match.hand;
    return {
      trick: s.displayTrick ? s.displayTrick.trick : hand.trick,
      turn: s.displayTrick ? s.displayTrick.turn : s.match.playerIds.indexOf(hand.turn || hand.leader),
      playerHandles: seatHandles(s),
      scores: s.match.totals,
      teams: s.match.options.teams,
      cumulativeTeamScores: s.match.teamTotals,
      lastTrick: hand.lastTrick,
    };
  }

  const broadcastGameState = s => io.emit('game_state', stateFor(s));

  /** Each human sees their own hand and the cards they may play from it. */
  function broadcastHands(s) {
    for (const id of s.match.playerIds) {
      if (botRegistry.has(id)) continue;
      io.to(id).emit('deal_hand', s.match.hand.hands[id]);
      io.to(id).emit('legal_moves', s.displayTrick ? [] : engine.legalMoves(s.match, id));
    }
  }

  function emitGameOver(s) {
    const result = s.match.results[s.match.results.length - 1];
    const outcome = s.match.outcome;
    const teamInfo = {};
    for (const team of ['team1', 'team2']) {
      teamInfo[team] = {
        players: s.match.options.teams[team].map(handleOf),
        roundScore: result.teamScores[team],
        cumulativeScore: s.match.teamTotals[team],
      };
    }
    // The engine resolves a simultaneous crossing in favour of the higher total, so
    // there is exactly one winning team unless the two totals are equal.
    const decided = outcome && outcome.winners.length === 1;
    io.emit('game_over', {
      scores: result.individual,
      collected: Object.fromEntries(
        Object.entries(result.collected).map(([id, cards]) => [handleOf(id), cards])),
      teamInfo,
      gameEnded: Boolean(outcome),
      winningTeam: decided ? Number(outcome.winners[0].replace('team', '')) : null,
    });
    log.log(`Hand ${result.handNumber} over.`, teamInfo);
  }

  // --- Play ------------------------------------------------------------------

  function applyPlay(s, playerId, card) {
    const { match, events } = engine.playCard(s.match, playerId, card);
    s.match = match;

    const won = events.find(e => e.type === 'trick_won');
    if (won) {
      // Hold the finished trick on screen; the engine has already dealt with it.
      s.displayTrick = { trick: won.trick, turn: s.match.playerIds.indexOf(playerId) };
      s.trickTimer = setTimeout(() => revealAfterTrick(s), trickDelayMs);
      io.emit('trick_won', { winner: won.winner, cards: won.cards, trick: won.trick });
    }

    broadcastHands(s);
    broadcastGameState(s);
    if (!won) runBots(s);
  }

  function revealAfterTrick(s) {
    if (s.retired) return;
    s.trickTimer = null;
    s.displayTrick = null;

    io.emit('collected', s.match.hand.collected);
    broadcastHands(s);
    broadcastGameState(s);

    if (s.match.phase === 'playing') runBots(s);
    else emitGameOver(s);
  }

  /**
   * Play out consecutive bot turns. One loop runs at a time; it stops whenever the table
   * is no longer the bots' to act on, and is restarted by whatever changes that.
   */
  function runBots(s) {
    if (s.retired || s.botLoop) return;
    s.botLoop = true;
    (async () => {
      while (!s.retired && !s.displayTrick && s.match.phase === 'playing'
             && botRegistry.has(s.match.hand.turn)) {
        const botId = s.match.hand.turn;
        const observation = engine.observation(s.match, botId);

        // The delay only paces plays for human eyes, so let a bot think through it
        // rather than after it.
        const [card] = await Promise.all([
          botRegistry.get(botId).chooseCard(observation),
          sleep(botDelayMs),
        ]);
        if (s.retired || s.match.hand.turn !== botId) return;

        log.log(`Bot ${handleOf(botId)} plays ${card}`);
        applyPlay(s, botId, card);
      }
    })()
      .catch(error => log.error('Bot turn failed:', error))
      .finally(() => { s.botLoop = false; });
  }

  /**
   * The shape `LLMBotPlayer` builds its prompts from, projected from the live table.
   * `observation` is the engine's own view of the same position; when the prompt reads
   * that directly this projection goes away.
   */
  function describeTable(observation) {
    const s = session;
    return {
      playerOrder: s.match.playerIds,
      playerHandles: seatHandles(s),
      scores: s.match.totals,
      teams: s.match.options.teams,
      turn: observation.seat,
      collected: s.match.hand.collected,
      observation,
    };
  }

  // --- Starting a game -------------------------------------------------------

  const newSeed = () => `${Date.now()}-${Math.random()}`;

  function begin(match) {
    if (session) {
      session.retired = true;
      clearTimeout(session.trickTimer);
    }
    session = { match, displayTrick: null, trickTimer: null, botLoop: false, retired: false };
    io.emit('game_started');
    io.emit('collected', match.hand.collected);
    broadcastHands(session);
    broadcastGameState(session);
    runBots(session);
    return session;
  }

  /** New teams, new seats: random pairs, seated so that teammates are never adjacent. */
  function startGame() {
    const humans = [...players.keys()].filter(id => !botRegistry.has(id));
    if (humans.length === 0) return null;

    removeAllBots();
    const seats = humans.slice(0, SEATS);
    while (seats.length < SEATS) {
      const bot = llmProvider
        ? botRegistry.createLLMBot({ provider: llmProvider, fallbackDifficulty: 'hard' }, describeTable)
        : botRegistry.createBot('easy');
      seats.push(seat(bot).socketId);
    }
    broadcastPlayerList();

    const [a, b, c, d] = engine.shuffled(seats, Math.random);
    return begin(engine.startHand(engine.createMatch({
      playerIds: [a, b, c, d],
      seed: newSeed(),
      options: {
        teams: { team1: [a, c], team2: [b, d] },
        variant: 'standard',
        firstLead: 'clubs2',
        targetScore,
      },
    })));
  }

  /**
   * Deal the next hand to the same four players. A match that has already been won
   * starts over from zero rather than running past the target score.
   */
  function continueGame() {
    if (!session) return null;
    const { match } = session;
    return begin(engine.startHand(match.phase === 'matchComplete'
      ? engine.createMatch({ playerIds: match.playerIds, seed: newSeed(), options: match.options })
      : match));
  }

  // --- HTTP ------------------------------------------------------------------

  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());

  app.get('/', (req, res) => res.send('Gongzhu backend is running!'));

  app.post('/api/bots/create', (req, res) => {
    try {
      const { type = 'regular', difficulty = 'easy', llmConfig = {} } = req.body || {};
      const bot = seat(type === 'llm'
        ? botRegistry.createLLMBot(llmConfig, describeTable)
        : botRegistry.createBot(difficulty));
      broadcastPlayerList();
      res.json({ success: true, bot: botRegistry.describe(bot) });
    } catch (error) {
      log.error('Error creating bot:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/bots/clear', (req, res) => {
    removeAllBots();
    broadcastPlayerList();
    res.json({ success: true, message: 'All bots removed' });
  });

  app.get('/api/bots/list', (req, res) => {
    res.json({ success: true, bots: botRegistry.list() });
  });

  // --- Sockets ---------------------------------------------------------------

  io.on('connection', (socket) => {
    log.log('A user connected:', socket.id);
    broadcastPlayerList();

    socket.on('register_handle', (data) => {
      const handle = typeof data === 'string' ? data : data && data.handle;
      if (!handle) return;
      players.set(socket.id, handle);
      log.log(`Registered handle: ${handle} (${socket.id})`);
      broadcastPlayerList();
    });

    socket.on('start_game', () => {
      if (!startGame()) log.log('Need at least 1 human player to start a game');
    });

    socket.on('continue_game', () => {
      if (!continueGame()) log.log('Cannot continue - no game has been started');
    });

    socket.on('play_card', (card) => {
      const s = session;
      if (!s || s.displayTrick || s.match.phase !== 'playing') return;
      if (!engine.legalMoves(s.match, socket.id).includes(card)) {
        log.log('Invalid play by', socket.id, card);
        socket.emit('invalid_play', card);
        return;
      }
      applyPlay(s, socket.id, card);
    });

    socket.on('disconnect', () => {
      log.log('User disconnected:', socket.id, players.get(socket.id));
      players.delete(socket.id);
      broadcastPlayerList();
    });
  });

  return {
    app,
    io,
    server,
    players,
    bots: botRegistry,
    getSession: () => session,
    /** Stop the table and release the port. Closing `io` closes the HTTP server too. */
    async close() {
      if (session) {
        session.retired = true;
        clearTimeout(session.trickTimer);
        session = null;
      }
      await new Promise(resolve => io.close(resolve));
    },
  };
}

module.exports = { createGongzhuServer, corsOrigins, resolveLLMProvider };
