import React from 'react';
import { teamBackground } from './styles';

interface ScoreboardProps {
  team1: number;
  team2: number;
  /** 0 when this player's team is unknown. */
  myTeam: 0 | 1 | 2;
}

export default function Scoreboard({ team1, team2, myTeam }: ScoreboardProps) {
  const tile = (team: 1 | 2, score: number) => (
    <span
      data-testid={`team-${team}-score`}
      style={{
        color: '#222',
        background: teamBackground(team),
        borderRadius: 8,
        padding: '4px 12px',
        border: myTeam === team ? '2px solid #1976D2' : '2px solid transparent',
      }}
    >
      Team {team}{myTeam === team ? ' (you)' : ''}: {score}
    </span>
  );

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 16,
        fontWeight: 'bold',
        fontSize: 18,
      }}
    >
      {tile(1, team1)}
      {tile(2, team2)}
    </div>
  );
}
