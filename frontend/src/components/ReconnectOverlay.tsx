import React, { useEffect, useState } from 'react';
import { usePlayer } from '../PlayerContext';
import { banner } from './styles';

/**
 * The countdown shown while a seated player is away. The table is frozen until they
 * return or their time runs out, so this says who everyone is waiting for and for how
 * much longer. It reads the room rather than the disconnect event, so a player who
 * arrives or refreshes mid-countdown sees the same thing as everyone else.
 */
export default function ReconnectOverlay() {
  const { room } = usePlayer();
  const absent = room?.absent ?? [];
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (absent.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [absent.length]);

  if (absent.length === 0) return null;

  return (
    <div
      role="status"
      style={{ ...banner, margin: '0 auto 12px', maxWidth: 420, borderRadius: 8 }}
    >
      {absent.map(player => (
        <div key={player.playerId}>
          {player.handle} disconnected — {Math.max(0, Math.ceil((player.deadline - now) / 1000))}s
          to reconnect
        </div>
      ))}
    </div>
  );
}
