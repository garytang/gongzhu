'use strict';

const { expect } = require('chai');
const { HandTracker } = require('../../src/selfplay/tracker');
const { makePolicy } = require('../../src/selfplay/policies');
const { runTournament } = require('../../src/selfplay/tournament');
const { runBatch } = require('../../src/selfplay/runner');
const {
  createMatch, startHand, observation, playCard,
} = require('../../src/engine/game');
const { suitOf } = require('../../src/engine/cards');

const PLAYERS = ['p0', 'p1', 'p2', 'p3'];

/** Play a hand, feeding one seat's observations to a tracker, against known ground truth. */
function trackHand(seed, watcher = 'p0') {
  const policy = makePolicy('avoidPoints');
  const tracker = new HandTracker();
  let match = startHand(createMatch({ playerIds: PLAYERS, seed }));

  const truePlayed = new Set();
  const trueVoids = Object.fromEntries(PLAYERS.map(id => [id, new Set()]));
  const checks = [];

  while (match.phase === 'playing') {
    const turn = match.hand.turn;
    if (turn === watcher) {
      tracker.observe(observation(match, watcher));
      checks.push({
        played: new Set(tracker.played),
        voids: Object.fromEntries(PLAYERS.map(id => [id, new Set(tracker.voids[id])])),
        truePlayed: new Set(truePlayed),
        trueVoids: Object.fromEntries(PLAYERS.map(id => [id, new Set(trueVoids[id])])),
      });
    }

    const card = policy.choose(observation(match, turn));
    if (match.hand.trick.length > 0 && suitOf(card) !== suitOf(match.hand.trick[0].card)) {
      trueVoids[turn].add(suitOf(match.hand.trick[0].card));
    }
    truePlayed.add(card);
    match = playCard(match, turn, card).match;
  }

  return checks;
}

describe('self-play: HandTracker', () => {
  it('reconstructs exactly the cards played so far, from one seat\'s observations', () => {
    for (const seed of ['tr-1', 'tr-2', 'tr-3']) {
      for (const watcher of PLAYERS) {
        for (const check of trackHand(seed, watcher)) {
          expect([...check.played].sort(), `${seed}/${watcher}`)
            .to.deep.equal([...check.truePlayed].sort());
        }
      }
    }
  });

  it('reconstructs exactly the voids shown so far', () => {
    for (const seed of ['tr-1', 'tr-2', 'tr-3']) {
      for (const check of trackHand(seed)) {
        for (const player of PLAYERS) {
          expect([...check.voids[player]].sort(), `${seed}/${player}`)
            .to.deep.equal([...check.trueVoids[player]].sort());
        }
      }
    }
  });

  it('starts fresh on a new hand within the same match', async () => {
    const stats = await runBatch({
      games: 3,
      seedPrefix: 'multi-hand',
      policyNames: ['cardCounter', 'cardCounter', 'cardCounter', 'cardCounter'],
    });
    // An un-reset tracker would think cards from an earlier hand were already played
    // and eventually pick an illegal card, which the runner rejects.
    expect(stats.handsPlayed).to.be.greaterThan(3);
  });
});

describe('self-play: cardCounter strength', () => {
  it('beats avoidPoints head to head, individually', async () => {
    const result = await runTournament({
      policyNames: ['cardCounter', 'avoidPoints'],
      matches: 15,
      seed: 'cc-vs-ap',
      mode: 'individual',
    });
    const counter = result.rows.find(r => r.policy === 'cardCounter');
    const avoid = result.rows.find(r => r.policy === 'avoidPoints');

    // Observed gap is 12-21 points per hand across seeds; assert well inside that.
    expect(counter.meanHandScore - avoid.meanHandScore).to.be.greaterThan(5);
    expect(counter.winRate).to.be.greaterThan(avoid.winRate);
  });

  it('beats avoidPoints head to head, in partnerships', async () => {
    const result = await runTournament({
      policyNames: ['cardCounter', 'avoidPoints'],
      matches: 15,
      seed: 'cc-vs-ap',
      mode: 'teams',
    });
    const counter = result.rows.find(r => r.policy === 'cardCounter');
    const avoid = result.rows.find(r => r.policy === 'avoidPoints');

    expect(counter.meanHandScore - avoid.meanHandScore).to.be.greaterThan(5);
    expect(counter.winRate).to.be.greaterThan(0.5);
  });

  it('is deterministic: the same seed replays the same games', async () => {
    const a = await runBatch({ games: 3, seedPrefix: 'cc-det', policyNames: ['cardCounter', 'cardCounter', 'cardCounter', 'cardCounter'] });
    const b = await runBatch({ games: 3, seedPrefix: 'cc-det', policyNames: ['cardCounter', 'cardCounter', 'cardCounter', 'cardCounter'] });
    expect(a.scoreTotals).to.deep.equal(b.scoreTotals);
  });
});
