import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PlayerProvider } from '../PlayerContext';
import Login from './Login';
import { createMockSocket, MockSocket } from '../test-utils/mockSocket';

let mockSocketInstance: MockSocket;
jest.mock('socket.io-client', () => ({ io: () => mockSocketInstance }));

beforeEach(() => {
  mockSocketInstance = createMockSocket();
  render(
    <PlayerProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/lobby" element={<div>Lobby page</div>} />
        </Routes>
      </MemoryRouter>
    </PlayerProvider>
  );
  act(() => mockSocketInstance.fire('connect'));
});

describe('Login', () => {
  it('registers the handle and moves on to the lobby', async () => {
    await userEvent.type(screen.getByLabelText('Nickname'), 'Ann');
    await userEvent.click(screen.getByRole('button', { name: 'Enter Lobby' }));

    expect(mockSocketInstance.emit).toHaveBeenCalledWith('register_handle', {
      handle: 'Ann',
      playerId: 'me',
    });
    expect(screen.getByText('Lobby page')).toBeInTheDocument();
  });

  it('ignores an empty handle', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Enter Lobby' }));
    expect(screen.queryByText('Lobby page')).not.toBeInTheDocument();
  });
});
