type Handler = (...args: any[]) => void;

/**
 * Minimal stand-in for a socket.io client: records handlers registered with
 * `on`/`io.on` and lets a test deliver events to them.
 */
export interface MockSocket {
  id: string;
  on: (event: string, handler: Handler) => void;
  off: (event: string, handler: Handler) => void;
  emit: jest.Mock;
  disconnect: jest.Mock;
  io: { on: (event: string, handler: Handler) => void };
  /** Delivers a socket event, e.g. 'connect' or 'game_state'. */
  fire: (event: string, ...args: any[]) => void;
  /** Delivers a manager event, e.g. 'reconnect_attempt'. */
  fireManager: (event: string, ...args: any[]) => void;
}

export function createMockSocket(id = 'me'): MockSocket {
  const handlers: Record<string, Handler[]> = {};
  const managerHandlers: Record<string, Handler[]> = {};

  const add = (target: Record<string, Handler[]>) => (event: string, handler: Handler) => {
    target[event] = (target[event] || []).concat(handler);
  };
  const call = (target: Record<string, Handler[]>) => (event: string, ...args: any[]) => {
    (target[event] || []).forEach(handler => handler(...args));
  };

  return {
    id,
    on: add(handlers),
    off: (event, handler) => {
      handlers[event] = (handlers[event] || []).filter(h => h !== handler);
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
    io: { on: add(managerHandlers) },
    fire: call(handlers),
    fireManager: call(managerHandlers),
  };
}
