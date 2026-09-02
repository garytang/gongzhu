import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayer } from '../PlayerContext';
import { page, primaryButton } from './styles';

export default function Login() {
  const { handle, setHandle } = usePlayer();
  const [input, setInput] = useState(handle);
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      setHandle(input.trim());
      navigate('/lobby');
    }
  };

  return (
    <div style={{ ...page, maxWidth: 400, textAlign: 'center' }}>
      <h2>Enter your handle</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Nickname"
          aria-label="Nickname"
          style={{ padding: '0.5rem', width: '80%', boxSizing: 'border-box' }}
        />
        <br />
        <button type="submit" style={{ ...primaryButton, marginTop: '1rem' }}>
          Enter Lobby
        </button>
      </form>
    </div>
  );
}
