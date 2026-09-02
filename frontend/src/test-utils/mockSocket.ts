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
  /** Payloads the client sent for one event, oldest first. */
  emitsOf: (event: string) => any[];
  /** Payload of the client's most recent emit of an event, or undefined. */
  lastEmit: (event: string) => any;
  /** Whether the client sent an event at all. */
  hasEmitted: (event: string) => boolean;
}

export function createMockSocket(id = 'me'): MockSocket {
  const handlers: Record<string, Handler[]> = {};
  const managerHandlers: Record<string, Handler[]> = {};
  const emit = jest.fn();

  const add = (target: Record<string, Handler[]>) => (event: string, handler: Handler) => {
    target[event] = (target[event] || []).concat(handler);
  };
  const call = (target: Record<string, Handler[]>) => (event: string, ...args: any[]) => {
    (target[event] || []).forEach(handler => handler(...args));
  };
  const emitsOf = (event: string) =>
    emit.mock.calls.filter(([name]) => name === event).map(([, payload]) => payload);

  return {
    id,
    on: add(handlers),
    off: (event, handler) => {
      handlers[event] = (handlers[event] || []).filter(h => h !== handler);
    },
    emit,
    disconnect: jest.fn(),
    io: { on: add(managerHandlers) },
    fire: call(handlers),
    fireManager: call(managerHandlers),
    emitsOf,
    lastEmit: event => emitsOf(event).pop(),
    hasEmitted: event => emit.mock.calls.some(([name]) => name === event),
  };
}
