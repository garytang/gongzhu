import React, { ReactNode } from 'react';
import { act, render, RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PlayerProvider } from '../PlayerContext';
import { PLAYER_ID_KEY } from '../lib/identity';
import type { MockSocket } from './mockSocket';

/**
 * Renders a screen inside the providers it needs — the player context over a mocked
 * socket, and a router — and connects the socket, which is the state every screen is
 * written for.
 *
 * `routes` maps a route pattern to what to render there: give the screen under test its
 * own entry, plus a stub for anywhere it can navigate to, so navigation is assertable.
 *
 * A test file must still mock the socket module itself, because `jest.mock` is hoisted
 * per file:
 *
 *   let mockSocketInstance: MockSocket;
 *   jest.mock('socket.io-client', () => ({ io: () => mockSocketInstance }));
 */
export function renderWithProviders(
  routes: Record<string, ReactNode>,
  { socket, route }: { socket: MockSocket; route: string }
): RenderResult {
  // The player id is minted once and stored, so seeding it with the mock socket's id
  // gives every test a stable identity to assert against.
  window.localStorage.setItem(PLAYER_ID_KEY, socket.id);
  const result = render(
    <PlayerProvider>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          {Object.entries(routes).map(([pattern, element]) => (
            <Route key={pattern} path={pattern} element={element} />
          ))}
        </Routes>
      </MemoryRouter>
    </PlayerProvider>
  );
  act(() => socket.fire('connect'));
  return result;
}
