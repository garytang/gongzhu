import React from 'react';
import { act, render, screen } from '@testing-library/react';
import App from './App';
import { createMockSocket, MockSocket } from './test-utils/mockSocket';

let mockSocketInstance: MockSocket;
jest.mock('socket.io-client', () => ({ io: () => mockSocketInstance }));

/** `App` supplies its own BrowserRouter, so the route is chosen through history. */
function renderAt(path: string) {
  window.history.pushState({}, '', path);
  render(<App />);
  act(() => mockSocketInstance.fire('connect'));
}

beforeEach(() => {
  mockSocketInstance = createMockSocket();
});

describe('App routing', () => {
  it('sends the root path to the lobby', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Pick a handle' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/lobby');
  });

  it('serves the lobby', () => {
    renderAt('/lobby');
    expect(screen.getByRole('heading', { name: 'Pick a handle' })).toBeInTheDocument();
  });

  it('serves the login screen', () => {
    renderAt('/login');
    expect(screen.getByRole('heading', { name: 'Enter your handle' })).toBeInTheDocument();
  });

  it('serves a room from the code in an invite link', () => {
    renderAt('/room/KJ7P2M');
    expect(screen.getByRole('heading', { name: 'Join room KJ7P2M' })).toBeInTheDocument();
  });

  it('sends an unknown path to the lobby', () => {
    renderAt('/no/such/page');
    expect(screen.getByRole('heading', { name: 'Pick a handle' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/lobby');
  });

  it('shows the connection banner above whatever route is open', () => {
    window.history.pushState({}, '', '/lobby');
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to the server');

    act(() => mockSocketInstance.fire('connect'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
