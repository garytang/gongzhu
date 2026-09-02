import React, { createContext, useCallback, useContext, useRef, useState, ReactNode, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { loadHandle, loadPlayerId, saveHandle } from './lib/identity';

// Define Player type
export interface Player {
  handle: string;
  playerId: string;
  isBot?: boolean;
}

export interface GameState {
  trick: { player: string; card: string | null }[]; // player is playerId
  turn: number;
  playerHandles: Player[];
  scores: Record<string, number>; // keyed by playerId
  teams?: {
    team1: string[];
    team2: string[];
  } | null;
  cumulativeTeamScores?: {
    team1: number;
    team2: number;
  } | null;
  /** The trick the server resolved most recently, and the playerId that took it. */
  lastTrick?: {
    trick: { player: string; card: string | null }[];
    winner: string;
  } | null;
}

export type RoomPhase = 'waiting' | 'playing' | 'handOver' | 'matchOver';

export interface RoomOptions {
  variant: 'standard' | 'pips';
  teams: boolean;
  targetScore: number;
  visibility: 'public' | 'private';
  /** What becomes of a seat whose player never returns: a bot plays it, or the hand ends. */
  onDisconnect: 'bot' | 'lobby';
}

/** A seated player who has dropped, and the moment their seat stops being theirs. */
export interface AbsentPlayer extends Player {
  /** Epoch milliseconds, as the server sees the clock. */
  deadline: number;
}

/** The room the player is in, as the server describes it. */
export interface RoomState {
  code: string;
  name: string;
  host: Player | null;
  options: RoomOptions;
  seats: Player[];
  spectators: Player[];
  capacity: number;
  phase: RoomPhase;
  absent: AbsentPlayer[];
}

/** One row of the lobby's public room list. */
export interface RoomListing {
  code: string;
  name: string;
  host: string | null;
  seats: number;
  capacity: number;
  phase: RoomPhase;
}

/** 'connecting' also covers reconnection attempts after a drop. */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface PlayerContextType {
  handle: string;
  setHandle: (handle: string) => void;
  players: Player[];
  socket: Socket | null;
  hand: string[];
  /** Cards this player may play right now, as the server sees it; empty otherwise. */
  legalMoves: string[];
  gameState: GameState | null;
  setHand: (hand: string[]) => void;
  playerId: string;
  connectionStatus: ConnectionStatus;
  /** The server has acknowledged the handle, so room events from this socket are allowed. */
  isRegistered: boolean;
  room: RoomState | null;
  roomList: RoomListing[];
  roomError: string | null;
  dismissRoomError: () => void;
  isHost: boolean;
  isSpectator: boolean;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
};


export const PlayerProvider = ({ children }: { children: ReactNode }) => {
  const [handle, setHandleState] = useState(loadHandle);
  const [players, setPlayers] = useState<Player[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [hand, setHand] = useState<string[]>([]);
  const [legalMoves, setLegalMoves] = useState<string[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  // The id claimed on every registration: minted once and kept in localStorage, so a
  // refresh or a dropped connection returns to the seat the server is holding.
  const [claimedId] = useState(loadPlayerId);
  // What the server confirmed it keys this player by, which is the claimed id unless the
  // server refused it and fell back to the socket id.
  const [playerId, setPlayerId] = useState(claimedId);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [roomList, setRoomList] = useState<RoomListing[]>([]);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [registeredHandle, setRegisteredHandle] = useState<string | null>(null);
  // Read from inside the socket's own listeners, which are installed once and would
  // otherwise close over the room this had at mount.
  const roomRef = useRef<RoomState | null>(null);

  const setHandle = useCallback((next: string) => {
    saveHandle(next);
    setHandleState(next);
  }, []);

  useEffect(() => {
    const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000';
    const s = io(backendUrl, {
      transports: ['websocket', 'polling'],
      upgrade: true,
      withCredentials: false,
      forceNew: true
    });
    setSocket(s);

    s.on('connect', () => {
      setConnectionStatus('connected');
    });

    s.on('connect_error', () => {
      setConnectionStatus('disconnected');
    });

    s.on('disconnect', () => {
      setConnectionStatus('disconnected');
      setRegisteredHandle(null);
    });

    // The server's acknowledgement of `register_handle`. Room actions are refused until
    // it arrives, and a component's effect can fire before the provider's, so screens
    // wait for this rather than for the handle being set locally. It also puts a
    // reconnecting socket back into the room its player still holds, so nothing here
    // has to ask for that.
    s.on('handle_registered', (player: Player) => {
      setPlayerId(player.playerId);
      setRegisteredHandle(player.handle);
    });

    // Manager-level event: the client is retrying after a drop.
    s.io?.on('reconnect_attempt', () => {
      setConnectionStatus('connecting');
    });

    // Expect playerList as Player[]
    s.on('player_list', (playerList: Player[]) => {
      setPlayers(playerList);
    });
    s.on('deal_hand', (cards: string[]) => {
      setHand(cards);
    });
    // Sent with every hand. It is handled here rather than on the table because the
    // first one arrives in the same batch as the deal, before the table has mounted.
    // The server sends one per card played, and it is the empty list for the three
    // players not on turn, so an unchanged list keeps its identity and renders nothing.
    s.on('legal_moves', (cards: string[]) => {
      setLegalMoves(previous =>
        previous.length === cards.length && previous.every((card, i) => card === cards[i])
          ? previous
          : cards
      );
    });
    s.on('game_state', (state: GameState) => {
      setGameState(state);
    });

    // A table left behind in a previous room must not show through in the next one.
    const clearTable = () => {
      setPlayers([]);
      setHand([]);
      setLegalMoves([]);
      setGameState(null);
    };

    // The table the room screen and the game table both read. Rejoining the room you are
    // already in — which is what a reconnecting socket does — must not blank the table,
    // or every drop would flash "waiting for game state" over a hand still in progress.
    s.on('room_joined', ({ code }: { code: string }) => {
      setRoomError(null);
      if (code !== roomRef.current?.code) clearTable();
    });
    s.on('room_state', (state: RoomState) => {
      roomRef.current = state;
      setRoom(state);
    });
    s.on('room_left', () => {
      roomRef.current = null;
      setRoom(null);
      clearTable();
    });
    s.on('room_list', (list: RoomListing[]) => {
      setRoomList(list);
    });
    s.on('room_error', (error: { reason: string }) => {
      setRoomError(error?.reason || 'Something went wrong');
    });

    return () => {
      s.disconnect();
    };
    // `claimedId` is minted once and never changes, so the socket is still built once.
  }, [claimedId]);

  /**
   * The one place a handle is registered: when it is first chosen, when it changes, and
   * again after a drop, because Socket.IO reconnects on the same socket object and the
   * server needs the identity re-established on the new connection. `claimedId` never
   * changes and the server's answer is not a dependency, so this fires exactly once per
   * connection rather than a second time on the acknowledgement.
   */
  useEffect(() => {
    if (socket && handle && connectionStatus === 'connected') {
      socket.emit('register_handle', { handle, playerId: claimedId });
    }
  }, [socket, handle, claimedId, connectionStatus]);

  const dismissRoomError = useCallback(() => setRoomError(null), []);

  return (
    <PlayerContext.Provider
      value={{
        handle,
        setHandle,
        players,
        socket,
        hand,
        legalMoves,
        setHand,
        gameState,
        playerId,
        connectionStatus,
        isRegistered: Boolean(handle) && registeredHandle === handle,
        room,
        roomList,
        roomError,
        dismissRoomError,
        isHost: room?.host?.playerId === playerId,
        isSpectator: Boolean(room?.spectators.some(p => p.playerId === playerId)),
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};
