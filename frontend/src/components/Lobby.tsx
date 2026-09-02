import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayer } from '../PlayerContext';
import type { Player } from '../PlayerContext';
import { button, page, primaryButton } from './styles';

export default function Lobby() {
  const { handle, setHandle, players, socket } = usePlayer();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const isRegistered = Boolean(handle);
  // Bots fill the remaining seats, so one registered player is enough to start.
  const canStart = players.length >= 1 && isRegistered;

  useEffect(() => {
    if (!socket) return;
    const onGameStarted = () => {
      navigate('/game');
    };
    socket.on('game_started', onGameStarted);
    return () => {
      socket.off('game_started', onGameStarted);
    };
  }, [socket, navigate]);

  const handleStart = () => {
    if (canStart && socket) {
      socket.emit('start_game');
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && socket) {
      setHandle(input.trim());
      setInput('');
    }
  };

  return (
    <div style={{ ...page, maxWidth: 400, textAlign: 'center' }}>
      <h2>Lobby</h2>

      {isRegistered ? (
        <div style={{ marginBottom: '1rem' }}>You are: <b>{handle}</b></div>
      ) : (
        <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f5f5f5', borderRadius: 8 }}>
          <h3>Join the Game</h3>
          <form onSubmit={handleJoin}>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Enter your handle"
              aria-label="Enter your handle"
              style={{ padding: '0.5rem', width: '70%', marginRight: '0.5rem', boxSizing: 'border-box' }}
            />
            <button type="submit" style={button}>
              Join
            </button>
          </form>
        </div>
      )}

      <h3>Players Ready to Play ({players.length}/4):</h3>
      <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
        {players.map((p: Player, i) => (
          <li key={p.playerId || i} style={{ padding: '0.5rem 0', fontWeight: p.handle === handle ? 'bold' : 'normal' }}>
            {p.isBot && <span style={{ marginRight: '0.5rem', fontSize: '0.9em' }}>🤖</span>}
            {p.handle}
          </li>
        ))}
        {players.length === 0 && (
          <li style={{ color: 'gray', fontStyle: 'italic' }}>No players registered yet</li>
        )}
      </ul>

      {isRegistered && (
        <button
          onClick={handleStart}
          disabled={!canStart}
          style={{ ...primaryButton, marginTop: '1rem', opacity: canStart ? 1 : 0.5 }}
        >
          Start Game
        </button>
      )}

      {!canStart && players.length === 0 && (
        <div style={{ marginTop: '0.5rem', color: 'gray' }}>
          Register to start the game (bots will fill remaining spots)
        </div>
      )}

      {players.length > 0 && players.length < 4 && (
        <div style={{ marginTop: '0.5rem', color: 'gray' }}>
          {4 - players.length} bots will be added to fill the game
        </div>
      )}
    </div>
  );
}
