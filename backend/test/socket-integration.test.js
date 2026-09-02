'use strict';

const assert = require('assert');
const { io: Client } = require('socket.io-client');

const engine = require('../src/engine');
const { createGongzhuServer, corsOrigins } = require('../src/server/createServer');
const { createBotRegistry } = require('../src/server/bots');
const rooms = require('../src/server/rooms');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quiet = { log() {}, warn() {}, error() {} };

let nextPlayerId = 0;
/** What a browser mints once and keeps in localStorage. */
const newPlayerId = () => `player-id-${nextPlayerId++}-${Date.now()}`;

/**
 * Registers a handle, which is the identity step every room action requires. Reusing a
 * `playerId` is what a returning browser does; the client is decorated with the id the
 * server confirmed, so a test can address the player rather than the connection.
 */
function connect(url, handle, playerId = newPlayerId()) {
  const client = new Client(url, { transports: ['websocket'] });
  return new Promise((resolve) => {
    client.once('handle_registered', (player) => {
      client.playerId = player.playerId;
      resolve(client);
    });
    client.on('connect', () => client.emit('register_handle', { handle, playerId }));
  });
}

function waitFor(client, event, predicate = () => true, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(event, listener);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);
    function listener(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      client.off(event, listener);
      resolve(payload);
    }
    client.on(event, listener);
  });
}

/**
 * Plays every client's turn from the `legal_moves` the server sends, which is what a
 * real client would do. A hand only ever shrinks, so acting once per hand size makes a
 * repeated broadcast harmless.
 */
function autoplay(clients) {
  const driver = { stopped: false, stopAfterNextPlay: false };
  for (const client of clients) {
    let hand = [];
    let actedAtSize = null;
    client.on('game_started', () => { actedAtSize = null; });
    client.on('deal_hand', (cards) => { hand = cards; });
    client.on('legal_moves', (moves) => {
      if (driver.stopped || moves.length === 0 || hand.length === actedAtSize) return;
      actedAtSize = hand.length;
      client.emit('play_card', moves[0]);
      if (driver.stopAfterNextPlay) driver.stopped = true;
    });
  }
  return driver;
}

/** The real server on an ephemeral port, with the display delays turned down. */
async function serve(options = {}) {
  const instance = createGongzhuServer({
    botDelayMs: 0,
    trickDelayMs: 5,
    llmProvider: null,
    log: quiet,
    ...options,
  });
  await new Promise(resolve => instance.server.listen(0, resolve));
  instance.url = `http://localhost:${instance.server.address().port}`;
  instance.clients = [];
  return instance;
}

/**
 * A connected, registered client, put into `code` — or into a room it creates. Passing
 * `playerId` is how a test returns as an existing player rather than arriving as a new
 * one, which is what a browser does after a refresh.
 */
async function member(instance, handle, code, playerId) {
  const client = await connect(instance.url, handle, playerId);
  instance.clients.push(client);
  // `room_joined` is answered to the caller before the room is broadcast, so wait for
  // the broadcast too: a caller that starts listening on `room_joined` alone would
  // still have those two events in flight.
  const settled = Promise.all([
    waitFor(client, 'room_joined'),
    waitFor(client, 'room_state'),
    waitFor(client, 'player_list'),
  ]);
  if (code) client.emit('join_room', { code });
  else client.emit('create_room', { name: `${handle}'s table` });
  const [joined] = await settled;
  return { client, playerId: client.playerId, ...joined };
}

/** One room hosted by the first of `playerCount` clients; the rest join by code. */
async function table(playerCount, options = {}) {
  const instance = await serve(options);
  const host = await member(instance, 'Player1');
  instance.code = host.code;
  for (let i = 1; i < playerCount; i++) {
    await member(instance, `Player${i + 1}`, host.code);
  }
  return instance;
}

describe('Socket.IO server', function () {
  this.timeout(20000);
  let instance;

  afterEach(async () => {
    if (!instance) return;
    for (const client of instance.clients) client.close();
    await instance.close();
    instance = null;
  });

  it('seats four registered players and deals thirteen cards each', async () => {
    instance = await table(4);
    const [client] = instance.clients;

    const dealt = instance.clients.map(c => waitFor(c, 'deal_hand'));
    const state = waitFor(client, 'game_state');
    client.emit('start_game');

    const hands = await Promise.all(dealt);
    for (const hand of hands) assert.strictEqual(hand.length, 13);
    assert.strictEqual(new Set(hands.flat()).size, 52);

    const { playerHandles, teams } = await state;
    assert.deepStrictEqual(playerHandles.map(p => p.handle).sort(),
      ['Player1', 'Player2', 'Player3', 'Player4']);
    // Teammates are seated across from each other, never side by side.
    const seats = playerHandles.map(p => p.playerId);
    assert.strictEqual(seats.indexOf(teams.team1[1]) - seats.indexOf(teams.team1[0]), 2);
  });

  it('forces the 2 of clubs holder to lead the first trick', async () => {
    instance = await table(4);
    const legal = instance.clients.map(c => waitFor(c, 'legal_moves'));
    instance.clients[0].emit('start_game');

    const moves = (await Promise.all(legal)).filter(m => m.length > 0);
    assert.deepStrictEqual(moves, [['2♣']]);
  });

  it('rejects a card from a player whose turn it is not', async () => {
    instance = await table(4);
    const dealt = instance.clients.map(c => waitFor(c, 'deal_hand'));
    const moves = instance.clients.map(c => waitFor(c, 'legal_moves'));
    instance.clients[0].emit('start_game');
    const hands = await Promise.all(dealt);

    const idle = (await Promise.all(moves)).findIndex(m => m.length === 0);
    const rejected = waitFor(instance.clients[idle], 'invalid_play');
    instance.clients[idle].emit('play_card', hands[idle][0]);
    assert.strictEqual(await rejected, hands[idle][0]);
  });

  it('announces who took each trick', async () => {
    instance = await table(4);
    const [client] = instance.clients;

    autoplay(instance.clients);
    const won = waitFor(client, 'trick_won');
    const shown = waitFor(client, 'game_state', s => s.trick.length === 4);
    client.emit('start_game');

    const trick = await won;
    assert.strictEqual(trick.winner, engine.determineTrickWinner(trick.trick));
    assert.deepStrictEqual(trick.cards, trick.trick.map(t => t.card));
    // The same fact reaches the client on game_state, for the trick still on screen.
    assert.deepStrictEqual((await shown).lastTrick, { trick: trick.trick, winner: trick.winner });
  });

  it('plays a full hand and scores it exactly as the engine does', async () => {
    instance = await table(4);
    const [client] = instance.clients;

    let state = null;
    let collected = null;
    client.on('game_state', (s) => { state = s; });
    client.on('collected', (c) => { collected = c; });

    autoplay(instance.clients);
    const over = waitFor(client, 'game_over');
    client.emit('start_game');
    const result = await over;

    assert.strictEqual(Object.values(collected).flat().length, 52);
    const expected = engine.scoreHand(collected, {
      variant: 'standard',
      exposed: [],
      teams: state.teams,
    });
    assert.deepStrictEqual(result.scores, expected.individual);
    assert.strictEqual(result.teamInfo.team1.roundScore, expected.teamScores.team1);
    assert.strictEqual(result.teamInfo.team2.roundScore, expected.teamScores.team2);
    assert.strictEqual(result.gameEnded, false);
    assert.strictEqual(result.winningTeam, null);
    // Collected cards are keyed by handle in the game-over summary.
    assert.deepStrictEqual(Object.keys(result.collected).sort(),
      ['Player1', 'Player2', 'Player3', 'Player4']);
  });

  it('continues with the same teams and carries the running scores forward', async () => {
    instance = await table(4);
    const [client] = instance.clients;

    autoplay(instance.clients);
    const first = waitFor(client, 'game_state');
    const over = waitFor(client, 'game_over');
    client.emit('start_game');
    const before = await first;
    const result = await over;

    const next = waitFor(client, 'game_state');
    client.emit('continue_game');
    const after = await next;

    assert.deepStrictEqual(after.teams, before.teams);
    assert.deepStrictEqual(after.playerHandles, before.playerHandles);
    // The first hand's scores are the running totals; the old server always sent zeroes.
    assert.deepStrictEqual(after.scores, result.scores);
    assert.strictEqual(after.cumulativeTeamScores.team1, result.teamInfo.team1.cumulativeScore);
  });

  it('names one winning team when both cross the target score at once', async () => {
    // Both teams almost always finish a hand in the negative, so a target of 1 makes
    // them cross together. The old server called that a win for both sides.
    instance = await table(4, { targetScore: 1 });
    const [client] = instance.clients;

    autoplay(instance.clients);
    const over = waitFor(client, 'game_over');
    client.emit('start_game');
    const result = await over;

    assert.strictEqual(result.gameEnded, true);
    const { team1, team2 } = result.teamInfo;
    const ahead = team1.cumulativeScore >= team2.cumulativeScore ? 1 : 2;
    assert.strictEqual(result.winningTeam,
      team1.cumulativeScore === team2.cumulativeScore ? null : ahead);
  });

  it('does not let a stale trick timer disturb a game started underneath it', async () => {
    instance = await table(4, { trickDelayMs: 300 });
    const [client] = instance.clients;

    let state = null;
    client.on('game_state', (s) => { state = s; });

    const driver = autoplay(instance.clients);
    const trickDone = waitFor(client, 'game_state', s => s.trick.length === 4);
    client.emit('start_game');
    await trickDone;

    // Restart while the completed trick is still on screen, and let exactly one card be
    // played into the new game before the old table's timer fires.
    driver.stopAfterNextPlay = true;
    client.emit('start_game');

    await waitFor(client, 'game_state', s => s.trick.length === 1);
    await sleep(400);
    assert.strictEqual(state.trick.length, 1, 'the stale timer cleared the new trick');
  });

  it('fills the empty seats with bots and plays the hand to the end', async () => {
    instance = await table(1);
    const [client] = instance.clients;

    let collected = null;
    client.on('collected', (c) => { collected = c; });

    autoplay(instance.clients);
    const over = waitFor(client, 'game_over');
    client.emit('start_game');
    const result = await over;

    assert.strictEqual(Object.values(collected).flat().length, 52);
    assert.strictEqual(Object.keys(result.scores).length, 4);
    assert.strictEqual(instance.getRoom(instance.code).bots.ids().length, 3);
  });

  it('scores individuals when the room turns teams off', async () => {
    instance = await table(1);
    const [client] = instance.clients;

    const options = waitFor(client, 'room_state', r => r.options.teams === false);
    client.emit('update_room_options', { teams: false, targetScore: 1 });
    await options;

    autoplay(instance.clients);
    const over = waitFor(client, 'game_over');
    client.emit('start_game');
    const result = await over;

    assert.strictEqual(result.teamInfo, null);
    assert.strictEqual(result.winningTeam, null);
    assert.strictEqual(result.gameEnded, true);
    assert.strictEqual(result.winners.length >= 1, true);
  });
});

describe('rooms', function () {
  this.timeout(20000);
  let instance;

  afterEach(async () => {
    if (!instance) return;
    for (const client of instance.clients) client.close();
    await instance.close();
    instance = null;
  });

  it('keeps two rooms playing at once without a single event crossing over', async () => {
    instance = await serve();
    const a1 = await member(instance, 'A1');
    const a2 = await member(instance, 'A2', a1.code);
    const b1 = await member(instance, 'B1');
    // B1's own copy of the broadcast announcing B2 must land before the watch starts,
    // or it would be counted as cross-talk from room A.
    const bothSeated = waitFor(b1.client, 'room_state', r => r.seats.length === 2);
    const b2 = await member(instance, 'B2', b1.code);
    await bothSeated;
    assert.notStrictEqual(a1.code, b1.code);

    // Anything room A causes to reach a socket in room B is cross-talk.
    const leaked = [];
    b1.client.onAny(event => leaked.push(event));
    b2.client.onAny(event => leaked.push(event));

    autoplay([a1.client, a2.client]);
    const over = waitFor(a1.client, 'game_over');
    a1.client.emit('start_game');
    const result = await over;

    assert.strictEqual(Object.keys(result.scores).length, 4);
    assert.deepStrictEqual(leaked, []);
    assert.strictEqual(instance.getRoom(b1.code).session, null);

    // Room B then plays its own hand, undisturbed by A having finished one.
    b1.client.offAny();
    b2.client.offAny();
    autoplay([b1.client, b2.client]);
    const bOver = waitFor(b1.client, 'game_over');
    b1.client.emit('start_game');
    assert.strictEqual(Object.keys((await bOver).scores).length, 4);
  });

  it('lets a fresh socket join by code, whatever the casing', async () => {
    instance = await serve();
    const host = await member(instance, 'Host');

    const guest = await connect(instance.url, 'Guest');
    instance.clients.push(guest);
    const joined = waitFor(guest, 'room_joined');
    const seated = waitFor(guest, 'room_state');
    guest.emit('join_room', { code: ` ${host.code.toLowerCase()} ` });

    assert.deepStrictEqual(await joined, { code: host.code, role: 'seat' });
    const state = await seated;
    assert.deepStrictEqual(state.seats.map(p => p.handle), ['Host', 'Guest']);
    assert.strictEqual(state.host.handle, 'Host');
    assert.strictEqual(state.phase, 'waiting');
  });

  it('rejects start_game, options and kicks from anyone but the host', async () => {
    instance = await serve();
    const host = await member(instance, 'Host');
    const guest = await member(instance, 'Guest', host.code);

    for (const [event, payload] of [['start_game'], ['update_room_options', { teams: false }], ['kick', { playerId: 'x' }]]) {
      const rejected = waitFor(guest.client, 'room_error');
      guest.client.emit(event, payload);
      assert.strictEqual((await rejected).reason, 'Only the host can do that');
    }
    assert.strictEqual(instance.getRoom(host.code).session, null);
  });

  it('makes the fifth joiner a spectator with no hand', async () => {
    instance = await serve();
    const host = await member(instance, 'Host');
    for (const name of ['P2', 'P3', 'P4']) await member(instance, name, host.code);

    const fifth = await member(instance, 'P5', host.code);
    assert.strictEqual(fifth.role, 'spectator');

    const state = waitFor(fifth.client, 'room_state', r => r.phase === 'playing');
    // The spectator sees the table but is never dealt into it.
    const table = waitFor(fifth.client, 'game_state');
    let dealt = false;
    fifth.client.on('deal_hand', () => { dealt = true; });
    host.client.emit('start_game');

    const playing = await state;
    assert.deepStrictEqual(playing.spectators.map(p => p.handle), ['P5']);
    assert.strictEqual(playing.seats.length, 4);
    assert.strictEqual((await table).playerHandles.length, 4);
    assert.strictEqual(dealt, false);
  });

  it('seats a waiting spectator when a seat frees before the game starts', async () => {
    instance = await serve();
    const host = await member(instance, 'Host');
    const others = [];
    for (const name of ['P2', 'P3', 'P4']) others.push(await member(instance, name, host.code));
    const fifth = await member(instance, 'P5', host.code);
    assert.strictEqual(fifth.role, 'spectator');

    const promoted = waitFor(fifth.client, 'room_state', r => r.spectators.length === 0);
    others[0].client.emit('leave_room');
    const state = await promoted;
    assert.deepStrictEqual(state.seats.map(p => p.handle), ['Host', 'P3', 'P4', 'P5']);
  });

  it('sends a kicked player out with a reason and a fresh lobby listing', async () => {
    instance = await serve();
    const host = await member(instance, 'Host');
    const guest = await member(instance, 'Guest', host.code);

    const told = waitFor(guest.client, 'room_error');
    const left = waitFor(guest.client, 'room_left');
    const listed = waitFor(guest.client, 'room_list');
    const seatFreed = waitFor(host.client, 'room_state', r => r.seats.length === 1);
    host.client.emit('kick', { playerId: guest.playerId });

    assert.match((await told).reason, /removed you/);
    await left;
    // Leaving by any route puts you back in the lobby channel, listing included.
    assert.deepStrictEqual((await listed).map(r => r.code), [host.code]);
    assert.deepStrictEqual((await seatFreed).seats.map(p => p.handle), ['Host']);
  });

  it('gives a leaving player the lobby listing without being asked', async () => {
    instance = await serve();
    const host = await member(instance, 'Host');
    const other = await member(instance, 'Other');

    const left = waitFor(host.client, 'room_left');
    const listed = waitFor(host.client, 'room_list');
    host.client.emit('leave_room');
    await left;
    // The room just left is still listed: it is empty but inside its deletion grace period.
    assert.deepStrictEqual((await listed).map(r => r.code).sort(),
      [host.code, other.code].sort());
  });

  it('passes the host role to the next member when the host leaves', async () => {
    instance = await serve();
    const host = await member(instance, 'Host');
    const guest = await member(instance, 'Guest', host.code);

    const handedOver = waitFor(guest.client, 'room_state', r => r.host.handle === 'Guest');
    host.client.emit('leave_room');
    const state = await handedOver;
    assert.deepStrictEqual(state.seats.map(p => p.handle), ['Guest']);

    // The new host can do what the old one could.
    const started = waitFor(guest.client, 'game_started');
    guest.client.emit('start_game');
    await started;
  });

  it('deletes a room only after it has been empty for the whole timeout', async () => {
    instance = await serve({ emptyRoomTtlMs: 120 });
    const host = await member(instance, 'Host');
    assert.strictEqual(instance.rooms.size, 1);

    host.client.close();
    await sleep(60);
    assert.strictEqual(instance.rooms.size, 1, 'the room went away before the timeout');
    await sleep(150);
    assert.strictEqual(instance.rooms.size, 0);
  });

  it('keeps the room when someone rejoins inside the timeout', async () => {
    instance = await serve({ emptyRoomTtlMs: 200 });
    const host = await member(instance, 'Host');
    host.client.close();
    await sleep(60);

    const returning = await member(instance, 'Host', host.code);
    await sleep(250);
    assert.strictEqual(instance.rooms.size, 1);
    assert.strictEqual(returning.role, 'seat');
  });

  it('lists public rooms in the lobby and hides private ones', async () => {
    instance = await serve();
    const open = await member(instance, 'Open');
    const secret = await connect(instance.url, 'Secret');
    instance.clients.push(secret);
    const madePrivate = waitFor(secret, 'room_state', r => r.options.visibility === 'private');
    secret.emit('create_room', { name: 'Hidden', options: { visibility: 'private' } });
    await waitFor(secret, 'room_joined');
    secret.emit('update_room_options', { visibility: 'private' });
    await madePrivate;

    const watcher = await connect(instance.url, 'Watcher');
    instance.clients.push(watcher);
    const list = waitFor(watcher, 'room_list');
    watcher.emit('list_rooms');

    const codes = (await list).map(r => r.code);
    assert.deepStrictEqual(codes, [open.code]);
  });

  it('refuses a room option the engine cannot honour', async () => {
    instance = await serve();
    const host = await member(instance, 'Host');
    const rejected = waitFor(host.client, 'room_error');
    host.client.emit('update_room_options', { variant: 'nonsense' });
    assert.match((await rejected).reason, /variant/);
  });
});

describe('identity and reconnect', function () {
  this.timeout(20000);
  let instance;

  afterEach(async () => {
    if (!instance) return;
    for (const client of instance.clients) client.close();
    await instance.close();
    instance = null;
  });

  /** The event that says a player is the one the table is waiting on. */
  const myTurn = client => waitFor(client, 'legal_moves', moves => moves.length > 0);

  /**
   * A two-human table stopped in the middle of a hand with `Bob` on turn: `Ann` and the
   * two bots keep playing, so nothing moves until Bob does.
   */
  async function stalledOnBob(options) {
    instance = await serve(options);
    const ann = await member(instance, 'Ann');
    const bob = await member(instance, 'Bob', ann.code);
    autoplay([ann.client]);
    const turn = myTurn(bob.client);
    ann.client.emit('start_game');
    await turn;
    return { ann, bob };
  }

  it('holds the seat and the host role for a lone player who refreshes', async () => {
    instance = await serve();
    const first = await member(instance, 'Ann');
    first.client.close();
    await sleep(30);

    const back = await member(instance, 'Ann', first.code, first.playerId);
    assert.strictEqual(back.playerId, first.playerId);
    assert.strictEqual(back.role, 'seat');
    const room = instance.getRoom(first.code);
    assert.deepStrictEqual(room.seats, [first.playerId]);
    assert.strictEqual(room.hostId, first.playerId);
  });

  it('deals to every tab a player has open, and one closing is not leaving', async () => {
    instance = await serve();
    const ann = await member(instance, 'Ann');

    const secondTab = await connect(instance.url, 'Ann', ann.playerId);
    instance.clients.push(secondTab);
    const joined = waitFor(secondTab, 'room_joined');
    secondTab.emit('join_room', { code: ann.code });
    assert.deepStrictEqual(await joined, { code: ann.code, role: 'seat' });

    const dealt = [waitFor(ann.client, 'deal_hand'), waitFor(secondTab, 'deal_hand')];
    ann.client.emit('start_game');
    const [first, second] = await Promise.all(dealt);
    assert.deepStrictEqual(first, second);

    secondTab.close();
    await sleep(50);
    assert.deepStrictEqual(instance.getRoom(ann.code).seats, [ann.playerId]);
  });

  it('waits out a mid-hand drop and hands the cards back to the same player', async () => {
    const { ann, bob } = await stalledOnBob({ reconnectGraceMs: 5000 });

    const dropped = waitFor(ann.client, 'player_disconnected');
    const counting = waitFor(ann.client, 'room_state', r => r.absent.length === 1);
    bob.client.close();
    const notice = await dropped;
    assert.strictEqual(notice.playerId, bob.playerId);
    assert.strictEqual(notice.handle, 'Bob');
    assert.ok(notice.deadline > Date.now(), 'the countdown had already expired');
    assert.strictEqual((await counting).absent[0].playerId, bob.playerId);

    // Nobody plays for Bob: the table is exactly where he left it.
    const room = instance.getRoom(ann.code);
    const before = room.session.match.hand.trick.length;
    await sleep(100);
    assert.strictEqual(room.session.match.hand.trick.length, before);

    // Registering is the whole reconnect: the server puts the socket back in the room,
    // so a client never has to arrange it. Legal moves come with the hand, because the
    // table disables every card that is not in them.
    const reconnected = waitFor(ann.client, 'player_reconnected');
    const returning = new Client(instance.url, { transports: ['websocket'] });
    instance.clients.push(returning);
    const dealt = waitFor(returning, 'deal_hand');
    const moves = myTurn(returning);
    const state = waitFor(returning, 'game_state');
    const collected = waitFor(returning, 'collected');
    returning.on('connect', () =>
      returning.emit('register_handle', { handle: 'Bob', playerId: bob.playerId }));

    assert.strictEqual((await reconnected).playerId, bob.playerId);
    const hand = await dealt;
    const legal = await moves;
    assert.ok(legal.every(card => hand.includes(card)));
    assert.strictEqual((await state).playerHandles.length, 4);
    await collected;

    // And play resumes from the new socket.
    const played = waitFor(returning, 'deal_hand', cards => cards.length === hand.length - 1);
    returning.emit('play_card', legal[0]);
    await played;
    assert.strictEqual(instance.getRoom(ann.code).session.room.absent.size, 0);
  });

  it('gives the seat to a bot when the countdown runs out, and the player a spectator seat', async () => {
    const { ann, bob } = await stalledOnBob({ reconnectGraceMs: 60 });

    const taken = waitFor(ann.client, 'seat_taken_by_bot');
    const over = waitFor(ann.client, 'game_over');
    bob.client.close();

    const seat = await taken;
    assert.strictEqual(seat.playerId, bob.playerId);
    assert.strictEqual(seat.handle, 'Bob');
    assert.ok(seat.bot, 'no bot was named');
    // The bot really plays the seat: the hand runs to the end with Ann and three bots.
    assert.strictEqual(Object.keys((await over).scores).length, 4);

    const back = await member(instance, 'Bob', ann.code, bob.playerId);
    assert.strictEqual(back.role, 'spectator');
    assert.ok(!instance.getRoom(ann.code).seats.includes(bob.playerId));
  });

  it('ends the hand instead, when the room asks for that', async () => {
    instance = await serve({ reconnectGraceMs: 60 });
    const ann = await member(instance, 'Ann');
    const bob = await member(instance, 'Bob', ann.code);
    const set = waitFor(ann.client, 'room_state', r => r.options.onDisconnect === 'lobby');
    ann.client.emit('update_room_options', { onDisconnect: 'lobby' });
    await set;

    autoplay([ann.client]);
    const turn = myTurn(bob.client);
    ann.client.emit('start_game');
    await turn;

    const abandoned = waitFor(ann.client, 'hand_abandoned');
    const waiting = waitFor(ann.client, 'room_state', r => r.phase === 'waiting');
    bob.client.close();

    assert.strictEqual((await abandoned).playerId, bob.playerId);
    await waiting;
    assert.strictEqual(instance.getRoom(ann.code).session, null);
    assert.strictEqual(instance.getRoom(ann.code).bots.ids().length, 0);
  });

  it('frees the seat straight away when the drop happens before the deal', async () => {
    instance = await serve({ reconnectGraceMs: 5000 });
    const ann = await member(instance, 'Ann');
    const bob = await member(instance, 'Bob', ann.code);

    const freed = waitFor(ann.client, 'room_state', r => r.seats.length === 1);
    bob.client.close();
    const state = await freed;
    assert.deepStrictEqual(state.absent, []);
  });

  it('ignores an id that is not the shape a client mints', async () => {
    instance = await serve();
    const client = await connect(instance.url, 'Ann', 'no');
    instance.clients.push(client);
    assert.strictEqual(client.playerId, client.id);
  });
});

describe('room model', () => {
  it('never puts an ambiguous character in a join code', () => {
    for (const character of rooms.CODE_ALPHABET) assert.ok(!'01OI'.includes(character));
    const code = rooms.newRoomCode(() => false);
    assert.match(code, new RegExp(`^[${rooms.CODE_ALPHABET}]{${rooms.CODE_LENGTH}}$`));
  });

  it('gives up rather than returning a code that is already in use', () => {
    assert.throws(() => rooms.newRoomCode(() => true), rooms.RoomError);
  });

  it('rejects options outside what the engine and lobby accept', () => {
    assert.throws(() => rooms.normalizeRoomOptions({ variant: 'wild' }), rooms.RoomError);
    assert.throws(() => rooms.normalizeRoomOptions({ teams: 'yes' }), rooms.RoomError);
    assert.throws(() => rooms.normalizeRoomOptions({ targetScore: 0 }), rooms.RoomError);
    assert.throws(() => rooms.normalizeRoomOptions({ visibility: 'unlisted' }), rooms.RoomError);
    assert.throws(() => rooms.normalizeRoomOptions({ onDisconnect: 'pause' }), rooms.RoomError);
  });

  it('keeps the options it was given and ignores keys it does not know', () => {
    const options = rooms.normalizeRoomOptions({ teams: false, targetScore: 500, nonsense: 1 });
    assert.deepStrictEqual(options, {
      variant: 'standard',
      teams: false,
      targetScore: 500,
      visibility: 'public',
      onDisconnect: 'bot',
    });
  });

  it('spectates the fifth arrival and seats them when a seat frees', () => {
    const room = rooms.createRoom({ code: 'ABCDEF', name: 'T', hostId: 'a', options: rooms.DEFAULT_ROOM_OPTIONS });
    for (const id of ['b', 'c', 'd']) assert.strictEqual(rooms.admit(room, id), 'seat');
    assert.strictEqual(rooms.admit(room, 'e'), 'spectator');

    rooms.release(room, 'b');
    assert.deepStrictEqual(room.seats, ['a', 'c', 'd', 'e']);
    assert.deepStrictEqual(room.spectators, []);
  });

  it('passes the host role along and empties out in order', () => {
    const room = rooms.createRoom({ code: 'ABCDEF', name: 'T', hostId: 'a', options: rooms.DEFAULT_ROOM_OPTIONS });
    rooms.admit(room, 'b');
    rooms.release(room, 'a');
    assert.strictEqual(room.hostId, 'b');
    rooms.release(room, 'b');
    assert.deepStrictEqual(rooms.members(room), []);
    // An empty room remembers who hosted it, so a refresh gets the room back.
    assert.strictEqual(room.hostId, 'b');
    assert.strictEqual(rooms.admit(room, 'b'), 'seat');
    assert.strictEqual(room.hostId, 'b');
  });

  it('lets a stranger host a room its owner abandoned, rather than stranding it', () => {
    const room = rooms.createRoom({ code: 'ABCDEF', name: 'T', hostId: 'a', options: rooms.DEFAULT_ROOM_OPTIONS });
    rooms.release(room, 'a');
    rooms.admit(room, 'z');
    assert.strictEqual(room.hostId, 'z');
  });
});

describe('bot registry', () => {
  const position = {
    legalMoves: ['3♦', 'K♠', 'Q♥'],
    trick: [],
    hand: ['3♦', 'K♠', 'Q♥'],
  };

  it('falls back to a legal card when a bot throws', async () => {
    const bot = createBotRegistry(quiet).registerCustom('x', 'Throwing bot', () => {
      throw new Error('provider exploded');
    });
    assert.ok(position.legalMoves.includes(await bot.chooseCard(position)));
  });

  it('falls back to a legal card when a bot names an illegal one', async () => {
    const bot = createBotRegistry(quiet).registerCustom('x', 'Cheating bot', () => 'A♠');
    assert.ok(position.legalMoves.includes(await bot.chooseCard(position)));
  });

  it('plays a forced move without consulting the bot', async () => {
    let consulted = false;
    const bot = createBotRegistry(quiet).registerCustom('x', 'Idle bot', () => {
      consulted = true;
      return 'A♠';
    });
    assert.strictEqual(await bot.chooseCard({ legalMoves: ['2♣'], trick: [], hand: ['2♣'] }), '2♣');
    assert.strictEqual(consulted, false);
  });
});

describe('CORS origins', () => {
  it('gives a bare hostname the scheme a browser will send', () => {
    assert.deepStrictEqual(corsOrigins('gongzhu.up.railway.app'), ['https://gongzhu.up.railway.app']);
  });

  it('accepts a comma-separated list and keeps explicit schemes', () => {
    assert.deepStrictEqual(
      corsOrigins(' https://gongzhu.up.railway.app , http://localhost:3000 ,example.com '),
      ['https://gongzhu.up.railway.app', 'http://localhost:3000', 'https://example.com']);
  });

  it('allows any origin in development when unset', () => {
    assert.strictEqual(corsOrigins(undefined, 'development'), '*');
    assert.strictEqual(corsOrigins('', 'development'), '*');
  });

  it('refuses to start unconfigured in production', () => {
    assert.throws(() => corsOrigins(undefined, 'production'), /CORS_ORIGIN/);
  });
});
