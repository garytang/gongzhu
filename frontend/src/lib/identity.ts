/**
 * Who you are between page loads.
 *
 * The server keys your seat, your room membership and every message addressed to you by
 * the `playerId` sent with `register_handle`. Minting it once and keeping it — along with
 * the handle, so a refresh does not ask for a name again — is what turns a reload or a
 * dropped connection into a reconnection rather than a new player arriving.
 */

/** Exported so that a test can seed an identity the way a previous visit would have. */
export const PLAYER_ID_KEY = 'gongzhu.playerId';
export const HANDLE_KEY = 'gongzhu.handle';

/** `crypto.randomUUID` needs a secure context, which plain http on a LAN address is not. */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/** Storage is unavailable in some private-browsing modes, and reads there throw. */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A player who cannot store anything still plays; they just arrive as someone new
    // after a refresh.
  }
}

export function loadPlayerId(): string {
  const stored = read(PLAYER_ID_KEY);
  if (stored) return stored;
  const id = newId();
  write(PLAYER_ID_KEY, id);
  return id;
}

export const loadHandle = (): string => read(HANDLE_KEY) || '';

export const saveHandle = (handle: string): void => write(HANDLE_KEY, handle);
