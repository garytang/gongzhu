import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameState } from '../PlayerContext';
import GameOverModal, { GameOverData } from './GameOverModal';

const seats = [
  { handle: 'Ann', playerId: 'p0' },
  { handle: 'Bob', playerId: 'p1' },
  { handle: 'Cat', playerId: 'p2' },
  { handle: 'Dan', playerId: 'p3' },
];

const gameState: GameState = {
  trick: [],
  turn: 0,
  playerHandles: seats,
  scores: { p0: -40, p1: 100, p2: -10, p3: 0 },
  teams: { team1: ['p0', 'p2'], team2: ['p1', 'p3'] },
};

const teamInfo: NonNullable<GameOverData['teamInfo']> = {
  team1: { players: ['Ann', 'Cat'], roundScore: -50, cumulativeScore: -220 },
  team2: { players: ['Bob', 'Dan'], roundScore: 100, cumulativeScore: 340 },
};

function data(overrides: Partial<GameOverData> = {}): GameOverData {
  return {
    scores: gameState.scores,
    collected: { Ann: ['Q♠', '3♠', '2♥'], Bob: [] },
    teamInfo,
    ...overrides,
  };
}

type ModalProps = React.ComponentProps<typeof GameOverModal>;

function renderModal(overrides: Partial<GameOverData> = {}, props: Partial<ModalProps> = {}) {
  const handlers = { onClose: jest.fn(), onContinue: jest.fn(), onNewGame: jest.fn() };
  const result = render(
    <GameOverModal
      data={data(overrides)}
      gameState={gameState}
      myHandle="Ann"
      canControl
      {...handlers}
      {...props}
    />
  );
  return { ...handlers, ...result };
}

/** The modal body, so a query cannot stray into the overlay around it. */
function dialog(): HTMLElement {
  return screen.getByRole('dialog');
}

describe('GameOverModal', () => {
  it('calls a finished hand a round and a finished match a game', () => {
    const { unmount } = renderModal();
    expect(screen.getByRole('heading', { name: 'Round Over' })).toBeInTheDocument();
    unmount();

    renderModal({ gameEnded: true });
    expect(screen.getByRole('heading', { name: 'Game Over!' })).toBeInTheDocument();
  });

  it('shows both teams with their round and match totals', () => {
    renderModal();
    expect(within(dialog()).getByText('Team 1 (Ann & Cat)')).toBeInTheDocument();
    expect(within(dialog()).getByText('Round: -50')).toBeInTheDocument();
    expect(within(dialog()).getByText('-220')).toBeInTheDocument();
    expect(within(dialog()).getByText('Team 2 (Bob & Dan)')).toBeInTheDocument();
    expect(within(dialog()).getByText('340')).toBeInTheDocument();
  });

  it('marks the winning team with a trophy and leaves the loser plain', () => {
    renderModal({ gameEnded: true, winningTeam: 2 });
    const [first, second] = within(dialog()).getAllByTestId('result-row');
    expect(first).not.toHaveTextContent('🏆');
    expect(second).toHaveTextContent('Team 2 (Bob & Dan)');
    expect(second).toHaveTextContent('🏆');
  });

  it('lists every seat with its score when the room scores individuals', () => {
    renderModal({ teamInfo: null, gameEnded: true, winners: ['Bob'] });

    expect(screen.getByRole('heading', { name: 'Scores' })).toBeInTheDocument();
    expect(screen.queryByText(/^Team 1/)).not.toBeInTheDocument();
    const modal = within(dialog());
    expect(modal.getByText('Round: -40')).toBeInTheDocument();
    expect(modal.getByText('Round: 100 🏆')).toBeInTheDocument();
    seats.forEach(seat => expect(modal.getByText(seat.handle)).toBeInTheDocument());
  });

  it('scores a seat the server left out of the score map as zero', () => {
    renderModal({ teamInfo: null, scores: { p0: -40 } });
    expect(within(dialog()).getAllByText('Round: 0')).toHaveLength(3);
  });

  it('shows only the point cards each player collected', () => {
    renderModal();
    const ann = within(dialog()).getByText(/^Ann:/);
    expect(ann).toHaveTextContent('Ann: Q♠,2♥');
    expect(ann).not.toHaveTextContent('3♠');
    expect(within(dialog()).getByText('No point cards')).toBeInTheDocument();
  });

  it('gives the host the controls to deal again or reseat', async () => {
    const { onContinue, onNewGame, onClose } = renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Continue (Same Teams)' }));
    expect(onContinue).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'New Game (New Seats)' }));
    expect(onNewGame).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('offers only a new game once the match is over', () => {
    renderModal({ gameEnded: true });
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start New Game' })).toBeInTheDocument();
  });

  it('labels continuing as same seats when the room scores individuals', () => {
    renderModal({ teamInfo: null });
    expect(screen.getByRole('button', { name: 'Continue (Same Seats)' })).toBeInTheDocument();
  });

  it('tells a guest to wait for the host instead of showing the controls', () => {
    renderModal({}, { canControl: false, hostHandle: 'Bob' });
    expect(screen.getByText('Waiting for Bob…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New Game/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('falls back to "the host" when the room state names no host', () => {
    renderModal({}, { canControl: false });
    expect(screen.getByText('Waiting for the host…')).toBeInTheDocument();
  });

  it('omits the per-seat rows when no game state has arrived yet', () => {
    renderModal({ teamInfo: null }, { gameState: null });
    expect(screen.getByRole('heading', { name: 'Scores' })).toBeInTheDocument();
    expect(screen.queryByText(/^Round:/)).not.toBeInTheDocument();
  });
});
