import React from 'react';
import type { Player } from '../PlayerContext';
import { cardColor, TrickEntry } from '../lib/cards';
import { teamBackground } from './styles';

interface TrickProps {
  seats: Player[];
  trick: TrickEntry[];
  myPlayerId: string;
  /** Player whose turn it is; outlined so the table shows who everyone waits for. */
  currentPlayerId?: string;
  /** Player who led this trick, or who is about to lead an empty one. */
  leaderId?: string;
  teamOf: (playerId: string) => 0 | 1 | 2;
  /** Handle of the player who took the trick just cleared, while the flash lasts. */
  lastWinnerHandle: string | null;
}

export default function Trick({
  seats,
  trick,
  myPlayerId,
  currentPlayerId,
  leaderId,
  teamOf,
  lastWinnerHandle,
}: TrickProps) {
  return (
    <div
      style={{
        margin: '0 auto 24px auto',
        padding: 12,
        border: '1px solid #eee',
        borderRadius: 8,
        background: '#fafafa',
      }}
    >
      <h3 style={{ margin: 0, fontSize: 18 }}>Current Trick</h3>
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {seats.map((p: Player) => {
          const played = trick.find(entry => entry.player === p.playerId);
          const isLeader = p.playerId === leaderId;
          const isCurrent = p.playerId === currentPlayerId;
          return (
            <div
              key={p.playerId}
              style={{
                flex: '1 1 64px',
                minWidth: 64,
                maxWidth: 110,
                textAlign: 'center',
                borderRadius: 8,
                padding: 4,
                border: isCurrent ? '2px solid #2e7d32' : '2px solid transparent',
              }}
            >
              <div
                style={{
                  fontWeight: p.playerId === myPlayerId ? 'bold' : 'normal',
                  fontSize: 13,
                  background: teamBackground(teamOf(p.playerId)),
                  color: '#222',
                  borderRadius: 6,
                  padding: '2px 4px',
                  overflowWrap: 'anywhere',
                }}
              >
                {p.isBot && <span style={{ marginRight: 4, fontSize: 12 }}>🤖</span>}
                {p.handle}
              </div>
              <div style={{ fontSize: 11, color: '#666', height: 14 }}>{isLeader ? 'leads' : ''}</div>
              <div style={{ fontSize: 24, color: played?.card ? cardColor(played.card) : undefined }}>
                {played?.card || '—'}
              </div>
            </div>
          );
        })}
      </div>
      <div role="status" style={{ minHeight: 22, marginTop: 6, textAlign: 'center', color: '#2e7d32', fontWeight: 600 }}>
        {lastWinnerHandle ? `${lastWinnerHandle} won the trick` : ''}
      </div>
    </div>
  );
}
