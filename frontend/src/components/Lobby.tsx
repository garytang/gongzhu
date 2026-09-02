import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayer } from '../PlayerContext';
import type { RoomListing, RoomOptions } from '../PlayerContext';
import Login from './Login';
import RoomOptionsFields from './RoomOptionsFields';
import { button, page, primaryButton } from './styles';

const NEW_ROOM_OPTIONS: RoomOptions = {
  variant: 'standard',
  teams: true,
  targetScore: 1000,
  visibility: 'public',
  onDisconnect: 'bot',
};

const PHASE_LABEL: Record<RoomListing['phase'], string> = {
  waiting: 'Waiting',
  playing: 'In progress',
  handOver: 'Between hands',
  matchOver: 'Finished',
};

export default function Lobby() {
  const { handle, socket, room, roomList, roomError, dismissRoomError, isRegistered } = usePlayer();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [options, setOptions] = useState<RoomOptions>(NEW_ROOM_OPTIONS);
  const [code, setCode] = useState('');

  // Joining or creating lands the player in a room, whose URL is the invite link.
  useEffect(() => {
    if (room) navigate(`/room/${room.code}`);
  }, [room, navigate]);

  useEffect(() => {
    if (socket && isRegistered) socket.emit('list_rooms');
  }, [socket, isRegistered]);

  const createRoom = (e: React.FormEvent) => {
    e.preventDefault();
    dismissRoomError();
    socket?.emit('create_room', { name: name.trim(), options });
  };

  const joinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    dismissRoomError();
    socket?.emit('join_room', { code: code.trim() });
  };

  // The lobby needs a handle before the server will let it create or join anything, so
  // an unregistered visitor gets the same prompt the login route shows.
  if (!isRegistered) return <Login redirectTo="/lobby" heading="Pick a handle" />;

  return (
    <div style={{ ...page, maxWidth: 480 }}>
      <h2 style={{ textAlign: 'center' }}>Lobby</h2>
      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>You are: <b>{handle}</b></div>

      {roomError && (
        <div role="alert" style={{ color: '#b00', textAlign: 'center', marginBottom: '1rem' }}>
          {roomError}
        </div>
      )}

      <section style={{ padding: '1rem', background: '#f5f5f5', borderRadius: 8, marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Create a room</h3>
        <form onSubmit={createRoom}>
          <label style={{ display: 'block', marginBottom: 8 }}>
            Room name
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={`${handle}'s table`}
              aria-label="Room name"
              style={{ padding: '0.5rem', width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          <RoomOptionsFields options={options} onChange={setOptions} />
          <button type="submit" style={{ ...primaryButton, marginTop: 8 }}>Create room</button>
        </form>
      </section>

      <section style={{ marginBottom: '1rem' }}>
        <h3>Join by code</h3>
        <form onSubmit={joinByCode}>
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            aria-label="Room code"
            maxLength={8}
            style={{
              padding: '0.5rem',
              width: '50%',
              marginRight: '0.5rem',
              boxSizing: 'border-box',
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
          />
          <button type="submit" style={button} disabled={!code.trim()}>Join</button>
        </form>
      </section>

      <section>
        <h3>Public rooms ({roomList.length})</h3>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {roomList.map(entry => (
            <li
              key={entry.code}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '0.5rem 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <span>
                <b>{entry.name}</b>
                <span style={{ color: '#666' }}>
                  {/* A room whose members have all left is kept briefly and has no host. */}
                  {' '}· {entry.code} · {entry.host || 'no host'} · {entry.seats}/{entry.capacity} ·{' '}
                  {PHASE_LABEL[entry.phase]}
                </span>
              </span>
              <button
                type="button"
                style={button}
                aria-label={`Join ${entry.name}`}
                onClick={() => {
                  dismissRoomError();
                  socket?.emit('join_room', { code: entry.code });
                }}
              >
                Join
              </button>
            </li>
          ))}
          {roomList.length === 0 && (
            <li style={{ color: 'gray', fontStyle: 'italic' }}>No public rooms yet — create one</li>
          )}
        </ul>
      </section>
    </div>
  );
}
