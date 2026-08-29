'use strict';

const {
  PIG,
  TWO_CLUBS,
  EXPOSABLE,
  suitOf,
  rankValue,
  createDeck,
} = require('./cards');
const { createRng, shuffled } = require('./rng');
const { scoreHand, DEFAULT_VARIANT } = require('./scoring');

const HAND_SIZE = 13;
const SEATS = 4;

const DEFAULT_OPTIONS = {
  variant: DEFAULT_VARIANT,   // 'standard' | 'pips'
  teams: null,                // null for individual play, else { team1: [id,id], team2: [id,id] }
  targetScore: 1000,          // match ends when someone reaches +target or -target
  firstLead: 'clubs2',        // 'clubs2' | 'free'
  exposuresEnabled: false,    // the 亮牌 declare phase; scoring honours exposures either way
};

class RulesError extends Error {}

/**
 * Create a match. Deterministic: the same seed and seat order always deal the same cards.
 */
function createMatch({ playerIds, seed = Date.now(), options = {} } = {}) {
  if (!Array.isArray(playerIds) || playerIds.length !== SEATS) {
    throw new RulesError(`A match needs exactly ${SEATS} players, got ${playerIds ? playerIds.length : 0}`);
  }
  if (new Set(playerIds).size !== SEATS) {
    throw new RulesError('Player ids must be unique');
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (opts.teams) {
    const members = [...opts.teams.team1, ...opts.teams.team2];
    if (members.length !== SEATS || members.some(id => !playerIds.includes(id))) {
      throw new RulesError('Teams must partition exactly the four seated players');
    }
  }

  return {
    playerIds: playerIds.slice(),
    options: opts,
    seed,
    handNumber: 0,
    totals: Object.fromEntries(playerIds.map(id => [id, 0])),
    teamTotals: opts.teams ? { team1: 0, team2: 0 } : null,
    hand: null,
    phase: 'awaitingDeal',
    results: [],
  };
}

/** Per-hand deal seed, so hand N of a seed is reproducible without replaying hands 1..N-1. */
function dealFor(match, handNumber) {
  const rng = createRng(`${match.seed}:${handNumber}`);
  const deck = shuffled(createDeck(), rng);
  const hands = {};
  match.playerIds.forEach((id, seat) => {
    hands[id] = deck.slice(seat * HAND_SIZE, (seat + 1) * HAND_SIZE);
  });
  return hands;
}

function holderOf(hands, card) {
  return Object.keys(hands).find(id => hands[id].includes(card));
}

/** Deal the next hand and set the opening lead. */
function startHand(match) {
  if (match.phase === 'matchComplete') {
    throw new RulesError('Match is already complete');
  }

  const handNumber = match.handNumber + 1;
  const hands = dealFor(match, handNumber);

  // First hand: the 2♣ holder leads and is required to play it. Later hands are led
  // by whoever took the pig previously, with a free choice of card.
  const previous = match.results[match.results.length - 1];
  let leader;
  let mustPlay = null;
  if (match.options.firstLead === 'clubs2' && !previous) {
    leader = holderOf(hands, TWO_CLUBS);
    mustPlay = TWO_CLUBS;
  } else if (previous && previous.pigTaker && match.playerIds.includes(previous.pigTaker)) {
    leader = previous.pigTaker;
  } else {
    leader = match.playerIds[(handNumber - 1) % SEATS];
  }

  return {
    ...match,
    handNumber,
    phase: match.options.exposuresEnabled ? 'exposing' : 'playing',
    hand: {
      hands,
      collected: Object.fromEntries(match.playerIds.map(id => [id, []])),
      exposed: [],
      exposedBy: {},
      trick: [],
      trickNumber: 1,
      suitsLed: [],
      leader,
      turn: leader,
      mustPlay,
      lastTrick: null,
    },
  };
}

/**
 * Expose (亮) a card before play. Scoring already honours exposures; this is the
 * declare phase, off by default until the UI and bot policies support it.
 */
function exposeCard(match, playerId, card) {
  if (match.phase !== 'exposing') {
    throw new RulesError('Cards can only be exposed before play begins');
  }
  if (!EXPOSABLE.includes(card)) {
    throw new RulesError(`${card} cannot be exposed`);
  }
  if (!match.hand.hands[playerId] || !match.hand.hands[playerId].includes(card)) {
    throw new RulesError(`${playerId} does not hold ${card}`);
  }
  if (match.hand.exposed.includes(card)) {
    return match;
  }
  return {
    ...match,
    hand: {
      ...match.hand,
      exposed: [...match.hand.exposed, card],
      exposedBy: { ...match.hand.exposedBy, [card]: playerId },
    },
  };
}

function finishExposing(match) {
  if (match.phase !== 'exposing') return match;
  return { ...match, phase: 'playing' };
}

/**
 * The cards `playerId` may legally play right now.
 * Returns [] when it is not their turn.
 */
function legalMoves(match, playerId) {
  if (match.phase !== 'playing' || !match.hand) return [];
  const hand = match.hand;
  if (hand.turn !== playerId) return [];

  const cards = hand.hands[playerId] || [];
  if (cards.length === 0) return [];

  // The opening lead of the first hand is forced.
  if (hand.trick.length === 0 && hand.mustPlay) {
    return cards.includes(hand.mustPlay) ? [hand.mustPlay] : cards.slice();
  }

  let candidates;
  if (hand.trick.length === 0) {
    candidates = cards.slice();
  } else {
    const ledSuit = suitOf(hand.trick[0].card);
    const following = cards.filter(card => suitOf(card) === ledSuit);
    candidates = following.length > 0 ? following : cards.slice();
  }

  // An exposed card may not be played to the first trick in which its suit is led,
  // unless it is the holder's only card of that suit.
  const restricted = candidates.filter(card => {
    if (!hand.exposed.includes(card)) return false;
    const suit = suitOf(card);
    if (hand.suitsLed.includes(suit)) return false;
    // Leading the exposed card's own suit for the first time is likewise barred.
    if (hand.trick.length > 0 && suitOf(hand.trick[0].card) !== suit) return false;
    const sameSuit = cards.filter(c => suitOf(c) === suit);
    return sameSuit.length > 1;
  });

  if (restricted.length > 0 && restricted.length < candidates.length) {
    return candidates.filter(card => !restricted.includes(card));
  }
  return candidates;
}

function determineTrickWinner(trick) {
  if (trick.length === 0) return null;
  const ledSuit = suitOf(trick[0].card);
  let best = trick[0];
  for (const play of trick.slice(1)) {
    if (suitOf(play.card) === ledSuit && rankValue(play.card) > rankValue(best.card)) {
      best = play;
    }
  }
  return best.player;
}

function settleHand(match, hand) {
  const { variant, teams } = match.options;
  const result = scoreHand(hand.collected, { variant, exposed: hand.exposed, teams });

  const totals = { ...match.totals };
  for (const [playerId, score] of Object.entries(result.individual)) {
    totals[playerId] += score;
  }

  let teamTotals = match.teamTotals;
  if (teams && result.teamScores) {
    teamTotals = {
      team1: match.teamTotals.team1 + result.teamScores.team1,
      team2: match.teamTotals.team2 + result.teamScores.team2,
    };
  }

  const handResult = {
    handNumber: match.handNumber,
    individual: result.individual,
    teamScores: result.teamScores,
    players: result.players,
    collected: hand.collected,
    exposed: hand.exposed,
    pigTaker: Object.keys(hand.collected).find(id => hand.collected[id].includes(PIG)) || null,
  };

  const outcome = evaluateMatchEnd({ ...match, totals, teamTotals });

  return {
    match: {
      ...match,
      totals,
      teamTotals,
      hand: { ...hand, turn: null },
      phase: outcome ? 'matchComplete' : 'handComplete',
      outcome: outcome || null,
      results: [...match.results, handResult],
    },
    handResult,
    outcome,
  };
}

/**
 * A match ends when any side reaches +target or -target. When several sides cross at
 * once the highest total wins outright, so a winner is never ambiguous.
 */
function evaluateMatchEnd(match) {
  const { targetScore, teams } = match.options;
  const entries = teams
    ? Object.entries(match.teamTotals)
    : Object.entries(match.totals);

  const crossed = entries.filter(([, total]) => total >= targetScore || total <= -targetScore);
  if (crossed.length === 0) return null;

  const ranked = entries.slice().sort((a, b) => b[1] - a[1]);
  const topScore = ranked[0][1];
  const winners = ranked.filter(([, total]) => total === topScore).map(([name]) => name);
  const bottomScore = ranked[ranked.length - 1][1];
  const losers = ranked.filter(([, total]) => total === bottomScore).map(([name]) => name);

  return {
    kind: teams ? 'teams' : 'individual',
    winners,
    losers,
    standings: ranked.map(([name, total]) => ({ name, total })),
  };
}

/**
 * Play one card. Pure: returns a new match plus the events that occurred.
 */
function playCard(match, playerId, card) {
  if (match.phase !== 'playing') {
    throw new RulesError(`Cannot play a card while phase is "${match.phase}"`);
  }
  const hand = match.hand;
  if (hand.turn !== playerId) {
    throw new RulesError(`It is not ${playerId}'s turn`);
  }
  const legal = legalMoves(match, playerId);
  if (!legal.includes(card)) {
    throw new RulesError(`${card} is not a legal play for ${playerId}`);
  }

  const events = [];
  const hands = { ...hand.hands, [playerId]: hand.hands[playerId].filter(c => c !== card) };
  const trick = [...hand.trick, { player: playerId, card }];
  const suitsLed = hand.trick.length === 0 && !hand.suitsLed.includes(suitOf(card))
    ? [...hand.suitsLed, suitOf(card)]
    : hand.suitsLed;

  events.push({ type: 'card_played', player: playerId, card });

  if (trick.length < SEATS) {
    const seat = match.playerIds.indexOf(playerId);
    const next = match.playerIds[(seat + 1) % SEATS];
    return {
      match: {
        ...match,
        hand: { ...hand, hands, trick, suitsLed, turn: next, mustPlay: null },
      },
      events,
    };
  }

  // Trick complete.
  const winner = determineTrickWinner(trick);
  const wonCards = trick.map(t => t.card);
  const collected = { ...hand.collected, [winner]: [...hand.collected[winner], ...wonCards] };
  events.push({ type: 'trick_won', winner, cards: wonCards, trick });

  const nextHand = {
    ...hand,
    hands,
    collected,
    trick: [],
    lastTrick: { trick, winner },
    trickNumber: hand.trickNumber + 1,
    suitsLed,
    leader: winner,
    turn: winner,
    mustPlay: null,
  };

  const handOver = Object.values(hands).every(cards => cards.length === 0);
  if (!handOver) {
    return { match: { ...match, hand: nextHand }, events };
  }

  const settled = settleHand(match, nextHand);
  events.push({ type: 'hand_complete', result: settled.handResult });
  if (settled.outcome) {
    events.push({ type: 'match_complete', outcome: settled.outcome });
  }
  return { match: settled.match, events };
}

/**
 * What one player can legitimately see. This is the feature vector for bots and the
 * natural unit for offline logging: never include another player's hand.
 */
function observation(match, playerId) {
  const hand = match.hand;
  if (!hand) return null;
  const { teams } = match.options;
  return {
    playerId,
    seat: match.playerIds.indexOf(playerId),
    handNumber: match.handNumber,
    trickNumber: hand.trickNumber,
    hand: (hand.hands[playerId] || []).slice(),
    legalMoves: legalMoves(match, playerId),
    trick: hand.trick.map(t => ({ ...t })),
    leader: hand.leader,
    turn: hand.turn,
    exposed: hand.exposed.slice(),
    collected: Object.fromEntries(Object.entries(hand.collected).map(([id, cards]) => [id, cards.slice()])),
    handCounts: Object.fromEntries(Object.entries(hand.hands).map(([id, cards]) => [id, cards.length])),
    playerIds: match.playerIds.slice(),
    totals: { ...match.totals },
    teamTotals: match.teamTotals ? { ...match.teamTotals } : null,
    teammate: teams
      ? [...teams.team1, ...teams.team2].find(id =>
          id !== playerId &&
          (teams.team1.includes(playerId) ? teams.team1 : teams.team2).includes(id))
      : null,
    variant: match.options.variant,
  };
}

module.exports = {
  HAND_SIZE,
  SEATS,
  DEFAULT_OPTIONS,
  RulesError,
  createMatch,
  startHand,
  exposeCard,
  finishExposing,
  legalMoves,
  playCard,
  observation,
  determineTrickWinner,
  evaluateMatchEnd,
  dealFor,
};
