import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayer } from '../PlayerContext';
import { page, primaryButton } from './styles';

interface LoginProps {
  /** Where to go once a handle is set. A room asks for a handle before letting you in. */
  redirectTo?: string;
  heading?: string;
  submitLabel?: string;
}

export default function Login({
  redirectTo = '/lobby',
  heading = 'Enter your handle',
  submitLabel = 'Enter Lobby',
}: LoginProps) {
  const { handle, setHandle } = usePlayer();
  const [input, setInput] = useState(handle);
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      setHandle(input.trim());
      navigate(redirectTo);
    }
  };

  return (
    <div style={{ ...page, maxWidth: 400, textAlign: 'center' }}>
      <h2>{heading}</h2>
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
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
