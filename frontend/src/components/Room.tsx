import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePlayer } from '../PlayerContext';
import type { Player, RoomOptions } from '../PlayerContext';
import GameTable from './GameTable';
import Login from './Login';
import RoomOptionsFields from './RoomOptionsFields';
import { button, page, primaryButton } from './styles';

/** The invite link for a room, which is simply the page a guest opens. */
export function inviteLink(code: string): string {
  return `${window.location.origin}/room/${code}`;
}

/**
 * One room, from its URL. `/room/CODE` is the invite link: opening it prompts for a
 * handle if there is not one yet, joins the room, and then shows either the pre-game
 * screen or the table, depending on what the room is doing.
 */
export default function Room() {
  const { code = '' } = useParams<{ code: string }>();
  const wanted = code.toUpperCase();
  const { handle, socket, room, roomError, isRegistered, isHost, isSpectator, playerId } = usePlayer();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<RoomOptions | null>(null);
  const [copied, setCopied] = useState(false);
  // One join attempt per code: a room that refuses us must not be asked again in a loop.
  const requested = useRef<string | null>(null);

  useEffect(() => {
    if (!socket || !isRegistered) return;
    if (room?.code === wanted || requested.current === wanted) return;
    requested.current = wanted;
    socket.emit('join_room', { code: wanted });
  }, [socket, isRegistered, room, wanted]);

  useEffect(() => {
    if (!socket) return;
    const onLeft = () => navigate('/lobby');
    socket.on('room_left', onLeft);
    return () => {
      socket.off('room_left', onLeft);
    };
  }, [socket, navigate]);

  if (!handle) {
    return (
      <Login
        redirectTo={`/room/${wanted}`}
        heading={`Join room ${wanted}`}
        submitLabel="Join room"
      />
    );
  }

  if (!room || room.code !== wanted) {
    return (
      <div style={{ ...page, maxWidth: 400, textAlign: 'center' }}>
        {roomError ? (
          <>
            <p role="alert" style={{ color: '#b00' }}>{roomError}</p>
            <button type="button" style={button} onClick={() => navigate('/lobby')}>
              Back to the lobby
            </button>
          </>
        ) : (
          <p>Joining room {wanted}…</p>
        )}
      </div>
    );
  }

  if (room.phase !== 'waiting') return <GameTable />;

  const emptySeats = room.capacity - room.seats.length;
  const options = draft || room.options;
  const applyOptions = () => {
    socket?.emit('update_room_options', options);
    setDraft(null);
  };

  const copyInvite = () => {
    navigator.clipboard?.writeText(inviteLink(room.code));
    setCopied(true);
  };

  const seatRow = (p: Player) => (
    <li
      key={p.playerId}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}
    >
      <span style={{ fontWeight: p.playerId === playerId ? 'bold' : 'normal' }}>{p.handle}</span>
      {room.host?.playerId === p.playerId && <span title="Host">👑 Host</span>}
      {isHost && p.playerId !== playerId && (
        <button
          type="button"
          style={{ ...button, padding: '2px 8px', fontSize: 13 }}
          onClick={() => socket?.emit('kick', { playerId: p.playerId })}
        >
          Remove
        </button>
      )}
    </li>
  );

  return (
    <div style={{ ...page, maxWidth: 480 }}>
      <h2 style={{ textAlign: 'center', marginBottom: 4 }}>{room.name}</h2>

      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <div style={{ fontSize: 40, letterSpacing: 6, fontWeight: 'bold' }}>{room.code}</div>
        <button type="button" style={button} onClick={copyInvite}>
          {copied ? 'Invite link copied' : 'Copy invite link'}
        </button>
      </div>

      {roomError && (
        <div role="alert" style={{ color: '#b00', textAlign: 'center', marginBottom: '1rem' }}>
          {roomError}
        </div>
      )}

      <h3>Players ({room.seats.length}/{room.capacity})</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>{room.seats.map(seatRow)}</ul>
      {emptySeats > 0 && (
        <div style={{ color: 'gray' }}>
          {emptySeats} bot{emptySeats === 1 ? '' : 's'} will fill the rest
        </div>
      )}

      {room.spectators.length > 0 && (
        <>
          <h3>Spectators ({room.spectators.length})</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>{room.spectators.map(seatRow)}</ul>
        </>
      )}
      {isSpectator && <p style={{ color: '#666' }}>You are spectating; you take a seat when one frees up.</p>}

      <h3>Options</h3>
      <RoomOptionsFields options={options} onChange={isHost ? setDraft : undefined} />
      {isHost && draft && (
        <button type="button" style={button} onClick={applyOptions}>Apply options</button>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: '1.5rem', justifyContent: 'center' }}>
        {isHost ? (
          <button
            type="button"
            style={{ ...primaryButton, opacity: room.seats.length >= 1 ? 1 : 0.5 }}
            disabled={room.seats.length < 1}
            onClick={() => socket?.emit('start_game')}
          >
            Start Game
          </button>
        ) : (
          <span style={{ color: '#666', alignSelf: 'center' }}>
            Waiting for {room.host?.handle ?? 'the host'} to start…
          </span>
        )}
        <button type="button" style={button} onClick={() => socket?.emit('leave_room')}>
          Leave
        </button>
      </div>
    </div>
  );
}
