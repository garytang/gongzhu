import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollectedCardsModal from './CollectedCardsModal';

function renderModal(cards: string[]) {
  const onClose = jest.fn();
  render(<CollectedCardsModal handle="Bob" cards={cards} onClose={onClose} />);
  return { onClose };
}

describe('CollectedCardsModal', () => {
  it('names the player and shows the cards it was given', () => {
    renderModal(['Q♠', '2♥', '10♣']);
    expect(screen.getByText("Bob's Collected Point Cards")).toBeInTheDocument();
    const modal = within(screen.getByRole('dialog'));
    ['Q♠', '2♥', '10♣'].forEach(card => expect(modal.getByText(card)).toBeInTheDocument());
  });

  it('says None when the player has collected nothing', () => {
    renderModal([]);
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('closes from the button and from the backdrop, but not from the card itself', async () => {
    const { onClose } = renderModal(['Q♠']);

    await userEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
