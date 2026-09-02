import React from 'react';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameState, RoomState } from '../PlayerContext';
import GameTable from './GameTable';
import { createMockSocket, MockSocket } from '../test-utils/mockSocket';
import { renderWithProviders } from '../test-utils/renderWithProviders';

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

function roomState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: 'KJ7P2M',
    name: 'Friday night',
    host: seats[0],
    options: { variant: 'standard', teams: true, targetScore: 1000, visibility: 'public' },
    seats,
    spectators: [],
    capacity: 4,
    phase: 'playing',
    ...overrides,
  };
}

function gameOver() {
  return {
    scores: { me: -40, p1: 100, p2: -10, p3: 0 },
    collected: { Me: ['Q♠'] },
    teamInfo: {
      team1: { players: ['Me', 'Cat'], roundScore: -50, cumulativeScore: -50 },
      team2: { players: ['Bob', 'Dan'], roundScore: 100, cumulativeScore: 100 },
    },
  };
}

function renderTable(state?: GameState, hand: string[] = []) {
  renderWithProviders({ '/': <GameTable /> }, { socket: mockSocketInstance, route: '/' });
  if (!state) return;
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
    renderTable();
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

  it('marks the seats the room filled with bots', () => {
    renderTable(gameState());
    expect(within(screen.getByRole('button', { name: /Dan/ })).queryByText('🤖')).not.toBeInTheDocument();

    // Which seats are bots comes from the room's player list, not the game state.
    act(() =>
      mockSocketInstance.fire('player_list', [...seats.slice(0, 3), { ...seats[3], isBot: true }])
    );
    expect(within(screen.getByRole('button', { name: /Dan/ })).getByText('🤖')).toBeInTheDocument();
  });

  it('shows your own collected point cards under the hand', () => {
    renderTable(gameState());
    expect(screen.getByText('None')).toBeInTheDocument();

    act(() => mockSocketInstance.fire('collected', { me: ['Q♠', '3♠'] }));
    expect(screen.queryByText('None')).not.toBeInTheDocument();
    expect(screen.getByText('Q♠')).toBeInTheDocument();
    expect(screen.queryByText('3♠')).not.toBeInTheDocument();
  });

  it('complains when the server refuses the card', async () => {
    renderTable(gameState(), ['2♣']);
    act(() => mockSocketInstance.fire('invalid_play'));
    expect(screen.getByText('Invalid card! Please follow suit.')).toBeInTheDocument();
  });

  it('shows the results when a hand ends and lets the host deal the next one', async () => {
    renderTable(gameState());
    act(() => mockSocketInstance.fire('room_state', roomState()));
    act(() => mockSocketInstance.fire('game_over', gameOver()));

    expect(screen.getByRole('dialog')).toHaveTextContent('Round Over');
    await userEvent.click(screen.getByRole('button', { name: 'Continue (Same Teams)' }));
    expect(mockSocketInstance.hasEmitted('continue_game')).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('hides the results again when the next hand is dealt', () => {
    renderTable(gameState());
    act(() => mockSocketInstance.fire('game_over', gameOver()));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    act(() => mockSocketInstance.fire('game_started'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('tells a guest that the host decides what happens next', () => {
    renderTable(gameState());
    act(() => mockSocketInstance.fire('room_state', roomState({ host: seats[1] })));
    act(() => mockSocketInstance.fire('game_over', gameOver()));

    expect(screen.getByRole('dialog')).toHaveTextContent('Waiting for Bob');
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument();
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
