'use strict';

const {
  PIG, SHEEP, TRANSFORMER, SPADES, DIAMONDS, HEARTS,
  isHeart, isPointCard, suitOf, rankOf, rankValue,
} = require('../engine/cards');
const { heartTable } = require('../engine/scoring');
const { byRankAsc, lowest, highest, winningPlay } = require('./card-utils');
const { HandTracker } = require('./tracker');

/**
 * `cardCounter` — a heuristic baseline that remembers the hand.
 *
 * On top of what `avoidPoints` does it keeps a `HandTracker`, which reconstructs every
 * completed trick from the observation stream. That buys three things `avoidPoints`
 * cannot do:
 *
 *   1. It knows which cards are gone, so it can tell a card that will certainly win a
 *      trick from one that only might.
 *   2. It knows who has shown void in which suit, so it avoids leading into a void
 *      while the pig and the high hearts are still out, and it knows when a player
 *      still to act cannot beat the card already on the table.
 *   3. In partnership play it distinguishes its teammate from its opponents: it feeds
 *      the sheep across the table, refuses to dump the pig or high hearts on its own
 *      side, and lets the teammate keep a trick it has already won.
 *
 * Fully deterministic — no RNG — so seeded batches remain reproducible.
 */

/**
 * Score of a single card taken in isolation. Positive is good for whoever takes it.
 * Exposures (亮牌) multiply several of these; the policy ignores that, which is
 * harmless only while `exposuresEnabled` is off.
 */
function cardValue(card, variant) {
  if (card === PIG) return -100;
  if (card === SHEEP) return 100;
  if (card === TRANSFORMER) return 0; // a multiplier, not a value; handled separately
  if (isHeart(card)) return heartTable(variant)[rankOf(card)];
  return 0;
}

function trickValue(trick, variant) {
  return trick.reduce((sum, play) => sum + cardValue(play.card, variant), 0);
}

/** The players who act after me in the current trick. */
function playersAfterMe(obs) {
  const remaining = obs.playerIds.length - obs.trick.length - 1;
  const after = [];
  for (let i = 1; i <= remaining; i++) {
    after.push(obs.playerIds[(obs.seat + i) % obs.playerIds.length]);
  }
  return after;
}

/**
 * True when no player left to act can outrank `card` in the led suit — either nothing
 * better is outstanding, or everyone still to act has shown void in it.
 */
function willHold(card, bestOutstanding, ledSuit, after, tracker) {
  if (!bestOutstanding || rankValue(bestOutstanding) <= rankValue(card)) return true;
  return after.every(id => tracker.isVoid(id, ledSuit));
}

/** The card I would least mind giving to a teammate, or losing outright. */
function harmlessDiscard(moves) {
  const plain = moves.filter(c => !isPointCard(c));
  return plain.length > 0 ? highest(plain) : lowest(moves);
}

/** Shed the biggest liability onto whoever is taking this trick. */
function dumpOnOpponent(moves, variant) {
  if (moves.includes(PIG)) return PIG;
  const hearts = moves.filter(c => isHeart(c) && cardValue(c, variant) < 0);
  if (hearts.length > 0) return highest(hearts);
  // Nothing painful to shed: drop the highest card that cannot win a trick later,
  // keeping the sheep and the transformer for a trick my own side can take.
  return harmlessDiscard(moves);
}

function chooseLead(obs, tracker) {
  const { hand, legalMoves: moves } = obs;
  const opponents = obs.playerIds.filter(id => id !== obs.playerId && id !== obs.teammate);
  const sheepOut = !tracker.played.has(SHEEP) && !hand.includes(SHEEP);
  const dangerOut = (!tracker.played.has(PIG) && !hand.includes(PIG))
    || tracker.outstanding(HEARTS, hand).length > 0;
  const holdPig = hand.includes(PIG);

  // Both depend only on the suit, and a hand holds at most four of them.
  const bestBySuit = new Map();
  const voidsBySuit = new Map();

  let choice = null;
  let choiceScore = -Infinity;
  for (const card of moves) {
    const suit = suitOf(card);
    if (!bestBySuit.has(suit)) {
      bestBySuit.set(suit, tracker.highestOutstanding(suit, hand));
      voidsBySuit.set(suit, tracker.countVoid(opponents, suit));
    }
    const rank = rankValue(card);
    const outstanding = bestBySuit.get(suit);
    const outranked = outstanding !== null && rankValue(outstanding) > rank;
    let score = -rank * 3;

    if (card === PIG) score -= 400;
    else if (card === SHEEP) score += outranked ? -250 : 300;
    else if (isHeart(card)) score -= 40 + rank * 2;
    else if (card === TRANSFORMER) score -= 60;

    // Someone above me will take this trick, which is exactly what a lead is for.
    if (outranked) score += 15;

    // Leading into a void hands a free discard to whoever is short.
    if (dangerOut) score -= 30 * voidsBySuit.get(suit);

    // Holding the pig, draw out the spades above it so it can be dumped later.
    if (holdPig && suit === SPADES && card !== PIG && rank < rankValue(PIG)) score += 25;

    // Holding the top diamond while the sheep is still out there: fish for it.
    if (suit === DIAMONDS && sheepOut && !outranked) score += 45;

    if (choice === null || score > choiceScore
        || (score === choiceScore && byRankAsc(card, choice) < 0)) {
      choice = card;
      choiceScore = score;
    }
  }
  return choice;
}

function chooseDiscard(obs, tracker, ledSuit, best, after) {
  const moves = obs.legalMoves;
  const teammateTakesIt = obs.teammate && best.player === obs.teammate
    && willHold(best.card, tracker.highestOutstanding(ledSuit, obs.hand), ledSuit, after, tracker);

  if (teammateTakesIt) {
    // Feed the sheep across the table; never hand our own side the pig or a high heart.
    if (moves.includes(SHEEP)) return SHEEP;
    return harmlessDiscard(moves);
  }
  return dumpOnOpponent(moves, obs.variant);
}

function chooseFollow(obs, tracker, ledSuit, best, after) {
  const moves = obs.legalMoves; // all in the led suit: the engine enforces following
  const winning = moves.filter(c => rankValue(c) > rankValue(best.card));
  const ducking = moves.filter(c => rankValue(c) < rankValue(best.card));
  const bestOutstanding = tracker.highestOutstanding(ledSuit, obs.hand);

  // Let a teammate keep a trick they are already going to take.
  if (obs.teammate && best.player === obs.teammate && ducking.length > 0
      && willHold(best.card, bestOutstanding, ledSuit, after, tracker)) {
    return highest(ducking);
  }

  // Worth taking: the trick pays, or it costs nothing and nobody acts after me.
  const value = trickValue(obs.trick, obs.variant);
  const wouldHold = winning.length > 0
    && willHold(highest(winning), bestOutstanding, ledSuit, after, tracker);
  if (wouldHold && (value > 0 || (value === 0 && after.length === 0))) {
    // The transformer doubles whatever else we take, so only claim the trick with it
    // when the trick itself is a gift.
    if (value > 0 && winning.includes(TRANSFORMER)) return TRANSFORMER;
    const withoutTransformer = winning.filter(c => c !== TRANSFORMER);
    return lowest(withoutTransformer.length > 0 ? withoutTransformer : winning);
  }

  if (ducking.length > 0) {
    // Duck as high as possible: burn the dangerous card while it is safe to.
    return highest(ducking);
  }
  return lowest(moves);
}

function decide(obs, tracker) {
  const moves = obs.legalMoves;
  if (moves.length === 1) return moves[0];
  if (obs.trick.length === 0) return chooseLead(obs, tracker);

  const ledSuit = suitOf(obs.trick[0].card);
  const best = winningPlay(obs.trick);
  const after = playersAfterMe(obs);
  return moves.some(c => suitOf(c) === ledSuit)
    ? chooseFollow(obs, tracker, ledSuit, best, after)
    : chooseDiscard(obs, tracker, ledSuit, best, after);
}

function cardCounterPolicy(name = 'cardCounter') {
  const tracker = new HandTracker();
  return {
    name,
    choose(obs) {
      tracker.observe(obs);
      return decide(obs, tracker);
    },
  };
}

module.exports = { cardCounterPolicy };
