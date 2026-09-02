import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerContext';
import { loadPlayerId } from './lib/identity';
import { createMockSocket, MockSocket } from './test-utils/mockSocket';

let mockSocketInstance: MockSocket;
jest.mock('socket.io-client', () => ({ io: () => mockSocketInstance }));

/** Puts the context values a test cares about into the DOM, and lets it set a handle. */
function Probe() {
  const { playerId, handle, isRegistered, setHandle } = usePlayer();
  return (
    <div>
      <span data-testid="playerId">{playerId}</span>
      <span data-testid="handle">{handle}</span>
      <span data-testid="registered">{String(isRegistered)}</span>
      <button type="button" onClick={() => setHandle('Ann')}>Set handle</button>
    </div>
  );
}

/** Whether the table survived a room event, without rendering a whole GameTable. */
function HandSize() {
  const { hand } = usePlayer();
  return <span data-testid="handSize">{hand.length}</span>;
}

const renderProvider = () => render(<PlayerProvider><Probe /></PlayerProvider>);

const roomState = {
  code: 'KJ7P2M',
  name: "Ann's table",
  host: null,
  options: {
    variant: 'standard', teams: true, targetScore: 1000, visibility: 'public', onDisconnect: 'bot',
  },
  seats: [],
  spectators: [],
  capacity: 4,
  phase: 'waiting',
  absent: [],
};

const emitsOf = (event: string) =>
  mockSocketInstance.emit.mock.calls.filter(([name]) => name === event);

const setHandle = () => act(() => screen.getByRole('button', { name: 'Set handle' }).click());

/** The acknowledgement the server sends back, echoing the id it holds the player under. */
const acknowledge = () =>
  act(() => mockSocketInstance.fire('handle_registered', { handle: 'Ann', playerId: loadPlayerId() }));

beforeEach(() => {
  mockSocketInstance = createMockSocket();
});

describe('PlayerContext identity', () => {
  it('keeps the same player id across a remount', () => {
    const first = renderProvider();
    const id = screen.getByTestId('playerId').textContent;
    expect(id).toBe(loadPlayerId());
    first.unmount();

    mockSocketInstance = createMockSocket();
    renderProvider();
    expect(screen.getByTestId('playerId')).toHaveTextContent(id as string);
  });

  it('remembers the handle, so a refresh does not ask for a name again', () => {
    const first = renderProvider();
    act(() => mockSocketInstance.fire('connect'));
    setHandle();
    first.unmount();

    mockSocketInstance = createMockSocket();
    renderProvider();
    expect(screen.getByTestId('handle')).toHaveTextContent('Ann');
  });

  it('registers once per connection, with the stored id', () => {
    renderProvider();
    act(() => mockSocketInstance.fire('connect'));
    setHandle();
    expect(emitsOf('register_handle'))
      .toEqual([['register_handle', { handle: 'Ann', playerId: loadPlayerId() }]]);

    // The server's acknowledgement must not provoke a second registration.
    acknowledge();
    expect(emitsOf('register_handle')).toHaveLength(1);
    expect(screen.getByTestId('registered')).toHaveTextContent('true');
  });

  it('registers again after a dropped connection, and leaves the rejoin to the server', () => {
    renderProvider();
    act(() => mockSocketInstance.fire('connect'));
    setHandle();
    acknowledge();
    act(() => mockSocketInstance.fire('room_state', roomState));

    act(() => mockSocketInstance.fire('disconnect'));
    expect(screen.getByTestId('registered')).toHaveTextContent('false');

    act(() => mockSocketInstance.fire('connect'));
    expect(emitsOf('register_handle')).toHaveLength(2);
    // The server puts the reconnecting socket back into the room its player still holds.
    expect(emitsOf('join_room')).toEqual([]);
  });

  it('keeps the table on screen when the server rejoins it to the same room', () => {
    render(<PlayerProvider><Probe /><HandSize /></PlayerProvider>);
    act(() => mockSocketInstance.fire('connect'));
    setHandle();
    acknowledge();
    act(() => mockSocketInstance.fire('room_joined', { code: 'KJ7P2M' }));
    act(() => mockSocketInstance.fire('room_state', roomState));
    act(() => mockSocketInstance.fire('deal_hand', ['2♣', '3♣']));

    // A reconnect rejoins the room the client is already in; blanking the table here
    // would flash "waiting for game state" over a hand in progress.
    act(() => mockSocketInstance.fire('room_joined', { code: 'KJ7P2M' }));
    expect(screen.getByTestId('handSize')).toHaveTextContent('2');

    // Joining a different room does clear what the last one left behind.
    act(() => mockSocketInstance.fire('room_joined', { code: 'ZZZZZZ' }));
    expect(screen.getByTestId('handSize')).toHaveTextContent('0');
  });
});
