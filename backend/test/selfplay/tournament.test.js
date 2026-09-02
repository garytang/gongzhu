'use strict';

const { expect } = require('chai');
const {
  runTournament, seatingsFor, formatTable, summarise, proportion,
} = require('../../src/selfplay/tournament');

describe('self-play: tournament seatings', () => {
  it('gives every policy every seat an equal number of times', () => {
    for (const names of [['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']]) {
      const seatings = seatingsFor(names, 'individual');
      for (const name of names) {
        const perSeat = [0, 1, 2, 3].map(
          seat => seatings.filter(s => s[seat] === name).length,
        );
        expect(new Set(perSeat).size, `${names.join('')} / ${name}`).to.equal(1);
      }
    }
  });

  it('plays every pair in both seatings for partnerships', () => {
    const seatings = seatingsFor(['a', 'b', 'c'], 'teams');
    expect(seatings).to.have.length(6); // 3 pairs x 2 seatings
    for (const seats of seatings) {
      expect(seats[0]).to.equal(seats[2]);
      expect(seats[1]).to.equal(seats[3]);
      expect(seats[0]).to.not.equal(seats[1]);
    }
  });

  it('needs at least two policies', () => {
    expect(() => seatingsFor(['a'], 'individual')).to.throw(/at least two/);
  });
});

describe('self-play: confidence intervals', () => {
  it('reports a mean with a shrinking interval', () => {
    const small = summarise([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const large = summarise(Array.from({ length: 1000 }, (_, i) => (i % 10) + 1));
    expect(small.mean).to.be.closeTo(5.5, 1e-9);
    expect(large.mean).to.be.closeTo(5.5, 1e-9);
    expect(large.ci).to.be.lessThan(small.ci);
  });

  it('reports a proportion with a normal-approximation interval', () => {
    const half = proportion(50, 100);
    expect(half.rate).to.equal(0.5);
    expect(half.ci).to.be.closeTo(1.959964 * Math.sqrt(0.25 / 100), 1e-6);
    expect(proportion(0, 0)).to.deep.equal({ rate: 0, ci: 0, n: 0 });
  });
});

describe('self-play: tournament', function tournamentSuite() {
  this.timeout(30000);

  it('is reproducible from its seed', async () => {
    const args = { policyNames: ['avoidPoints', 'lowest'], matches: 2, seed: 'repeatable' };
    const a = await runTournament(args);
    const b = await runTournament(args);
    expect(a.rows).to.deep.equal(b.rows);
  });

  it('reports win rate and mean hand score for each policy', async () => {
    const result = await runTournament({
      policyNames: ['avoidPoints', 'random'],
      matches: 3,
      seed: 'report',
    });
    expect(result.matchesPlayed).to.equal(result.seatings * 3);
    expect(result.rows.map(r => r.policy)).to.have.members(['avoidPoints', 'random']);
    for (const row of result.rows) {
      expect(row.winRate).to.be.within(0, 1);
      expect(row.hands).to.be.greaterThan(0);
      expect(row.meanHandScoreCi).to.be.greaterThan(0);
    }
    // Win rates sum to at least one: every match has a winner, and ties credit both.
    expect(result.rows.reduce((sum, r) => sum + r.winRate, 0)).to.be.at.least(0.99);
    expect(formatTable(result)).to.include('mean hand score');
  });

  it('runs partnerships and scores by team', async () => {
    const result = await runTournament({
      policyNames: ['avoidPoints', 'random'],
      matches: 3,
      seed: 'teams',
      mode: 'teams',
    });
    expect(result.mode).to.equal('teams');
    expect(result.seatings).to.equal(2);
    const avoid = result.rows.find(r => r.policy === 'avoidPoints');
    expect(avoid.winRate).to.be.greaterThan(0.5);
  });
});
