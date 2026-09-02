// Card helpers. A card is a string: rank followed by a single suit character,
// e.g. "2♣", "10♦", "Q♠".

export type TrickEntry = { player: string; card: string | null };

/** Display order for suits in a hand. */
export const SUIT_ORDER = ['♠', '♥', '♣', '♦'];

/** Ascending rank order. */
export const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const POINT_SUIT = '♥';
export const POINT_CARDS = ['Q♠', 'J♦', '10♣'];

export function getSuit(card: string): string {
  return card.slice(-1);
}

export function getRank(card: string): string {
  return card.slice(0, -1);
}

/** Ascending rank index; -1 for an unrecognised rank. */
export function rankValue(card: string): number {
  return RANK_ORDER.indexOf(getRank(card));
}

/** Sorts a copy of the hand by suit (♠ ♥ ♣ ♦), then by rank 2 → A within a suit. */
export function sortHand(cards: string[]): string[] {
  return [...cards].sort((a, b) => {
    const bySuit = SUIT_ORDER.indexOf(getSuit(a)) - SUIT_ORDER.indexOf(getSuit(b));
    return bySuit !== 0 ? bySuit : rankValue(a) - rankValue(b);
  });
}

/** Cards that carry a score: every heart, plus Q♠, J♦ and 10♣. */
export function isPointCard(card: string): boolean {
  return getSuit(card) === POINT_SUIT || POINT_CARDS.includes(card);
}

export function pointCards(cards: string[]): string[] {
  return cards.filter(isPointCard);
}

export function cardColor(card: string): string {
  const suit = getSuit(card);
  if (suit === '♥' || suit === '♦') return '#c62828';
  if (suit === '♠' || suit === '♣') return '#111';
  return 'inherit';
}
