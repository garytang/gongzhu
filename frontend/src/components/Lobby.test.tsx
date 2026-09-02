import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PlayerProvider } from '../PlayerContext';
import type { RoomListing, RoomState } from '../PlayerContext';
import Lobby from './Lobby';
import { createMockSocket, MockSocket } from '../test-utils/mockSocket';

let mockSocketInstance: MockSocket;
jest.mock('socket.io-client', () => ({ io: () => mockSocketInstance }));

const listing: RoomListing = {
  code: 'KJ7P2M',
  name: "Ann's table",
  host: 'Ann',
  seats: 2,
  capacity: 4,
  phase: 'waiting',
};

const roomState: RoomState = {
  code: 'KJ7P2M',
  name: "Ann's table",
  host: { handle: 'Ann', playerId: 'ann' },
  options: { variant: 'standard', teams: true, targetScore: 1000, visibility: 'public' },
  seats: [{ handle: 'Ann', playerId: 'ann' }],
  spectators: [],
  capacity: 4,
  phase: 'waiting',
};

function renderLobby() {
  render(
    <PlayerProvider>
      <MemoryRouter initialEntries={['/lobby']}>
        <Routes>
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/room/:code" element={<div>Room page</div>} />
        </Routes>
      </MemoryRouter>
    </PlayerProvider>
  );
  act(() => mockSocketInstance.fire('connect'));
}

/** Sets a handle and lets the server acknowledge it, which unlocks the room controls. */
async function registerHandle(handle = 'Bob') {
  await userEvent.type(screen.getByLabelText('Nickname'), handle);
  await userEvent.click(screen.getByRole('button', { name: 'Enter Lobby' }));
  act(() => mockSocketInstance.fire('handle_registered', { handle, playerId: 'me' }));
}

beforeEach(() => {
  mockSocketInstance = createMockSocket();
});

describe('Lobby', () => {
  it('asks for a handle before showing any room controls', async () => {
    renderLobby();
    expect(screen.queryByRole('button', { name: 'Create room' })).not.toBeInTheDocument();

    await registerHandle();
    expect(mockSocketInstance.emit).toHaveBeenCalledWith('register_handle', {
      handle: 'Bob',
      playerId: 'me',
    });
    expect(screen.getByRole('button', { name: 'Create room' })).toBeInTheDocument();
    expect(mockSocketInstance.emit).toHaveBeenCalledWith('list_rooms');
  });

  it('creates a room with the name and options the player chose', async () => {
    renderLobby();
    await registerHandle();

    await userEvent.type(screen.getByLabelText('Room name'), 'Friday night');
    await userEvent.click(screen.getByLabelText('Play in teams'));
    await userEvent.selectOptions(screen.getByLabelText('Visibility'), 'private');
    await userEvent.selectOptions(screen.getByLabelText('Hearts'), 'pips');
    await userEvent.click(screen.getByRole('button', { name: 'Create room' }));

    expect(mockSocketInstance.emit).toHaveBeenCalledWith('create_room', {
      name: 'Friday night',
      options: { variant: 'pips', teams: false, targetScore: 1000, visibility: 'private' },
    });
  });

  it('joins by a typed code', async () => {
    renderLobby();
    await registerHandle();

    await userEvent.type(screen.getByLabelText('Room code'), 'kj7p2m');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(mockSocketInstance.emit).toHaveBeenCalledWith('join_room', { code: 'KJ7P2M' });
  });

  it('lists the public rooms and joins the one that is clicked', async () => {
    renderLobby();
    await registerHandle();
    act(() => mockSocketInstance.fire('room_list', [listing]));

    expect(screen.getByText("Ann's table")).toBeInTheDocument();
    expect(screen.getByText(/KJ7P2M · Ann · 2\/4 · Waiting/)).toBeInTheDocument();

    act(() => mockSocketInstance.fire('room_list', [{ ...listing, host: null, seats: 0 }]));
    expect(screen.getByText(/KJ7P2M · no host · 0\/4/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: "Join Ann's table" }));
    expect(mockSocketInstance.emit).toHaveBeenCalledWith('join_room', { code: 'KJ7P2M' });
  });

  it('moves to the room page once the server confirms the room', async () => {
    renderLobby();
    await registerHandle();
    act(() => mockSocketInstance.fire('room_state', roomState));
    expect(screen.getByText('Room page')).toBeInTheDocument();
  });

  it('reports why a join was refused', async () => {
    renderLobby();
    await registerHandle();
    act(() => mockSocketInstance.fire('room_error', { reason: 'No room with code ZZZZZZ' }));
    expect(screen.getByRole('alert')).toHaveTextContent('No room with code ZZZZZZ');
  });
});
