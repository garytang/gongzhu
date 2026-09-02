import { pointCards, sortHand, trickWinner } from './cards';

describe('sortHand', () => {
  it('orders suits ♠ ♥ ♣ ♦ and ranks 2 → A within a suit', () => {
    const hand = ['3♦', 'A♠', '10♣', '2♥', '2♠', 'K♥', 'J♦', '2♣', '10♠'];
    expect(sortHand(hand)).toEqual(['2♠', '10♠', 'A♠', '2♥', 'K♥', '2♣', '10♣', '3♦', 'J♦']);
  });

  it('sorts 10 between 9 and J rather than lexically', () => {
    expect(sortHand(['J♠', '9♠', '10♠', '2♠'])).toEqual(['2♠', '9♠', '10♠', 'J♠']);
  });

  it('leaves the caller\'s array untouched', () => {
    const hand = ['3♦', 'A♠'];
    sortHand(hand);
    expect(hand).toEqual(['3♦', 'A♠']);
  });
});

describe('trickWinner', () => {
  it('picks the highest card of the led suit', () => {
    const trick = [
      { player: 'a', card: '5♥' },
      { player: 'b', card: 'K♥' },
      { player: 'c', card: '2♥' },
      { player: 'd', card: '9♥' },
    ];
    expect(trickWinner(trick)).toBe('b');
  });

  it('ignores off-suit cards — there is no trump', () => {
    const trick = [
      { player: 'a', card: '5♣' },
      { player: 'b', card: 'A♠' },
      { player: 'c', card: '7♣' },
      { player: 'd', card: 'K♥' },
    ];
    expect(trickWinner(trick)).toBe('c');
  });

  it('returns null for an empty trick', () => {
    expect(trickWinner([])).toBeNull();
  });
});

describe('pointCards', () => {
  it('keeps hearts, Q♠, J♦ and 10♣ only', () => {
    const collected = ['2♥', 'Q♠', 'J♦', '10♣', '3♠', '10♦', 'A♣'];
    expect(pointCards(collected)).toEqual(['2♥', 'Q♠', 'J♦', '10♣']);
  });
});
