import React, { createContext, useCallback, useContext, useState, ReactNode, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

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
}

export type RoomPhase = 'waiting' | 'playing' | 'handOver' | 'matchOver';

export interface RoomOptions {
  variant: 'standard' | 'pips';
  teams: boolean;
  targetScore: number;
  visibility: 'public' | 'private';
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
  const [handle, setHandle] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [hand, setHand] = useState<string[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [roomList, setRoomList] = useState<RoomListing[]>([]);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [registeredHandle, setRegisteredHandle] = useState<string | null>(null);

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
      setPlayerId(s.id || '');
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
    // wait for this rather than for the handle being set locally.
    s.on('handle_registered', (player: Player) => {
      // The server decides what a seat is keyed by; take its answer rather than
      // assuming the socket id, so WS-06's persistent ids need no client change.
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
    s.on('game_state', (state: GameState) => {
      setGameState(state);
    });

    // A table left behind in a previous room must not show through in the next one.
    const clearTable = () => {
      setPlayers([]);
      setHand([]);
      setGameState(null);
    };

    // The table the room screen and the game table both read.
    s.on('room_joined', () => {
      setRoomError(null);
      clearTable();
    });
    s.on('room_state', (state: RoomState) => {
      setRoom(state);
    });
    s.on('room_left', () => {
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
  }, []);

  useEffect(() => {
    if (socket && handle) {
      socket.emit('register_handle', { handle, playerId });
    }
  }, [socket, handle, playerId]);

  const dismissRoomError = useCallback(() => setRoomError(null), []);

  return (
    <PlayerContext.Provider
      value={{
        handle,
        setHandle,
        players,
        socket,
        hand,
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
