import React from 'react';
import { usePlayer } from '../PlayerContext';

/**
 * Fixed banner shown whenever the socket is not connected. Renders nothing while
 * the connection is healthy.
 */
export default function ConnectionBanner() {
  const { connectionStatus } = usePlayer();

  if (connectionStatus === 'connected') return null;

  const reconnecting = connectionStatus === 'connecting';

  return (
    <div
      role="status"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 900,
        padding: '8px 12px',
        textAlign: 'center',
        fontWeight: 600,
        color: '#fff',
        background: reconnecting ? '#ef6c00' : '#c62828',
      }}
    >
      {reconnecting ? 'Connecting to the server…' : 'Disconnected — trying to reconnect…'}
    </div>
  );
}
