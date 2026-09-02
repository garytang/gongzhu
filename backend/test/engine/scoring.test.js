'use strict';

const { expect } = require('chai');
const {
  ALL_HEARTS, PIG, SHEEP, TRANSFORMER, ACE_HEARTS,
} = require('../../src/engine/cards');
const {
  HEART_TABLES, heartSuitTotal, scorePlayerCards, scoreHand,
} = require('../../src/engine/scoring');

const score = (cards, opts) => scorePlayerCards(cards, opts).score;

describe('scoring: heart tables', () => {
  it('both variants total -200 across the suit, so 全紅 is +200 either way', () => {
    expect(heartSuitTotal('standard')).to.equal(-200);
    expect(heartSuitTotal('pips')).to.equal(-200);
  });

  it('uses the published standard table', () => {
    const t = HEART_TABLES.standard;
    expect([t.A, t.K, t.Q, t.J]).to.deep.equal([-50, -40, -30, -20]);
    expect([t[10], t[9], t[8], t[7], t[6], t[5]]).to.deep.equal([-10, -10, -10, -10, -10, -10]);
    expect([t[4], t[3], t[2]]).to.deep.equal([0, 0, 0]);
  });

  it('scores low hearts as zero under standard and as pips under the house rule', () => {
    expect(score(['2♥', '3♥', '4♥'])).to.equal(0);
    expect(score(['2♥', '3♥', '4♥'], { variant: 'pips' })).to.equal(-15);
  });

  it('rejects an unknown variant', () => {
    expect(() => score(['2♥'], { variant: 'nope' })).to.throw(/variant/);
  });
});

describe('scoring: individual point cards', () => {
  it('scores the pig, sheep and plain hearts', () => {
    expect(score([PIG])).to.equal(-100);
    expect(score([SHEEP])).to.equal(100);
    expect(score([ACE_HEARTS, 'K♥'])).to.equal(-90);
    expect(score(['2♠', '3♦', '9♣'])).to.equal(0);
  });

  it('scores the transformer as +50 alone and as a doubler otherwise', () => {
    expect(score([TRANSFORMER])).to.equal(50);
    expect(score([TRANSFORMER, '2♠'])).to.equal(50, 'non-point cards do not stop the bonus');
    expect(score([TRANSFORMER, PIG])).to.equal(-200);
    expect(score([TRANSFORMER, SHEEP])).to.equal(200);
    expect(score([TRANSFORMER, ACE_HEARTS])).to.equal(-100);
  });
});

describe('scoring: exposure (亮牌) doubling', () => {
  it('doubles the pig and the sheep', () => {
    expect(score([PIG], { exposed: [PIG] })).to.equal(-200);
    expect(score([SHEEP], { exposed: [SHEEP] })).to.equal(200);
  });

  it('doubles every heart when the ace is exposed', () => {
    expect(score([ACE_HEARTS, 'K♥'], { exposed: [ACE_HEARTS] })).to.equal(-180);
  });

  it('makes the transformer quadruple, and worth +100 alone', () => {
    expect(score([TRANSFORMER], { exposed: [TRANSFORMER] })).to.equal(100);
    expect(score([TRANSFORMER, PIG], { exposed: [TRANSFORMER] })).to.equal(-400);
    expect(score([TRANSFORMER, PIG], { exposed: [TRANSFORMER, PIG] })).to.equal(-800);
  });

  it('doubles for whoever takes the card, not whoever exposed it', () => {
    // The pig's holder exposed it and then dumped it; the taker eats the doubled value.
    const result = scoreHand({ taker: [PIG], exposer: [] }, { exposed: [PIG] });
    expect(result.individual.taker).to.equal(-200);
    expect(result.individual.exposer).to.equal(0);
  });
});

describe('scoring: slams', () => {
  it('flips all hearts to +200 (全紅)', () => {
    expect(score(ALL_HEARTS)).to.equal(200);
    expect(score(ALL_HEARTS, { variant: 'pips' })).to.equal(200);
    expect(score(ALL_HEARTS, { exposed: [ACE_HEARTS] })).to.equal(400);
  });

  it('turns the pig positive for a player who swept the hearts', () => {
    expect(score([...ALL_HEARTS, PIG])).to.equal(300);
  });

  it('scores 小滿貫 at +400 and 大滿貫 at +800', () => {
    expect(score([...ALL_HEARTS, PIG, SHEEP])).to.equal(400);
    expect(score([...ALL_HEARTS, PIG, SHEEP, TRANSFORMER])).to.equal(800);
  });

  it('scores a fully exposed 大滿貫 at +3200', () => {
    const everything = [...ALL_HEARTS, PIG, SHEEP, TRANSFORMER];
    const exposed = [ACE_HEARTS, PIG, SHEEP, TRANSFORMER];
    expect(score(everything, { exposed })).to.equal(3200);
  });

  it('flags slams distinctly', () => {
    expect(scorePlayerCards([...ALL_HEARTS, PIG, SHEEP]).isSmallSlam).to.equal(true);
    expect(scorePlayerCards([...ALL_HEARTS, PIG, SHEEP]).isGrandSlam).to.equal(false);
    expect(scorePlayerCards([...ALL_HEARTS, PIG, SHEEP, TRANSFORMER]).isGrandSlam).to.equal(true);
    expect(scorePlayerCards(ALL_HEARTS.slice(1)).hasAllHearts).to.equal(false);
  });
});

describe('scoring: team aggregation', () => {
  const teams = { team1: ['a', 'c'], team2: ['b', 'd'] };

  it('derives team totals from individual scores', () => {
    const result = scoreHand(
      { a: [PIG], b: [SHEEP], c: [ACE_HEARTS], d: [] },
      { teams },
    );
    expect(result.individual).to.deep.equal({ a: -100, b: 100, c: -50, d: 0 });
    expect(result.teamScores).to.deep.equal({ team1: -150, team2: 100 });
  });

  it('omits team scores entirely for individual play', () => {
    const result = scoreHand({ a: [PIG], b: [], c: [], d: [] }, {});
    expect(result.teamScores).to.equal(null);
  });

  it('sums to -200 over a whole hand when no transformer or slam is involved', () => {
    const result = scoreHand(
      { a: ALL_HEARTS.slice(0, 7), b: ALL_HEARTS.slice(7), c: [PIG], d: [SHEEP] },
      {},
    );
    const total = Object.values(result.individual).reduce((s, v) => s + v, 0);
    expect(total).to.equal(-200);
  });
});
