import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Hand from './Hand';

function renderHand(cards: string[], props: Partial<React.ComponentProps<typeof Hand>> = {}) {
  const onPlay = jest.fn();
  render(<Hand cards={cards} playable playedCard={null} onPlay={onPlay} {...props} />);
  return { onPlay };
}

function cardLabels(): string[] {
  return within(screen.getByTestId('hand'))
    .getAllByRole('button')
    .map(button => button.textContent || '');
}

describe('Hand', () => {
  it('renders the cards sorted by suit then rank', () => {
    renderHand(['3♦', 'A♠', '10♣', '2♥', '2♠', 'K♥', 'J♦', '2♣', '10♠']);
    expect(cardLabels()).toEqual(['2♠', '10♠', 'A♠', '2♥', 'K♥', '2♣', '10♣', '3♦', 'J♦']);
  });

  it('plays the clicked card', async () => {
    const { onPlay } = renderHand(['2♠', '3♠']);
    await userEvent.click(screen.getByRole('button', { name: '3♠' }));
    expect(onPlay).toHaveBeenCalledWith('3♠');
  });

  it('disables the cards when it is not this player\'s turn', async () => {
    const { onPlay } = renderHand(['2♠'], { playable: false });
    expect(screen.getByRole('button', { name: '2♠' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '2♠' }));
    expect(onPlay).not.toHaveBeenCalled();
  });
});
