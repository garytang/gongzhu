import { pointCards, sortHand } from './cards';

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

describe('pointCards', () => {
  it('keeps hearts, Q♠, J♦ and 10♣ only', () => {
    const collected = ['2♥', 'Q♠', 'J♦', '10♣', '3♠', '10♦', 'A♣'];
    expect(pointCards(collected)).toEqual(['2♥', 'Q♠', 'J♦', '10♣']);
  });
});
