import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameState } from '../PlayerContext';
import { PlayerProvider } from '../PlayerContext';
import GameTable from './GameTable';
import { createMockSocket, MockSocket } from '../test-utils/mockSocket';

let mockSocketInstance: MockSocket;
jest.mock('socket.io-client', () => ({ io: () => mockSocketInstance }));

const seats = [
  { handle: 'Me', playerId: 'me' },
  { handle: 'Bob', playerId: 'p1' },
  { handle: 'Cat', playerId: 'p2' },
  { handle: 'Dan', playerId: 'p3', isBot: true },
];

function gameState(overrides: Partial<GameState> = {}): GameState {
  return {
    trick: [],
    turn: 0,
    playerHandles: seats,
    scores: { me: -40, p1: 100, p2: -10, p3: 0 },
    teams: { team1: ['me', 'p2'], team2: ['p1', 'p3'] },
    ...overrides,
  };
}

function renderTable(state: GameState, hand: string[] = []) {
  render(
    <PlayerProvider>
      <GameTable />
    </PlayerProvider>
  );
  act(() => mockSocketInstance.fire('connect'));
  act(() => {
    mockSocketInstance.fire('deal_hand', hand);
    mockSocketInstance.fire('game_state', state);
  });
}

beforeEach(() => {
  mockSocketInstance = createMockSocket();
});

describe('GameTable', () => {
  it('waits for the first game state', () => {
    render(
      <PlayerProvider>
        <GameTable />
      </PlayerProvider>
    );
    expect(screen.getByText(/Waiting for game state/)).toBeInTheDocument();
  });

  it('shows a cumulative team score of 0 rather than the round total', () => {
    renderTable(gameState({ cumulativeTeamScores: { team1: 0, team2: -120 } }));
    expect(screen.getByTestId('team-1-score')).toHaveTextContent(/:\s*0$/);
    expect(screen.getByTestId('team-2-score')).toHaveTextContent(/:\s*-120$/);
  });

  it('falls back to the round totals when no cumulative scores are sent', () => {
    renderTable(gameState());
    expect(screen.getByTestId('team-1-score')).toHaveTextContent(/:\s*-50$/);
    expect(screen.getByTestId('team-2-score')).toHaveTextContent(/:\s*100$/);
  });

  it('sorts the dealt hand', () => {
    renderTable(gameState(), ['3♦', 'A♠', '2♥', '2♣']);
    const labels = within(screen.getByTestId('hand'))
      .getAllByRole('button')
      .map(button => button.textContent);
    expect(labels).toEqual(['A♠', '2♥', '2♣', '3♦']);
  });

  it('names the player who leads and the player being waited on', () => {
    renderTable(gameState({ turn: 1, trick: [{ player: 'me', card: '2♣' }] }));
    expect(screen.getByText(/Waiting for Bob/)).toBeInTheDocument();
    expect(screen.getByText(/You lead this trick/)).toBeInTheDocument();
  });

  it('tells the player it is their turn to lead', () => {
    renderTable(gameState());
    expect(screen.getByText(/Your turn — you lead this trick/)).toBeInTheDocument();
  });

  it('names the suit to follow on the player\'s turn', () => {
    renderTable(gameState({ turn: 1, trick: [{ player: 'me', card: '2♣' }] }));
    act(() =>
      mockSocketInstance.fire('game_state', gameState({ turn: 0, trick: [{ player: 'p1', card: '5♥' }] }))
    );
    expect(screen.getByText(/follow ♥/)).toBeInTheDocument();
  });

  it('emits the clicked card when it is the player\'s turn', async () => {
    renderTable(gameState(), ['2♣', 'A♠']);
    await userEvent.click(screen.getByRole('button', { name: '2♣' }));
    expect(mockSocketInstance.emit).toHaveBeenCalledWith('play_card', '2♣');
  });

  it('announces the trick winner when the server clears a full trick', () => {
    const completed = [
      { player: 'me', card: '5♥' },
      { player: 'p1', card: 'K♥' },
      { player: 'p2', card: '2♥' },
      { player: 'p3', card: 'A♠' },
    ];
    renderTable(gameState({ trick: completed, turn: 1 }));
    expect(screen.queryByText(/won the trick/)).not.toBeInTheDocument();

    act(() => mockSocketInstance.fire('game_state', gameState({ trick: [], turn: 1 })));
    expect(screen.getByText('Bob won the trick')).toBeInTheDocument();
  });

  it('shows a player\'s collected point cards on demand', async () => {
    renderTable(gameState());
    act(() => mockSocketInstance.fire('collected', { p1: ['Q♠', '3♠', '2♥'] }));
    await userEvent.click(screen.getByRole('button', { name: /Bob/ }));

    const dialog = screen.getByText(/Bob's Collected Point Cards/).parentElement as HTMLElement;
    expect(within(dialog).getByText('Q♠')).toBeInTheDocument();
    expect(within(dialog).getByText('2♥')).toBeInTheDocument();
    expect(within(dialog).queryByText('3♠')).not.toBeInTheDocument();
  });
});
