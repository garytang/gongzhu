import React from 'react';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RoomListing, RoomState } from '../PlayerContext';
import Lobby from './Lobby';
import { createMockSocket, MockSocket } from '../test-utils/mockSocket';
import { renderWithProviders } from '../test-utils/renderWithProviders';

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
  options: {
    variant: 'standard', teams: true, targetScore: 1000, visibility: 'public', onDisconnect: 'bot',
  },
  seats: [{ handle: 'Ann', playerId: 'ann' }],
  spectators: [],
  capacity: 4,
  phase: 'waiting',
  absent: [],
};

function renderLobby() {
  renderWithProviders(
    { '/lobby': <Lobby />, '/room/:code': <div>Room page</div> },
    { socket: mockSocketInstance, route: '/lobby' }
  );
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
    expect(mockSocketInstance.lastEmit('register_handle')).toEqual({
      handle: 'Bob',
      playerId: 'me',
    });
    expect(screen.getByRole('button', { name: 'Create room' })).toBeInTheDocument();
    expect(mockSocketInstance.hasEmitted('list_rooms')).toBe(true);
  });

  it('creates a room with the name and options the player chose', async () => {
    renderLobby();
    await registerHandle();

    await userEvent.type(screen.getByLabelText('Room name'), 'Friday night');
    await userEvent.click(screen.getByLabelText('Play in teams'));
    await userEvent.selectOptions(screen.getByLabelText('Visibility'), 'private');
    await userEvent.selectOptions(screen.getByLabelText('Hearts'), 'pips');
    await userEvent.click(screen.getByRole('button', { name: 'Create room' }));

    expect(mockSocketInstance.lastEmit('create_room')).toEqual({
      name: 'Friday night',
      options: {
        variant: 'pips', teams: false, targetScore: 1000, visibility: 'private', onDisconnect: 'bot',
      },
    });
  });

  it('creates a room with the defaults when nothing is filled in', async () => {
    renderLobby();
    await registerHandle();
    await userEvent.click(screen.getByRole('button', { name: 'Create room' }));

    expect(mockSocketInstance.lastEmit('create_room')).toEqual({
      name: '',
      options: {
        variant: 'standard', teams: true, targetScore: 1000, visibility: 'public', onDisconnect: 'bot',
      },
    });
  });

  it('trims the room name and sends the target score as a number', async () => {
    renderLobby();
    await registerHandle();

    await userEvent.type(screen.getByLabelText('Room name'), '  Friday night  ');
    await userEvent.clear(screen.getByLabelText('Target score'));
    await userEvent.type(screen.getByLabelText('Target score'), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Create room' }));

    expect(mockSocketInstance.lastEmit('create_room')).toEqual({
      name: 'Friday night',
      options: {
        variant: 'standard', teams: true, targetScore: 500, visibility: 'public', onDisconnect: 'bot',
      },
    });
  });

  it('joins by a typed code, upper-cased and trimmed', async () => {
    renderLobby();
    await registerHandle();

    await userEvent.type(screen.getByLabelText('Room code'), ' kj7p2m ');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(mockSocketInstance.lastEmit('join_room')).toEqual({ code: 'KJ7P2M' });
  });

  it('cannot join until a code is typed', async () => {
    renderLobby();
    await registerHandle();

    expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Room code'), 'K');
    expect(screen.getByRole('button', { name: 'Join' })).toBeEnabled();
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
    expect(mockSocketInstance.lastEmit('join_room')).toEqual({ code: 'KJ7P2M' });
  });

  it('says how far along each listed room is', async () => {
    renderLobby();
    await registerHandle();
    act(() =>
      mockSocketInstance.fire('room_list', [
        { ...listing, code: 'AAAAAA', phase: 'playing' },
        { ...listing, code: 'BBBBBB', phase: 'handOver' },
        { ...listing, code: 'CCCCCC', phase: 'matchOver' },
      ])
    );

    expect(screen.getByText(/AAAAAA · Ann · 2\/4 · In progress/)).toBeInTheDocument();
    expect(screen.getByText(/BBBBBB · Ann · 2\/4 · Between hands/)).toBeInTheDocument();
    expect(screen.getByText(/CCCCCC · Ann · 2\/4 · Finished/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Public rooms (3)' })).toBeInTheDocument();
  });

  it('offers to create the first room when the lobby is empty', async () => {
    renderLobby();
    await registerHandle();
    expect(screen.getByText('No public rooms yet — create one')).toBeInTheDocument();
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

  it('reports a refusal the server gave no reason for', async () => {
    renderLobby();
    await registerHandle();
    act(() => mockSocketInstance.fire('room_error', {}));
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('clears the last refusal when the player tries again', async () => {
    renderLobby();
    await registerHandle();
    act(() => mockSocketInstance.fire('room_error', { reason: 'Room is full' }));

    await userEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => mockSocketInstance.fire('room_error', { reason: 'Room is full' }));
    await userEvent.type(screen.getByLabelText('Room code'), 'KJ7P2M');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
