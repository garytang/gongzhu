import React, { ReactNode } from 'react';
import type { Player } from '../PlayerContext';
import { teamBackground } from './styles';

const scoreRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: 12,
  marginBottom: 16,
  fontWeight: 'bold',
  fontSize: 18,
};

interface TileProps {
  testId: string;
  /** 0 for a player with no team, which is also the neutral individual-scoring colour. */
  team: 0 | 1 | 2;
  /** Outlines the tile that belongs to the player looking at it. */
  mine: boolean;
  children: ReactNode;
}

function Tile({ testId, team, mine, children }: TileProps) {
  return (
    <span
      data-testid={testId}
      style={{
        color: '#222',
        background: teamBackground(team),
        borderRadius: 8,
        padding: '4px 12px',
        border: mine ? '2px solid #1976D2' : '2px solid transparent',
      }}
    >
      {children}
    </span>
  );
}

/** Running totals when the room scores individuals rather than teams. */
export function IndividualScores({
  seats,
  scores,
  myPlayerId,
}: {
  seats: Player[];
  scores: Record<string, number>;
  myPlayerId: string;
}) {
  return (
    <div style={scoreRow}>
      {seats.map(seat => (
        <Tile
          key={seat.playerId}
          testId={`score-${seat.playerId}`}
          team={0}
          mine={seat.playerId === myPlayerId}
        >
          {seat.handle}: {scores[seat.playerId] ?? 0}
        </Tile>
      ))}
    </div>
  );
}

interface ScoreboardProps {
  team1: number;
  team2: number;
  /** 0 when this player's team is unknown. */
  myTeam: 0 | 1 | 2;
}

export default function Scoreboard({ team1, team2, myTeam }: ScoreboardProps) {
  const tile = (team: 1 | 2, score: number) => (
    <Tile testId={`team-${team}-score`} team={team} mine={myTeam === team}>
      Team {team}{myTeam === team ? ' (you)' : ''}: {score}
    </Tile>
  );

  return (
    <div style={scoreRow}>
      {tile(1, team1)}
      {tile(2, team2)}
    </div>
  );
}
