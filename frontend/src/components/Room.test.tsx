import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PlayerProvider } from '../PlayerContext';
import type { RoomState } from '../PlayerContext';
import Room from './Room';
import { createMockSocket, MockSocket } from '../test-utils/mockSocket';

let mockSocketInstance: MockSocket;
jest.mock('socket.io-client', () => ({ io: () => mockSocketInstance }));

const me = { handle: 'Bob', playerId: 'me' };
const ann = { handle: 'Ann', playerId: 'ann' };

function roomState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: 'KJ7P2M',
    name: 'Friday night',
    host: me,
    options: {
      variant: 'standard', teams: true, targetScore: 1000, visibility: 'public', onDisconnect: 'bot',
    },
    seats: [me, ann],
    spectators: [],
    capacity: 4,
    phase: 'waiting',
    absent: [],
    ...overrides,
  };
}

function renderRoom() {
  render(
    <PlayerProvider>
      <MemoryRouter initialEntries={['/room/KJ7P2M']}>
        <Routes>
          <Route path="/room/:code" element={<Room />} />
          <Route path="/lobby" element={<div>Lobby page</div>} />
        </Routes>
      </MemoryRouter>
    </PlayerProvider>
  );
  act(() => mockSocketInstance.fire('connect'));
}

/**
 * Answers the handle prompt an invite link shows to a first-time visitor. The room is
 * only joined once the server acknowledges the handle.
 */
async function enterHandle(handle = 'Bob') {
  await userEvent.type(screen.getByLabelText('Nickname'), handle);
  await userEvent.click(screen.getByRole('button', { name: 'Join room' }));
  act(() => mockSocketInstance.fire('handle_registered', { handle, playerId: 'me' }));
}

beforeEach(() => {
  mockSocketInstance = createMockSocket();
});

describe('Room', () => {
  it('asks an invited visitor for a handle, then joins the room in the URL', async () => {
    renderRoom();
    expect(screen.getByText('Join room KJ7P2M')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Nickname'), 'Bob');
    await userEvent.click(screen.getByRole('button', { name: 'Join room' }));
    // The room is not asked for until the server has acknowledged the handle.
    expect(mockSocketInstance.emit).not.toHaveBeenCalledWith('join_room', { code: 'KJ7P2M' });

    act(() => mockSocketInstance.fire('handle_registered', { handle: 'Bob', playerId: 'me' }));
    expect(mockSocketInstance.emit).toHaveBeenCalledWith('join_room', { code: 'KJ7P2M' });
    expect(screen.getByText(/Joining room KJ7P2M/)).toBeInTheDocument();
  });

  it('shows the code, the seated players and who hosts', async () => {
    renderRoom();
    await enterHandle();
    act(() => mockSocketInstance.fire('room_state', roomState()));

    expect(screen.getByText('KJ7P2M')).toBeInTheDocument();
    expect(screen.getByText('Players (2/4)')).toBeInTheDocument();
    expect(screen.getByText('👑 Host')).toBeInTheDocument();
    expect(screen.getByText(/2 bots will fill the rest/)).toBeInTheDocument();
  });

  it('gives Start and the option fields to the host only', async () => {
    renderRoom();
    await enterHandle();
    act(() => mockSocketInstance.fire('room_state', roomState()));

    await userEvent.click(screen.getByRole('button', { name: 'Start Game' }));
    expect(mockSocketInstance.emit).toHaveBeenCalledWith('start_game');

    await userEvent.selectOptions(screen.getByLabelText('Hearts'), 'pips');
    await userEvent.click(screen.getByRole('button', { name: 'Apply options' }));
    expect(mockSocketInstance.emit).toHaveBeenCalledWith('update_room_options', {
      variant: 'pips', teams: true, targetScore: 1000, visibility: 'public', onDisconnect: 'bot',
    });
  });

  it('tells a guest to wait for the host and hides the controls', async () => {
    renderRoom();
    await enterHandle();
    act(() => mockSocketInstance.fire('room_state', roomState({ host: ann })));

    expect(screen.getByText(/Waiting for Ann to start/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Game' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hearts')).not.toBeInTheDocument();
    expect(screen.getByText('Scoring: teams')).toBeInTheDocument();
  });

  it('names the spectators and tells one that they are waiting for a seat', async () => {
    renderRoom();
    await enterHandle();
    act(() =>
      mockSocketInstance.fire('room_state', roomState({ host: ann, seats: [ann], spectators: [me] }))
    );

    expect(screen.getByText('Spectators (1)')).toBeInTheDocument();
    expect(screen.getByText(/You are spectating/)).toBeInTheDocument();
  });

  it('copies the invite link for the room', async () => {
    const writeText = jest.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    renderRoom();
    await enterHandle();
    act(() => mockSocketInstance.fire('room_state', roomState()));

    await userEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/room/KJ7P2M`);
    expect(screen.getByRole('button', { name: 'Invite link copied' })).toBeInTheDocument();
  });

  it('offers the lobby when the room cannot be joined', async () => {
    renderRoom();
    await enterHandle();
    act(() => mockSocketInstance.fire('room_error', { reason: 'No room with code KJ7P2M' }));

    expect(screen.getByRole('alert')).toHaveTextContent('No room with code KJ7P2M');
    await userEvent.click(screen.getByRole('button', { name: 'Back to the lobby' }));
    expect(screen.getByText('Lobby page')).toBeInTheDocument();
  });

  it('returns to the lobby when the room is left', async () => {
    renderRoom();
    await enterHandle();
    act(() => mockSocketInstance.fire('room_state', roomState()));

    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(mockSocketInstance.emit).toHaveBeenCalledWith('leave_room');
    act(() => mockSocketInstance.fire('room_left'));
    expect(screen.getByText('Lobby page')).toBeInTheDocument();
  });

  it('shows the table instead of the room screen once the hand is dealt', async () => {
    renderRoom();
    await enterHandle();
    act(() => mockSocketInstance.fire('room_state', roomState({ phase: 'playing' })));
    expect(screen.getByText(/Waiting for game state/)).toBeInTheDocument();
  });
});
