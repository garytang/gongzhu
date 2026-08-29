'use strict';

const { expect } = require('chai');
const { PIG, SHEEP, TWO_CLUBS, suitOf } = require('../../src/engine/cards');
const {
  createMatch, startHand, legalMoves, playCard, observation,
  determineTrickWinner, evaluateMatchEnd, exposeCard, dealFor,
  RulesError, SEATS, HAND_SIZE,
} = require('../../src/engine/game');

const PLAYERS = ['a', 'b', 'c', 'd'];
const newMatch = (options = {}, seed = 'test-seed') =>
  startHand(createMatch({ playerIds: PLAYERS, seed, options }));

/** Drive the match to completion, always taking the first legal move. */
function playOut(match, pick = moves => moves[0]) {
  let guard = 0;
  while (match.phase === 'playing' && guard++ < 100) {
    const turn = match.hand.turn;
    match = playCard(match, turn, pick(legalMoves(match, turn), match)).match;
  }
  return match;
}

describe('game: setup', () => {
  it('requires exactly four unique players', () => {
    expect(() => createMatch({ playerIds: ['a', 'b', 'c'] })).to.throw(RulesError);
    expect(() => createMatch({ playerIds: ['a', 'b', 'c', 'a'] })).to.throw(RulesError, /unique/);
  });

  it('rejects teams that do not partition the seated players', () => {
    expect(() => createMatch({
      playerIds: PLAYERS,
      options: { teams: { team1: ['a', 'b'], team2: ['c', 'x'] } },
    })).to.throw(RulesError, /partition/);
  });

  it('deals thirteen cards to each of four players, using the whole deck once', () => {
    const match = newMatch();
    const all = [];
    for (const id of PLAYERS) {
      expect(match.hand.hands[id]).to.have.lengthOf(HAND_SIZE);
      all.push(...match.hand.hands[id]);
    }
    expect(all).to.have.lengthOf(SEATS * HAND_SIZE);
    expect(new Set(all).size).to.equal(52);
  });

  it('is deterministic: the same seed deals the same cards', () => {
    expect(dealFor({ seed: 's1', playerIds: PLAYERS }, 1))
      .to.deep.equal(dealFor({ seed: 's1', playerIds: PLAYERS }, 1));
    expect(dealFor({ seed: 's1', playerIds: PLAYERS }, 1))
      .to.not.deep.equal(dealFor({ seed: 's2', playerIds: PLAYERS }, 1));
  });

  it('deals hand 2 differently from hand 1 under the same seed', () => {
    expect(dealFor({ seed: 's1', playerIds: PLAYERS }, 1))
      .to.not.deep.equal(dealFor({ seed: 's1', playerIds: PLAYERS }, 2));
  });
});

describe('game: opening lead', () => {
  it('forces the holder of 2♣ to lead it on the first hand', () => {
    const match = newMatch();
    const leader = match.hand.leader;
    expect(match.hand.hands[leader]).to.include(TWO_CLUBS);
    expect(legalMoves(match, leader)).to.deep.equal([TWO_CLUBS]);
  });

  it('gives nobody else a legal move before the lead', () => {
    const match = newMatch();
    for (const id of PLAYERS.filter(p => p !== match.hand.leader)) {
      expect(legalMoves(match, id)).to.deep.equal([]);
    }
  });

  it('allows a free lead when configured that way', () => {
    const match = newMatch({ firstLead: 'free' });
    expect(legalMoves(match, match.hand.leader)).to.have.lengthOf(HAND_SIZE);
  });

  it('lets the previous pig-taker lead the next hand', () => {
    let match = playOut(newMatch());
    const pigTaker = match.results[0].pigTaker;
    expect(pigTaker).to.be.a('string');
    match = startHand(match);
    expect(match.hand.leader).to.equal(pigTaker);
    expect(match.hand.mustPlay).to.equal(null);
  });
});

describe('game: legal moves', () => {
  it('requires following the led suit when able', () => {
    let match = newMatch();
    match = playCard(match, match.hand.turn, TWO_CLUBS).match;
    const next = match.hand.turn;
    const clubs = match.hand.hands[next].filter(c => suitOf(c) === '♣');
    if (clubs.length > 0) {
      expect(legalMoves(match, next)).to.deep.equal(clubs);
    } else {
      expect(legalMoves(match, next)).to.deep.equal(match.hand.hands[next]);
    }
  });

  it('allows any card when void in the led suit', () => {
    const match = newMatch();
    const void_ = { ...match, hand: { ...match.hand,
      trick: [{ player: 'a', card: 'K♠' }],
      turn: 'b',
      mustPlay: null,
      hands: { ...match.hand.hands, b: ['2♥', '3♦', '4♣'] },
    } };
    expect(legalMoves(void_, 'b')).to.deep.equal(['2♥', '3♦', '4♣']);
  });

  it('returns nothing for a player who is not on turn', () => {
    const match = newMatch();
    const other = PLAYERS.find(p => p !== match.hand.turn);
    expect(legalMoves(match, other)).to.deep.equal([]);
  });

  it('refuses an illegal card', () => {
    const match = newMatch();
    const leader = match.hand.leader;
    const illegal = match.hand.hands[leader].find(c => c !== TWO_CLUBS);
    expect(() => playCard(match, leader, illegal)).to.throw(RulesError, /not a legal play/);
  });

  it('refuses a play out of turn', () => {
    const match = newMatch();
    const other = PLAYERS.find(p => p !== match.hand.turn);
    expect(() => playCard(match, other, match.hand.hands[other][0]))
      .to.throw(RulesError, /not .*turn/);
  });
});

describe('game: exposure restrictions', () => {
  it('bars an exposed card from the first trick its suit is led', () => {
    const base = newMatch({ exposuresEnabled: true });
    const match = { ...base, phase: 'playing', hand: { ...base.hand,
      exposed: [PIG],
      suitsLed: [],
      trick: [{ player: 'a', card: '3♠' }],
      turn: 'b',
      mustPlay: null,
      hands: { ...base.hand.hands, b: [PIG, '5♠', '2♥'] },
    } };
    expect(legalMoves(match, 'b')).to.deep.equal(['5♠']);
  });

  it('allows the exposed card when it is the only one of its suit', () => {
    const base = newMatch({ exposuresEnabled: true });
    const match = { ...base, phase: 'playing', hand: { ...base.hand,
      exposed: [PIG],
      suitsLed: [],
      trick: [{ player: 'a', card: '3♠' }],
      turn: 'b',
      mustPlay: null,
      hands: { ...base.hand.hands, b: [PIG, '2♥'] },
    } };
    expect(legalMoves(match, 'b')).to.deep.equal([PIG]);
  });

  it('lifts the restriction once the suit has been led before', () => {
    const base = newMatch({ exposuresEnabled: true });
    const match = { ...base, phase: 'playing', hand: { ...base.hand,
      exposed: [PIG],
      suitsLed: ['♠'],
      trick: [{ player: 'a', card: '3♠' }],
      turn: 'b',
      mustPlay: null,
      hands: { ...base.hand.hands, b: [PIG, '5♠'] },
    } };
    expect(legalMoves(match, 'b')).to.deep.equal([PIG, '5♠']);
  });

  it('rejects exposing a card the player does not hold', () => {
    const match = newMatch({ exposuresEnabled: true });
    const nonHolder = PLAYERS.find(id => !match.hand.hands[id].includes(PIG));
    expect(() => exposeCard(match, nonHolder, PIG)).to.throw(RulesError, /does not hold/);
  });

  it('rejects exposing a card that is not exposable', () => {
    const match = newMatch({ exposuresEnabled: true });
    expect(() => exposeCard(match, 'a', '3♠')).to.throw(RulesError, /cannot be exposed/);
  });
});

describe('game: trick resolution', () => {
  it('awards the trick to the highest card of the led suit', () => {
    expect(determineTrickWinner([
      { player: 'a', card: '5♣' }, { player: 'b', card: 'K♣' },
      { player: 'c', card: 'A♠' }, { player: 'd', card: '2♣' },
    ])).to.equal('b');
  });

  it('ignores higher cards of other suits — there is no trump', () => {
    expect(determineTrickWinner([
      { player: 'a', card: '2♦' }, { player: 'b', card: 'A♠' },
      { player: 'c', card: 'A♥' }, { player: 'd', card: 'A♣' },
    ])).to.equal('a');
  });

  it('gives the trick winner the lead and the cards', () => {
    let match = newMatch();
    for (let i = 0; i < SEATS; i++) {
      match = playCard(match, match.hand.turn, legalMoves(match, match.hand.turn)[0]).match;
    }
    const winner = match.hand.lastTrick.winner;
    expect(match.hand.turn).to.equal(winner);
    expect(match.hand.collected[winner]).to.have.lengthOf(SEATS);
    expect(match.hand.trick).to.deep.equal([]);
  });

  it('emits card_played and trick_won events', () => {
    let match = newMatch();
    const seen = [];
    for (let i = 0; i < SEATS; i++) {
      const res = playCard(match, match.hand.turn, legalMoves(match, match.hand.turn)[0]);
      match = res.match;
      seen.push(...res.events.map(e => e.type));
    }
    expect(seen.filter(t => t === 'card_played')).to.have.lengthOf(4);
    expect(seen).to.include('trick_won');
  });
});

describe('game: hand completion', () => {
  it('plays 13 tricks and distributes all 52 cards', () => {
    const match = playOut(newMatch());
    expect(match.phase).to.be.oneOf(['handComplete', 'matchComplete']);
    const collected = Object.values(match.hand.collected).flat();
    expect(collected).to.have.lengthOf(52);
    expect(new Set(collected).size).to.equal(52);
  });

  it('records the hand result and updates cumulative totals', () => {
    const match = playOut(newMatch());
    expect(match.results).to.have.lengthOf(1);
    const result = match.results[0];
    expect(match.totals).to.deep.equal(result.individual);
    expect(result.pigTaker).to.be.a('string');
  });

  it('tracks team totals alongside individual totals', () => {
    const teams = { team1: ['a', 'c'], team2: ['b', 'd'] };
    const match = playOut(newMatch({ teams }));
    expect(match.teamTotals.team1).to.equal(match.totals.a + match.totals.c);
    expect(match.teamTotals.team2).to.equal(match.totals.b + match.totals.d);
  });

  it('refuses a play once the hand is over', () => {
    const match = playOut(newMatch());
    expect(() => playCard(match, 'a', '2♠')).to.throw(RulesError, /phase/);
  });
});

describe('game: match end', () => {
  const base = createMatch({ playerIds: PLAYERS, seed: 'end' });

  it('does not end while everyone is inside the target', () => {
    expect(evaluateMatchEnd({ ...base, totals: { a: 900, b: -900, c: 0, d: 0 } })).to.equal(null);
  });

  it('ends when a player reaches the positive target', () => {
    const outcome = evaluateMatchEnd({ ...base, totals: { a: 1000, b: -400, c: 0, d: 0 } });
    expect(outcome.winners).to.deep.equal(['a']);
    expect(outcome.losers).to.deep.equal(['b']);
  });

  it('ends when a player reaches the negative target', () => {
    const outcome = evaluateMatchEnd({ ...base, totals: { a: 100, b: -1000, c: 50, d: 0 } });
    expect(outcome.winners).to.deep.equal(['a']);
    expect(outcome.losers).to.deep.equal(['b']);
  });

  it('resolves a simultaneous crossing by highest total, never ambiguously', () => {
    const teamBase = createMatch({
      playerIds: PLAYERS,
      options: { teams: { team1: ['a', 'c'], team2: ['b', 'd'] } },
    });
    const outcome = evaluateMatchEnd({ ...teamBase, teamTotals: { team1: 1000, team2: -1000 } });
    expect(outcome.winners).to.deep.equal(['team1']);
    expect(outcome.losers).to.deep.equal(['team2']);
  });

  it('refuses to start a hand after the match is complete', () => {
    expect(() => startHand({ ...base, phase: 'matchComplete' })).to.throw(RulesError, /complete/);
  });
});

describe('game: observation', () => {
  it('never reveals another player\'s hand', () => {
    const match = newMatch();
    const view = observation(match, 'a');
    expect(view.hand).to.deep.equal(match.hand.hands.a);
    expect(JSON.stringify(view)).to.not.include(match.hand.hands.b[0] + '","');
    expect(view.handCounts).to.deep.equal({ a: 13, b: 13, c: 13, d: 13 });
  });

  it('reports legal moves and the teammate when playing in partnership', () => {
    const teams = { team1: ['a', 'c'], team2: ['b', 'd'] };
    const match = newMatch({ teams });
    expect(observation(match, 'a').teammate).to.equal('c');
    expect(observation(match, 'b').teammate).to.equal('d');
    expect(observation(match, match.hand.turn).legalMoves).to.deep.equal([TWO_CLUBS]);
  });

  it('omits a teammate for individual play', () => {
    expect(observation(newMatch(), 'a').teammate).to.equal(null);
  });
});

describe('game: invariants over many seeded matches', () => {
  it('conserves all 52 cards and produces consistent totals across 200 hands', () => {
    for (let seed = 0; seed < 200; seed++) {
      const match = playOut(newMatch({}, `seed-${seed}`), moves => moves[moves.length - 1]);
      const collected = Object.values(match.hand.collected).flat();
      expect(new Set(collected).size, `seed ${seed}`).to.equal(52);
      const summed = Object.values(match.results[0].individual).reduce((s, v) => s + v, 0);
      expect(match.totals.a + match.totals.b + match.totals.c + match.totals.d).to.equal(summed);
    }
  });

  it('always leaves exactly one player holding the pig', () => {
    for (let seed = 0; seed < 50; seed++) {
      const match = playOut(newMatch({}, `pig-${seed}`));
      const holders = PLAYERS.filter(id => match.hand.collected[id].includes(PIG));
      expect(holders).to.have.lengthOf(1);
      expect(match.results[0].pigTaker).to.equal(holders[0]);
    }
  });
});
