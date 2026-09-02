import React from 'react';
import type { GameState, Player } from '../PlayerContext';
import { cardColor, pointCards } from '../lib/cards';
import { sumTeamScore, teamMembers } from '../lib/scores';
import { modalCard, overlay, button, primaryButton } from './styles';

export interface GameOverData {
  scores: Record<string, number>;
  collected: Record<string, string[]>;
  teamInfo?: {
    team1: { players: string[]; roundScore: number; cumulativeScore: number };
    team2: { players: string[]; roundScore: number; cumulativeScore: number };
  };
  gameEnded?: boolean;
  winningTeam?: number | null;
}

interface TeamSummary {
  team: 1 | 2;
  players: string;
  roundScore: number;
  cumulativeScore?: number;
  isWinner: boolean;
}

function handlesFor(playerIds: string[], seats: Player[]): string {
  return playerIds.map(id => seats.find(p => p.playerId === id)?.handle || id).join(' & ');
}

/**
 * Prefers the backend's `teamInfo` (which carries cumulative totals). Without it,
 * team totals are summed from the per-player scores in the `game_over` payload.
 */
function summarizeTeams(data: GameOverData, gameState: GameState | null): TeamSummary[] {
  if (data.teamInfo) {
    return ([1, 2] as const).map(team => {
      const info = team === 1 ? data.teamInfo!.team1 : data.teamInfo!.team2;
      return {
        team,
        players: info.players.join(' & '),
        roundScore: info.roundScore,
        cumulativeScore: info.cumulativeScore,
        isWinner: data.winningTeam === team,
      };
    });
  }

  const seats = gameState?.playerHandles || [];
  const memberIds = teamMembers(gameState);
  const totals = memberIds.map(ids => sumTeamScore(data.scores, ids));

  return ([1, 2] as const).map((team, i) => ({
    team,
    players: handlesFor(memberIds[i], seats),
    roundScore: totals[i],
    isWinner: totals[0] > totals[1] ? team === 1 : team === 2,
  }));
}

interface GameOverModalProps {
  data: GameOverData;
  gameState: GameState | null;
  myHandle: string;
  onClose: () => void;
  onContinue: () => void;
  onNewGame: () => void;
}

export default function GameOverModal({
  data,
  gameState,
  myHandle,
  onClose,
  onContinue,
  onNewGame,
}: GameOverModalProps) {
  const teams = summarizeTeams(data, gameState);

  return (
    <div style={overlay}>
      <div style={modalCard}>
        <h2>{data.gameEnded ? 'Game Over!' : 'Round Over'}</h2>

        <h3>Team Scores</h3>
        <div style={{ marginBottom: 20 }}>
          {teams.map(team => (
            <div
              key={team.team}
              style={{
                padding: 12,
                margin: '8px 0',
                borderRadius: 6,
                background: team.isWinner ? '#e8f5e8' : '#f5f5f5',
                border: team.isWinner ? '2px solid #4CAF50' : '1px solid #ddd',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong>Team {team.team} ({team.players})</strong>
                {team.isWinner && <span style={{ color: '#4CAF50', fontSize: 24 }}>🏆</span>}
              </div>
              <div>Round: {team.roundScore}</div>
              {team.cumulativeScore !== undefined && (
                <div>Total: <strong>{team.cumulativeScore}</strong></div>
              )}
            </div>
          ))}
        </div>

        <h3>Collected Cards This Round</h3>
        <ul style={{ listStyle: 'none', padding: 0, marginBottom: 20 }}>
          {Object.entries(data.collected).map(([player, cards]) => {
            const points = pointCards(cards);
            return (
              <li key={player} style={{ margin: '8px 0', fontWeight: player === myHandle ? 'bold' : 'normal' }}>
                {player}:{' '}
                {points.length > 0 ? (
                  points.map((card, idx) => (
                    <span key={idx} style={{ color: cardColor(card), marginRight: 2 }}>
                      {card}{idx < points.length - 1 ? ',' : ''}
                    </span>
                  ))
                ) : (
                  <span style={{ color: '#888' }}>No point cards</span>
                )}
              </li>
            );
          })}
        </ul>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button style={button} onClick={onClose}>Close</button>
          {!data.gameEnded && (
            <button style={primaryButton} onClick={onContinue}>Continue (Same Teams)</button>
          )}
          <button style={{ ...primaryButton, background: '#4CAF50' }} onClick={onNewGame}>
            {data.gameEnded ? 'Start New Game' : 'New Game (New Teams)'}
          </button>
        </div>
      </div>
    </div>
  );
}
