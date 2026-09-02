import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { PlayerProvider } from '../PlayerContext';
import type { RoomState } from '../PlayerContext';
import ReconnectOverlay from './ReconnectOverlay';
import { createMockSocket, MockSocket } from '../test-utils/mockSocket';

let mockSocketInstance: MockSocket;
jest.mock('socket.io-client', () => ({ io: () => mockSocketInstance }));

function roomState(absent: RoomState['absent']): RoomState {
  return {
    code: 'KJ7P2M',
    name: 'Friday night',
    host: { handle: 'Bob', playerId: 'me' },
    options: {
      variant: 'standard', teams: true, targetScore: 1000, visibility: 'public', onDisconnect: 'bot',
    },
    seats: [{ handle: 'Bob', playerId: 'me' }, { handle: 'Alice', playerId: 'alice' }],
    spectators: [],
    capacity: 4,
    phase: 'playing',
    absent,
  };
}

function renderOverlay(absent: RoomState['absent']) {
  render(
    <PlayerProvider>
      <ReconnectOverlay />
    </PlayerProvider>
  );
  act(() => mockSocketInstance.fire('connect'));
  act(() => mockSocketInstance.fire('room_state', roomState(absent)));
}

beforeEach(() => {
  mockSocketInstance = createMockSocket();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ReconnectOverlay', () => {
  it('shows nothing while everyone is connected', () => {
    renderOverlay([]);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('counts down the time the missing player has left', () => {
    renderOverlay([{ handle: 'Alice', playerId: 'alice', deadline: Date.now() + 42_000 }]);
    expect(screen.getByRole('status')).toHaveTextContent('Alice disconnected — 42s to reconnect');

    act(() => { jest.advanceTimersByTime(5_000); });
    expect(screen.getByRole('status')).toHaveTextContent('Alice disconnected — 37s to reconnect');
  });

  it('never counts past zero', () => {
    renderOverlay([{ handle: 'Alice', playerId: 'alice', deadline: Date.now() - 1_000 }]);
    expect(screen.getByRole('status')).toHaveTextContent('0s to reconnect');
  });

  it('names everyone the table is waiting for', () => {
    renderOverlay([
      { handle: 'Alice', playerId: 'alice', deadline: Date.now() + 10_000 },
      { handle: 'Dan', playerId: 'dan', deadline: Date.now() + 20_000 },
    ]);
    const overlay = screen.getByRole('status');
    expect(overlay).toHaveTextContent('Alice disconnected');
    expect(overlay).toHaveTextContent('Dan disconnected');
  });
});
