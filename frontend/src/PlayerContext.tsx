import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

// Define Player type
export interface Player {
  handle: string;
  playerId: string;
}

interface GameState {
  trick: { player: string; card: string | null }[]; // player is playerId
  turn: number;
  playerHandles: Player[];
  scores: Record<string, number>; // keyed by playerId
  teams?: {
    team1: string[];
    team2: string[];
  };
  cumulativeTeamScores?: {
    team1: number;
    team2: number;
  };
}

interface PlayerContextType {
  handle: string;
  setHandle: (handle: string) => void;
  players: Player[];
  socket: Socket | null;
  hand: string[];
  gameState: GameState | null;
  setHand: (hand: string[]) => void;
  playerId: string;
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

  useEffect(() => {
    const s = io('http://localhost:4000');
    setSocket(s);
    
    s.on('connect', () => {
      setPlayerId(s.id || '');
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
    return () => {
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    if (socket && handle) {
      socket.emit('register_handle', { handle, playerId });
    }
  }, [socket, handle, playerId]);

  return (
    <PlayerContext.Provider value={{ handle, setHandle, players, socket, hand, setHand, gameState, playerId }}>
      {children}
    </PlayerContext.Provider>
  );
}; 