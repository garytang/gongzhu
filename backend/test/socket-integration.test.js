'use strict';

const assert = require('assert');
const { io: Client } = require('socket.io-client');

const engine = require('../src/engine');
const { createGongzhuServer, corsOrigins } = require('../src/server/createServer');
const { createBotRegistry } = require('../src/server/bots');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quiet = { log() {}, warn() {}, error() {} };

function connect(url, handle) {
  const client = new Client(url, { transports: ['websocket'] });
  return new Promise((resolve) => {
    client.on('player_list', function seated(list) {
      if (list.some(p => p.handle === handle)) {
        client.off('player_list', seated);
        resolve(client);
      }
    });
    client.on('connect', () => client.emit('register_handle', { handle }));
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
async function table(playerCount, options = {}) {
  const instance = createGongzhuServer({
    botDelayMs: 0,
    trickDelayMs: 5,
    useLLMBots: false,
    log: quiet,
    ...options,
  });
  await new Promise(resolve => instance.server.listen(0, resolve));

  const url = `http://localhost:${instance.server.address().port}`;
  instance.clients = [];
  for (let i = 0; i < playerCount; i++) {
    instance.clients.push(await connect(url, `Player${i + 1}`));
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
    assert.strictEqual(instance.bots.ids().length, 3);
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
