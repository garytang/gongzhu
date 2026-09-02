import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from './Login';
import { createMockSocket, MockSocket } from '../test-utils/mockSocket';
import { renderWithProviders } from '../test-utils/renderWithProviders';

let mockSocketInstance: MockSocket;
jest.mock('socket.io-client', () => ({ io: () => mockSocketInstance }));

function renderLogin(props: Partial<React.ComponentProps<typeof Login>> = {}) {
  renderWithProviders(
    {
      '/login': <Login {...props} />,
      '/lobby': <div>Lobby page</div>,
      '/room/:code': <div>Room page</div>,
    },
    { socket: mockSocketInstance, route: '/login' }
  );
}

async function submit(handle: string, buttonName = 'Enter Lobby') {
  if (handle) await userEvent.type(screen.getByLabelText('Nickname'), handle);
  await userEvent.click(screen.getByRole('button', { name: buttonName }));
}

beforeEach(() => {
  mockSocketInstance = createMockSocket();
});

describe('Login', () => {
  it('registers the handle and moves on to the lobby', async () => {
    renderLogin();
    await submit('Ann');

    expect(mockSocketInstance.emitsOf('register_handle')).toEqual([
      { handle: 'Ann', playerId: 'me' },
    ]);
    expect(screen.getByText('Lobby page')).toBeInTheDocument();
  });

  it('ignores an empty handle', async () => {
    renderLogin();
    await submit('');

    expect(mockSocketInstance.hasEmitted('register_handle')).toBe(false);
    expect(screen.queryByText('Lobby page')).not.toBeInTheDocument();
  });

  it('ignores a handle that is only whitespace', async () => {
    renderLogin();
    await submit('   ');

    expect(mockSocketInstance.hasEmitted('register_handle')).toBe(false);
    expect(screen.queryByText('Lobby page')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Enter your handle' })).toBeInTheDocument();
  });

  it('trims the handle it registers', async () => {
    renderLogin();
    await submit('  Ann  ');
    expect(mockSocketInstance.lastEmit('register_handle')).toEqual({
      handle: 'Ann',
      playerId: 'me',
    });
  });

  it('takes an invited guest into the room after asking for a handle', async () => {
    renderLogin({
      redirectTo: '/room/KJ7P2M',
      heading: 'Join room KJ7P2M',
      submitLabel: 'Join room',
    });
    expect(screen.getByRole('heading', { name: 'Join room KJ7P2M' })).toBeInTheDocument();

    await submit('Ann', 'Join room');
    expect(mockSocketInstance.lastEmit('register_handle')).toEqual({
      handle: 'Ann',
      playerId: 'me',
    });
    expect(screen.getByText('Room page')).toBeInTheDocument();
  });
});
