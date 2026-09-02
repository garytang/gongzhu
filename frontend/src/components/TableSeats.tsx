import React from 'react';
import type { Player } from '../PlayerContext';
import { cardColor, TrickEntry } from '../lib/cards';
import { teamBackground } from './styles';

/** Where a seat is drawn, relative to the player looking at the table. */
type Position = 'bottom' | 'left' | 'top' | 'right';

/**
 * Play passes to the next seat in `playerHandles` order, which is the seat on your
 * left at a physical table. So the seat two along is the one across from you — the
 * teammate, under the standard 0 & 2 against 1 & 3 pairing.
 */
const POSITIONS: Position[] = ['bottom', 'left', 'top', 'right'];

interface TableSeatsProps {
  seats: Player[];
  trick: TrickEntry[];
  myPlayerId: string;
  /** Player whose turn it is; outlined so the table shows who everyone waits for. */
  currentPlayerId?: string;
  /** Player who led this trick, or who is about to lead an empty one. */
  leaderId?: string;
  teamOf: (playerId: string) => 0 | 1 | 2;
  /** Handle of the player who took the trick just played, while the flash lasts. */
  lastWinnerHandle: string | null;
  /** Opens that player's collected point cards. */
  onSelect: (playerId: string) => void;
}

/**
 * The table, seen from this player's chair: you at the bottom, the seat across the
 * table at the top, the other two on the sides, each showing the card it has played
 * into the current trick.
 */
export default function TableSeats({
  seats,
  trick,
  myPlayerId,
  currentPlayerId,
  leaderId,
  teamOf,
  lastWinnerHandle,
  onSelect,
}: TableSeatsProps) {
  // A spectator is in no seat; they watch the table from seat 0's chair.
  const mySeat = Math.max(0, seats.findIndex(p => p.playerId === myPlayerId));

  return (
    <div
      data-testid="table"
      style={{
        margin: '0 auto 24px auto',
        padding: 12,
        border: '1px solid #eee',
        borderRadius: 8,
        background: '#fafafa',
        display: 'grid',
        gridTemplateColumns: '1fr 1.2fr 1fr',
        gridTemplateAreas: '". top ." "left center right" ". bottom ."',
        gap: 8,
        alignItems: 'center',
      }}
    >
      {seats.map((seat, index) => {
        const position = POSITIONS[(index - mySeat + seats.length) % seats.length];
        return (
          <Seat
            key={seat.playerId}
            seat={seat}
            position={position}
            card={trick.find(entry => entry.player === seat.playerId)?.card ?? null}
            isMe={seat.playerId === myPlayerId}
            isLeader={seat.playerId === leaderId}
            isCurrent={seat.playerId === currentPlayerId}
            team={teamOf(seat.playerId)}
            onSelect={onSelect}
          />
        );
      })}

      <div
        role="status"
        style={{
          gridArea: 'center',
          minHeight: 40,
          textAlign: 'center',
          color: '#2e7d32',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        {lastWinnerHandle ? `${lastWinnerHandle} won the trick` : ''}
      </div>
    </div>
  );
}

interface SeatProps {
  seat: Player;
  position: Position;
  card: string | null;
  isMe: boolean;
  isLeader: boolean;
  isCurrent: boolean;
  team: 0 | 1 | 2;
  onSelect: (playerId: string) => void;
}

/** One chair: who sits there, and the card they have played into this trick. */
function Seat({ seat, position, card, isMe, isLeader, isCurrent, team, onSelect }: SeatProps) {
  return (
    <button
      type="button"
      data-testid={`seat-${position}`}
      onClick={() => onSelect(seat.playerId)}
      style={{
        gridArea: position,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        padding: 4,
        background: 'transparent',
        borderRadius: 8,
        border: isCurrent ? '2px solid #2e7d32' : '2px solid transparent',
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontWeight: isMe ? 'bold' : 'normal',
          fontSize: 13,
          background: teamBackground(team),
          color: '#222',
          borderRadius: 6,
          padding: '2px 6px',
          maxWidth: '100%',
          overflowWrap: 'anywhere',
        }}
      >
        {seat.isBot && <span style={{ marginRight: 4, fontSize: 12 }}>🤖</span>}
        {seat.handle}
      </span>
      <span style={{ fontSize: 11, color: '#666', height: 14 }}>{isLeader ? 'leads' : ''}</span>
      <span style={{ fontSize: 26, color: card ? cardColor(card) : undefined }}>{card || '—'}</span>
    </button>
  );
}
