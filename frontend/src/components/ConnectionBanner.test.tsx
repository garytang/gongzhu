import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { PlayerProvider } from '../PlayerContext';
import ConnectionBanner from './ConnectionBanner';
import { createMockSocket, MockSocket } from '../test-utils/mockSocket';

let mockSocketInstance: MockSocket;
jest.mock('socket.io-client', () => ({ io: () => mockSocketInstance }));

beforeEach(() => {
  mockSocketInstance = createMockSocket();
  render(
    <PlayerProvider>
      <ConnectionBanner />
    </PlayerProvider>
  );
});

describe('ConnectionBanner', () => {
  it('shows a connecting banner before the socket connects', () => {
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to the server');
  });

  it('hides once connected', () => {
    act(() => mockSocketInstance.fire('connect'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('warns when the connection drops', () => {
    act(() => mockSocketInstance.fire('connect'));
    act(() => mockSocketInstance.fire('disconnect', 'transport close'));
    expect(screen.getByRole('status')).toHaveTextContent('Disconnected');
  });

  it('shows the connecting banner again while reconnecting', () => {
    act(() => mockSocketInstance.fire('connect'));
    act(() => mockSocketInstance.fire('disconnect', 'transport close'));
    act(() => mockSocketInstance.fireManager('reconnect_attempt', 1));
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to the server');
  });

  it('warns when the socket cannot be reached at all', () => {
    act(() => mockSocketInstance.fire('connect_error', new Error('boom')));
    expect(screen.getByRole('status')).toHaveTextContent('Disconnected');
  });
});
