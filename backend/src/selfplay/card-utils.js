'use strict';

const { rankValue } = require('../engine/cards');
const { determineTrickWinner } = require('../engine/game');

/**
 * Card-picking helpers shared by the heuristic policies. Ties are broken by the card
 * string so a choice never depends on the order cards happen to sit in a hand.
 */
function byRankAsc(a, b) {
  return rankValue(a) - rankValue(b) || (a < b ? -1 : 1);
}

function lowest(cards) {
  return cards.reduce((best, card) => (byRankAsc(card, best) < 0 ? card : best));
}

function highest(cards) {
  return cards.reduce((best, card) => (byRankAsc(card, best) > 0 ? card : best));
}

/** The play currently winning the trick, decided by the same rule the engine uses. */
function winningPlay(trick) {
  const winner = determineTrickWinner(trick);
  return trick.find(play => play.player === winner);
}

module.exports = { byRankAsc, lowest, highest, winningPlay };
