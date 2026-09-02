'use strict';

/**
 * Card primitives. A card is a string: rank followed by suit glyph, e.g. "10♣", "Q♠".
 * This encoding is kept for wire-compatibility with the existing client.
 */

const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const HEARTS = '♥';
const SPADES = '♠';
const CLUBS = '♣';
const DIAMONDS = '♦';

// The four cards with special roles.
const PIG = 'Q♠';          // 豬
const SHEEP = 'J♦';        // 羊
const TRANSFORMER = '10♣'; // 變壓器
const ACE_HEARTS = 'A♥';
const TWO_CLUBS = '2♣';

// The cards that may be exposed (亮牌) before play.
const EXPOSABLE = [ACE_HEARTS, PIG, SHEEP, TRANSFORMER];

function suitOf(card) {
  return card.slice(-1);
}

function rankOf(card) {
  return card.slice(0, -1);
}

/** Ordinal rank used for trick comparison; higher beats lower. */
function rankValue(card) {
  return RANKS.indexOf(rankOf(card));
}

function isHeart(card) {
  return suitOf(card) === HEARTS;
}

/** Point cards are the ones that can affect the score: all hearts, plus pig, sheep, transformer. */
function isPointCard(card) {
  return isHeart(card) || card === PIG || card === SHEEP || card === TRANSFORMER;
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

const ALL_HEARTS = RANKS.map(r => `${r}${HEARTS}`);

module.exports = {
  SUITS,
  RANKS,
  HEARTS,
  SPADES,
  CLUBS,
  DIAMONDS,
  PIG,
  SHEEP,
  TRANSFORMER,
  ACE_HEARTS,
  TWO_CLUBS,
  EXPOSABLE,
  ALL_HEARTS,
  suitOf,
  rankOf,
  rankValue,
  isHeart,
  isPointCard,
  createDeck,
};
