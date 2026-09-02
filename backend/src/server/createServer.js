'use strict';

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const engine = require('../engine');
const { createBotRegistry } = require('./bots');
const { PROVIDER_KEYS } = require('../bots/providers');
const rooms = require('./rooms');

const { SEATS, RoomError } = rooms;

/** Sockets that are not in a room, so the room list can be pushed to them. */
const LOBBY = 'lobby';

const MAX_HANDLE_LENGTH = 24;

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
 * not have: sockets, handles, bots, rooms, and the timers that pace the table for human
 * eyes.
 *
 * One server hosts many tables. A room (see `rooms.js`) holds its members, its bots and
 * one "session": one seating of four players, where `session.match` is engine state,
 * replaced wholesale on every play. Anything asynchronous captures its session and
 * checks `retired` before touching the table, so a game started while a timer or an LLM
 * call is in flight is never corrupted by the old one finishing. Every table event is
 * emitted to the Socket.IO room named by the join code, never to the whole server.
 */
function createGongzhuServer({
  botDelayMs = 1000,
  trickDelayMs = 1000,
  /** How long an empty room is kept, so that a refresh does not destroy the table. */
  emptyRoomTtlMs = 5 * 60 * 1000,
  /** How long a seat is held for a player who drops in the middle of a match. */
  reconnectGraceMs = 60 * 1000,
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

  const handles = new Map(); // memberId -> handle
  const registry = new Map(); // room code -> room
  const roomOf = new Map(); // memberId -> room code
  const sockets = new Map(); // memberId -> Set of live socket ids

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * A member's own name. Bots are not members, so use `handleAt` for anything that can
   * be a seat: a bot that took over a seat answers to the departed player's id, and that
   * player keeps their name for as long as they are in the room as a spectator.
   */
  const handleOf = id => handles.get(id) || id;
  const describeMember = id => ({ playerId: id, handle: handleOf(id) });

  /** The name shown for a seat: a bot's own when a bot holds it, otherwise the member's. */
  function handleAt(room, id) {
    const bot = room.bots.get(id);
    return bot ? bot.handle : handleOf(id);
  }

  const seatHandles = s =>
    s.match.playerIds.map(id => ({ playerId: id, handle: handleAt(s.room, id) }));

  /**
   * The key a seat and a room membership are held under: the id the client generated
   * once and keeps in `localStorage`, so that a new socket after a refresh or a drop is
   * recognised as the same player. Every lookup in this file follows from this one
   * function. Socket.IO puts each socket in a room named by its own id, and
   * `bindIdentity` adds a room named by the persistent id, which is what keeps every
   * `io.to(memberId)` and `io.in(memberId)` below addressing the player rather than one
   * of their connections.
   */
  const memberKey = socket => socket.data.playerId || socket.id;

  const roomFor = socket => registry.get(roomOf.get(memberKey(socket)));

  /**
   * A client-supplied id is echoed to everyone at the table and used as a Socket.IO room
   * name, so only an opaque token shaped like the `crypto.randomUUID()` the client mints
   * is accepted; anything else falls back to the socket id, which is per-connection and
   * therefore simply loses the reconnect guarantee rather than breaking anything.
   */
  const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

  /**
   * Ties a socket to a persistent player id, once. A socket keeps the identity it first
   * registered with: re-registering under a different id would strand the room
   * membership, the seat and the bots' knowledge of this player under the old key.
   */
  function bindIdentity(socket, given) {
    if (!socket.data.playerId) {
      socket.data.playerId = PLAYER_ID_PATTERN.test(String(given || '')) ? given : socket.id;
      socket.join(socket.data.playerId);
      const known = sockets.get(socket.data.playerId);
      if (known) known.add(socket.id);
      else sockets.set(socket.data.playerId, new Set([socket.id]));
    }
    return socket.data.playerId;
  }

  // --- Room membership -------------------------------------------------------

  const toRoom = (room, event, payload) => io.to(room.code).emit(event, payload);

  function roomState(room) {
    return {
      code: room.code,
      name: room.name,
      host: room.hostId ? describeMember(room.hostId) : null,
      options: room.options,
      seats: room.seats.map(describeMember),
      spectators: room.spectators.map(describeMember),
      capacity: SEATS,
      phase: rooms.phaseOf(room),
      // Sent with the room rather than only as an event, so a client that arrives or
      // refreshes in the middle of a countdown still sees it.
      absent: [...room.absent].map(([id, { deadline }]) => ({ ...describeMember(id), deadline })),
    };
  }

  /** Who is at the table: the seated members plus the bots filling the rest. */
  function roomPlayerList(room) {
    const botIds = room.bots.ids();
    return [...room.seats, ...botIds].map(id => ({
      playerId: id,
      handle: handleAt(room, id),
      isBot: botIds.includes(id),
    }));
  }

  function publicRooms() {
    return [...registry.values()]
      .filter(room => room.options.visibility === 'public')
      .map(room => ({
        code: room.code,
        name: room.name,
        host: room.hostId ? handleOf(room.hostId) : null,
        seats: room.seats.length,
        capacity: SEATS,
        phase: rooms.phaseOf(room),
      }));
  }

  const broadcastRoomList = () => io.to(LOBBY).emit('room_list', publicRooms());

  function broadcastRoom(room) {
    toRoom(room, 'room_state', roomState(room));
    toRoom(room, 'player_list', roomPlayerList(room));
    broadcastRoomList();
  }

  /**
   * Deletion is a timer rather than an immediate consequence of the last member
   * leaving, so that a refresh or a brief drop does not take the table down with it.
   */
  function scheduleDeletion(room) {
    if (room.deleteTimer || rooms.members(room).length > 0) return;
    room.deleteTimer = setTimeout(() => deleteRoom(room), emptyRoomTtlMs);
    if (room.deleteTimer.unref) room.deleteTimer.unref();
  }

  function deleteRoom(room) {
    room.deleteTimer = null;
    if (rooms.members(room).length > 0) return;
    forgetAbsences(room);
    retire(room.session);
    room.bots.removeAll();
    registry.delete(room.code);
    log.log(`Room ${room.code} deleted after ${emptyRoomTtlMs}ms empty`);
    // A private room was never in the listing, so its removal changes nothing there.
    if (room.options.visibility === 'public') broadcastRoomList();
  }

  /**
   * Moves a membership between the lobby channel and a room. Every socket holding the
   * membership moves, not just the one that asked: a player may have any number of tabs
   * open, and the ones left behind would otherwise miss every table event.
   */
  function attach(memberId, { join: joined, leave }) {
    io.in(memberId).socketsLeave(leave);
    io.in(memberId).socketsJoin(joined);
  }

  function join(socket, room) {
    const memberId = memberKey(socket);
    clearTimeout(room.deleteTimer);
    room.deleteTimer = null;

    const role = rooms.admit(room, memberId);
    roomOf.set(memberId, room.code);
    attach(memberId, { leave: LOBBY, join: room.code });

    socket.emit('room_joined', { code: room.code, role });
    if (cancelAbsence(room, memberId)) {
      toRoom(room, 'player_reconnected', describeMember(memberId));
      log.log(`${handleOf(memberId)} reclaimed their seat in room ${room.code}`);
    }
    broadcastRoom(room);

    // A late arrival — or a returning one — sees the table as it stands rather than
    // waiting for the next play. A seat a bot has since taken over is not theirs to
    // play, so no hand goes back to them.
    const s = room.session;
    if (s) {
      socket.emit('collected', s.match.hand.collected);
      socket.emit('game_state', stateFor(s));
      if (seatedInMatch(room, memberId)) sendHand(s, memberId, socket);
    }
    log.log(`${handleOf(memberId)} joined room ${room.code} as ${role}`);
  }

  function leaveRoom(memberId) {
    const code = roomOf.get(memberId);
    if (code === undefined) return;
    roomOf.delete(memberId);
    attach(memberId, { leave: code, join: LOBBY });

    const room = registry.get(code);
    if (!room) return;
    cancelAbsence(room, memberId);
    const wasPlaying = seatedInMatch(room, memberId);
    rooms.release(room, memberId);
    if (wasPlaying) seatEmptied(room, memberId);
    if (rooms.members(room).length === 0) scheduleDeletion(room);
    // Reaches the leaver too: they are back in the lobby channel by now.
    broadcastRoom(room);
  }

  /**
   * The one way out of a room, whether the member asked, the host removed them, or the
   * table closed under them. `reason` is shown to them when they did not choose it.
   */
  function exit(memberId, reason) {
    if (reason) io.to(memberId).emit('room_error', { reason });
    io.to(memberId).emit('room_left');
    leaveRoom(memberId);
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

  const broadcastGameState = s => toRoom(s.room, 'game_state', stateFor(s));

  /**
   * One player's private view: their cards, and the ones they may play right now. The
   * target is every socket holding that identity, or a single one when only an arriving
   * connection needs catching up.
   */
  function sendHand(s, memberId, target) {
    target.emit('deal_hand', s.match.hand.hands[memberId]);
    target.emit('legal_moves', s.displayTrick ? [] : engine.legalMoves(s.match, memberId));
  }

  /** Each human at the table sees their own hand and the cards they may play from it. */
  function broadcastHands(s) {
    for (const id of s.match.playerIds) {
      if (!s.room.bots.has(id)) sendHand(s, id, io.to(id));
    }
  }

  function emitGameOver(s) {
    const result = s.match.results[s.match.results.length - 1];
    const outcome = s.match.outcome;
    const teams = s.match.options.teams;

    let teamInfo = null;
    if (teams) {
      teamInfo = {};
      for (const team of ['team1', 'team2']) {
        teamInfo[team] = {
          players: teams[team].map(id => handleAt(s.room, id)),
          roundScore: result.teamScores[team],
          cumulativeScore: s.match.teamTotals[team],
        };
      }
    }
    // The engine resolves a simultaneous crossing in favour of the higher total, so
    // there is exactly one winner unless the leading totals are equal.
    const decided = outcome && outcome.winners.length === 1;
    toRoom(s.room, 'game_over', {
      scores: result.individual,
      collected: Object.fromEntries(
        Object.entries(result.collected).map(([id, cards]) => [handleAt(s.room, id), cards])),
      teamInfo,
      gameEnded: Boolean(outcome),
      winningTeam: decided && teams ? Number(outcome.winners[0].replace('team', '')) : null,
      // Handles of the winning players, which is the only form of the result that
      // means anything when the room is scoring individuals rather than teams.
      winners: outcome ? outcome.winners.map(name => (teams ? name : handleAt(s.room, name))) : [],
    });
    log.log(`Room ${s.room.code}: hand ${result.handNumber} over.`, teamInfo || result.individual);
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
      toRoom(s.room, 'trick_won', { winner: won.winner, cards: won.cards, trick: won.trick });
    }

    broadcastHands(s);
    broadcastGameState(s);
    if (!won) runBots(s);
  }

  function revealAfterTrick(s) {
    if (s.retired) return;
    s.trickTimer = null;
    s.displayTrick = null;

    toRoom(s.room, 'collected', s.match.hand.collected);
    broadcastHands(s);
    broadcastGameState(s);

    if (s.match.phase === 'playing') {
      runBots(s);
    } else {
      emitGameOver(s);
      // The room is no longer "playing", so the lobby list and the room screen change.
      broadcastRoom(s.room);
    }
  }

  /**
   * Play out consecutive bot turns. One loop runs at a time per table; it stops whenever
   * the table is no longer the bots' to act on, and is restarted by whatever changes that.
   */
  function runBots(s) {
    if (s.retired || s.botLoop) return;
    s.botLoop = true;
    (async () => {
      while (!s.retired && !s.displayTrick && s.match.phase === 'playing'
             && s.room.bots.has(s.match.hand.turn)) {
        const botId = s.match.hand.turn;
        const observation = engine.observation(s.match, botId);

        // The delay only paces plays for human eyes, so let a bot think through it
        // rather than after it.
        const [card] = await Promise.all([
          s.room.bots.get(botId).chooseCard(observation),
          sleep(botDelayMs),
        ]);
        if (s.retired || s.match.hand.turn !== botId) return;

        log.log(`Room ${s.room.code}: bot ${handleAt(s.room, botId)} plays ${card}`);
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
  const describeTable = room => (observation) => {
    const s = room.session;
    return {
      playerOrder: s.match.playerIds,
      playerHandles: seatHandles(s),
      scores: s.match.totals,
      teams: s.match.options.teams,
      turn: observation.seat,
      collected: s.match.hand.collected,
      observation,
    };
  };

  // --- Losing and reclaiming a seat ------------------------------------------

  /** Whether the engine has dealt this member into the hand the room is playing. */
  function seatedInMatch(room, memberId) {
    const s = room.session;
    return Boolean(s) && !room.bots.has(memberId) && s.match.playerIds.includes(memberId);
  }

  /** Ends the reconnect countdown for `memberId`. Answers whether one was running. */
  function cancelAbsence(room, memberId) {
    const absence = room.absent.get(memberId);
    if (!absence) return false;
    clearTimeout(absence.timer);
    room.absent.delete(memberId);
    return true;
  }

  function forgetAbsences(room) {
    for (const memberId of [...room.absent.keys()]) cancelAbsence(room, memberId);
  }

  /**
   * A seated player's last connection has gone. The seat stays theirs and the table
   * waits — no bot and no other human plays for them — until they come back or the
   * countdown runs out. A hand is dealt to four fixed player ids, so releasing the seat
   * here instead would leave a turn nobody at the table could ever take.
   */
  function beginAbsence(room, memberId) {
    if (room.absent.has(memberId)) return;
    const deadline = Date.now() + reconnectGraceMs;
    const timer = setTimeout(() => {
      // The room may have been deleted, or replaced by a new one under the same code,
      // in the time this timer was pending.
      if (registry.get(room.code) !== room || !cancelAbsence(room, memberId)) return;
      rooms.release(room, memberId);
      seatEmptied(room, memberId);
      // Their name outlived them only so that the table could say who had gone.
      if (!sockets.has(memberId)) handles.delete(memberId);
      if (rooms.members(room).length === 0) scheduleDeletion(room);
      broadcastRoom(room);
    }, reconnectGraceMs);
    if (timer.unref) timer.unref();
    room.absent.set(memberId, { timer, deadline });

    log.log(`Room ${room.code}: ${handleOf(memberId)} dropped; ${reconnectGraceMs}ms to return`);
    toRoom(room, 'player_disconnected', { ...describeMember(memberId), deadline });
    // The countdown also rides on `room_state`, so a client that arrives or refreshes
    // part-way through still knows who the table is waiting for. Only that field
    // changes, so the seats and the lobby listing are left alone.
    toRoom(room, 'room_state', roomState(room));
  }

  /**
   * A player is gone from a seat the engine has already dealt to, whether the countdown
   * ran out or they walked away deliberately. The room's `onDisconnect` option decides
   * between the two ways of freeing the table.
   */
  function seatEmptied(room, memberId) {
    if (room.options.onDisconnect === 'lobby') return abandonHand(room, memberId);

    const bot = room.bots.takeOver(memberId, newBot(room));
    log.log(`Room ${room.code}: ${bot.handle} takes over the seat left by ${handleOf(memberId)}`);
    toRoom(room, 'seat_taken_by_bot', { ...describeMember(memberId), bot: bot.handle });

    const s = room.session;
    broadcastGameState(s);
    runBots(s);
  }

  /**
   * The `onDisconnect: 'lobby'` answer: the match ends and the room goes back to
   * waiting, where the host can deal a fresh one to whoever is still here. The scores
   * already reported by `game_over` stay on screen until that happens.
   */
  function abandonHand(room, memberId) {
    retire(room.session);
    room.session = null;
    room.bots.removeAll();
    rooms.takeFreeSeats(room);
    log.log(`Room ${room.code}: hand abandoned after ${handleOf(memberId)} left`);
    toRoom(room, 'hand_abandoned', describeMember(memberId));
  }

  // --- Starting a game -------------------------------------------------------

  const newSeed = () => `${Date.now()}-${Math.random()}`;

  function retire(s) {
    if (!s) return;
    s.retired = true;
    clearTimeout(s.trickTimer);
  }

  /** A bot of the kind this server seats: LLM-backed when one is configured. */
  function newBot(room) {
    return llmProvider
      ? room.bots.createLLMBot({ provider: llmProvider, fallbackDifficulty: 'hard' }, describeTable(room))
      : room.bots.createBot('easy');
  }

  function begin(room, match) {
    retire(room.session);
    room.session = {
      room, match, displayTrick: null, trickTimer: null, botLoop: false, retired: false,
    };
    const s = room.session;
    broadcastRoom(room);
    toRoom(room, 'game_started');
    toRoom(room, 'collected', match.hand.collected);
    broadcastHands(s);
    broadcastGameState(s);
    runBots(s);
    return s;
  }

  /**
   * New teams, new seats: random pairs, seated so that teammates are never adjacent.
   * Bots fill whatever the room's members leave empty.
   */
  function startGame(room) {
    rooms.takeFreeSeats(room);
    if (room.seats.length === 0) return null;

    room.bots.removeAll();
    const seats = room.seats.slice(0, SEATS);
    while (seats.length < SEATS) seats.push(newBot(room).socketId);

    const [a, b, c, d] = engine.shuffled(seats, Math.random);
    return begin(room, engine.startHand(engine.createMatch({
      playerIds: [a, b, c, d],
      seed: newSeed(),
      options: {
        teams: room.options.teams ? { team1: [a, c], team2: [b, d] } : null,
        variant: room.options.variant,
        firstLead: 'clubs2',
        targetScore: room.options.targetScore,
      },
    })));
  }

  /**
   * Deal the next hand to the same four players. A match that has already been won
   * starts over from zero rather than running past the target score.
   */
  function continueGame(room) {
    if (!room.session) return null;
    const { match } = room.session;
    return begin(room, engine.startHand(match.phase === 'matchComplete'
      ? engine.createMatch({ playerIds: match.playerIds, seed: newSeed(), options: match.options })
      : match));
  }

  // --- HTTP ------------------------------------------------------------------

  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());

  app.get('/', (req, res) => res.send('Gongzhu backend is running!'));

  // --- Sockets ---------------------------------------------------------------

  function fail(socket, reason) {
    socket.emit('room_error', { reason });
  }

  /** The caller's room, but only if they host it. Reports why not, and returns null. */
  function hostRoom(socket) {
    const room = roomFor(socket);
    if (!room) {
      fail(socket, 'You are not in a room');
      return null;
    }
    if (room.hostId !== memberKey(socket)) {
      fail(socket, 'Only the host can do that');
      return null;
    }
    return room;
  }

  io.on('connection', (socket) => {
    log.log('A user connected:', socket.id);
    socket.join(LOBBY);
    socket.emit('room_list', publicRooms());

    socket.on('register_handle', (data) => {
      const raw = typeof data === 'string' ? data : data && data.handle;
      const handle = String(raw == null ? '' : raw).trim().slice(0, MAX_HANDLE_LENGTH);
      if (!handle) return;
      // Identity arrives with the first registration, so this is where a reconnecting
      // socket becomes the player it was before rather than a stranger.
      const memberId = bindIdentity(socket, data && data.playerId);
      // The same player may hold several connections; the last one to register names them.
      handles.set(memberId, handle);
      log.log(`Registered handle: ${handle} (${memberId})`);
      socket.emit('handle_registered', describeMember(memberId));

      const room = roomFor(socket);
      if (!room) return;
      // The player is still in the room, but a socket that has just reconnected — or a
      // second tab — is not yet in its channel and would hear nothing. Rejoining is what
      // reclaims the seat and replays the table, so no client has to arrange it.
      if (socket.rooms.has(room.code)) broadcastRoom(room);
      else join(socket, room);
    });

    socket.on('list_rooms', () => socket.emit('room_list', publicRooms()));

    socket.on('create_room', (data) => {
      const memberId = memberKey(socket);
      if (!handles.has(memberId)) return fail(socket, 'Register a handle before creating a room');

      let options;
      try {
        options = rooms.normalizeRoomOptions(data && data.options, {
          ...rooms.DEFAULT_ROOM_OPTIONS,
          targetScore,
        });
      } catch (error) {
        return fail(socket, error instanceof RoomError ? error.message : 'Invalid room options');
      }

      leaveRoom(memberId);
      const room = rooms.createRoom({
        code: rooms.newRoomCode(code => registry.has(code)),
        name: rooms.normalizeRoomName(data && data.name, `${handleOf(memberId)}'s table`),
        hostId: memberId,
        options,
        bots: createBotRegistry(log),
      });
      registry.set(room.code, room);
      log.log(`Room ${room.code} created by ${handleOf(memberId)}`);
      join(socket, room);
    });

    socket.on('join_room', (data) => {
      const memberId = memberKey(socket);
      if (!handles.has(memberId)) return fail(socket, 'Register a handle before joining a room');

      const code = rooms.normalizeCode(typeof data === 'string' ? data : data && data.code);
      const room = registry.get(code);
      if (!room) return fail(socket, `No room with code ${code || '(none given)'}`);

      // Re-joining the room you are already in must not surrender your seat.
      if (roomOf.get(memberId) !== code) leaveRoom(memberId);
      join(socket, room);
    });

    socket.on('leave_room', () => exit(memberKey(socket)));

    socket.on('update_room_options', (patch) => {
      const room = hostRoom(socket);
      if (!room) return;
      if (rooms.phaseOf(room) !== 'waiting') {
        return fail(socket, 'Options can only be changed before the game starts');
      }
      try {
        room.options = rooms.normalizeRoomOptions(patch, room.options);
      } catch (error) {
        return fail(socket, error instanceof RoomError ? error.message : 'Invalid room options');
      }
      broadcastRoom(room);
    });

    socket.on('kick', (data) => {
      const room = hostRoom(socket);
      if (!room) return;
      const targetId = data && data.playerId;
      if (!targetId || targetId === room.hostId || !rooms.isMember(room, targetId)) {
        return fail(socket, 'That player is not in this room');
      }
      exit(targetId, 'The host removed you from the room');
    });

    socket.on('start_game', () => {
      const room = hostRoom(socket);
      if (!room) return;
      if (!startGame(room)) fail(socket, 'A game needs at least one player');
    });

    socket.on('continue_game', () => {
      const room = hostRoom(socket);
      if (!room) return;
      if (!continueGame(room)) fail(socket, 'No game has been started yet');
    });

    socket.on('play_card', (card) => {
      const room = roomFor(socket);
      const s = room && room.session;
      if (!s || s.displayTrick || s.match.phase !== 'playing') return;

      const memberId = memberKey(socket);
      // A seat a bot has taken over is no longer the departed player's to play, even
      // though the engine still knows their cards by their id.
      if (room.bots.has(memberId)) return;
      if (!engine.legalMoves(s.match, memberId).includes(card)) {
        log.log('Invalid play by', memberId, card);
        socket.emit('invalid_play', card);
        return;
      }
      applyPlay(s, memberId, card);
    });

    socket.on('disconnect', () => {
      const memberId = memberKey(socket);
      const live = sockets.get(memberId);
      if (live) {
        live.delete(socket.id);
        // One of several tabs closing is not the player leaving.
        if (live.size > 0) return;
        sockets.delete(memberId);
      }
      log.log('User disconnected:', memberId, handles.get(memberId));

      const room = registry.get(roomOf.get(memberId));
      if (room && seatedInMatch(room, memberId)) {
        // Their seat, handle and room membership are all held for them.
        beginAbsence(room, memberId);
        return;
      }
      leaveRoom(memberId);
      handles.delete(memberId);
    });
  });

  return {
    app,
    io,
    server,
    handles,
    rooms: registry,
    getRoom: code => registry.get(rooms.normalizeCode(code)),
    /** Stop every table and release the port. Closing `io` closes the HTTP server too. */
    async close() {
      for (const room of registry.values()) {
        retire(room.session);
        forgetAbsences(room);
        clearTimeout(room.deleteTimer);
      }
      registry.clear();
      await new Promise(resolve => io.close(resolve));
    },
  };
}

module.exports = { createGongzhuServer, corsOrigins, resolveLLMProvider };
