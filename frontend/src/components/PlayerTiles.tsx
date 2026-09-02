import React from 'react';
import type { Player } from '../PlayerContext';
import { teamBackground } from './styles';

interface PlayerTilesProps {
  players: Player[];
  teamOf: (playerId: string) => 0 | 1 | 2;
  /** Opens that player's collected point cards. */
  onSelect: (playerId: string) => void;
}

/** The other three players, as tiles that open their collected point cards. */
export default function PlayerTiles({ players, teamOf, onSelect }: PlayerTilesProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
      {players.map(p => (
        <button
          key={p.playerId}
          type="button"
          onClick={() => onSelect(p.playerId)}
          style={{
            flex: '0 1 90px',
            minHeight: 70,
            background: teamBackground(teamOf(p.playerId)),
            color: '#222',
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
            border: p.isBot ? '1px dashed #aaa' : '1px solid #ddd',
            overflowWrap: 'anywhere',
          }}
        >
          {p.isBot && <span style={{ fontSize: 12, marginBottom: 2 }}>🤖</span>}
          <span style={{ fontSize: 14 }}>{p.handle}</span>
        </button>
      ))}
    </div>
  );
}
