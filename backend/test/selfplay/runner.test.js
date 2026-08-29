'use strict';

const { expect } = require('chai');
const { runMatch, runBatch } = require('../../src/selfplay/runner');
const { makePolicy, POLICIES } = require('../../src/selfplay/policies');
const { createMatch, startHand, legalMoves, observation } = require('../../src/engine/game');

describe('self-play: policies', () => {
  it('always chooses a legal card, for every policy, over many positions', () => {
    for (const name of Object.keys(POLICIES)) {
      const policy = makePolicy(name);
      for (let seed = 0; seed < 25; seed++) {
        let match = startHand(createMatch({ playerIds: ['a', 'b', 'c', 'd'], seed: `pol-${seed}` }));
        let guard = 0;
        while (match.phase === 'playing' && guard++ < 60) {
          const turn = match.hand.turn;
          const choice = policy.choose(observation(match, turn));
          expect(legalMoves(match, turn), `${name} @ seed ${seed}`).to.include(choice);
          match = require('../../src/engine/game').playCard(match, turn, choice).match;
        }
      }
    }
  });

  it('rejects an unknown policy by name', () => {
    expect(() => makePolicy('magic')).to.throw(/Unknown policy/);
  });
});

describe('self-play: runner', () => {
  it('plays a match to completion and declares an outcome', () => {
    const summary = runMatch({ seed: 'r1' });
    expect(summary.outcome).to.not.equal(null);
    expect(summary.outcome.winners).to.have.length.of.at.least(1);
    expect(summary.hands).to.be.greaterThan(0);
  });

  it('is reproducible: the same seed yields identical results', () => {
    const a = runMatch({ seed: 'repeat' });
    const b = runMatch({ seed: 'repeat' });
    expect(a.totals).to.deep.equal(b.totals);
    expect(a.hands).to.equal(b.hands);
  });

  it('emits one record per decision, each with the realised reward', () => {
    const records = [];
    runMatch({ seed: 'rec', onRecord: r => records.push(r) });
    expect(records.length % 52).to.equal(0, 'every hand contributes 52 decisions');

    for (const record of records) {
      expect(record.legalMoves).to.include(record.action);
      expect(record.reward).to.be.a('number');
      expect(record.reward).to.equal(record.handScores[record.player]);
      expect(record.observation.hand).to.include(record.action);
    }
  });

  it('never leaks another player\'s cards into a record', () => {
    const records = [];
    runMatch({ seed: 'leak', onRecord: r => records.push(r) });
    for (const record of records.slice(0, 200)) {
      expect(record.observation).to.not.have.property('hands');
      expect(record.observation.hand).to.have.length.of.at.most(13);
    }
  });

  it('supports both scoring modes and both heart variants', () => {
    const teams = { team1: ['p0', 'p2'], team2: ['p1', 'p3'] };
    const teamGame = runMatch({ seed: 't1', options: { teams } });
    expect(teamGame.teamTotals).to.have.keys(['team1', 'team2']);
    expect(teamGame.outcome.kind).to.equal('teams');

    const solo = runMatch({ seed: 't1' });
    expect(solo.teamTotals).to.equal(null);
    expect(solo.outcome.kind).to.equal('individual');

    const pips = runMatch({ seed: 't1', options: { variant: 'pips' } });
    expect(pips.totals).to.not.deep.equal(solo.totals);
  });
});

describe('self-play: batch', () => {
  it('aggregates wins and net scores across matches', () => {
    const stats = runBatch({ games: 5, seedPrefix: 'agg' });
    expect(stats.games).to.equal(5);
    expect(stats.handsPlayed).to.be.greaterThan(0);
    expect(Object.values(stats.wins).reduce((a, b) => a + b, 0)).to.be.greaterThan(0);
  });

  it('shows the heuristic policy beating random over a batch', () => {
    const stats = runBatch({
      games: 30,
      seedPrefix: 'strength',
      policyNames: ['avoidPoints', 'random', 'avoidPoints', 'random'],
    });
    const heuristic = stats.scoreTotals.p0 + stats.scoreTotals.p2;
    const random = stats.scoreTotals.p1 + stats.scoreTotals.p3;
    expect(heuristic).to.be.greaterThan(random);
  });
});
