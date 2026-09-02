import React, { ReactNode } from 'react';
import type { GameState } from '../PlayerContext';
import { cardColor, pointCards } from '../lib/cards';
import { modalCard, overlay, button, primaryButton } from './styles';

export interface GameOverData {
  scores: Record<string, number>;
  collected: Record<string, string[]>;
  /** Null when the room scores individuals, which is what selects the summary below. */
  teamInfo?: {
    team1: { players: string[]; roundScore: number; cumulativeScore: number };
    team2: { players: string[]; roundScore: number; cumulativeScore: number };
  } | null;
  gameEnded?: boolean;
  winningTeam?: number | null;
  /** Handles of the winning players. The only form of the result without teams. */
  winners?: string[];
}

/** One result card. `won` gives it the winner's green treatment. */
function ResultRow({ won, children }: { won: boolean; children: ReactNode }) {
  return (
    <div
      data-testid="result-row"
      style={{
        padding: 12,
        margin: '8px 0',
        borderRadius: 6,
        background: won ? '#e8f5e8' : '#f5f5f5',
        border: won ? '2px solid #4CAF50' : '1px solid #ddd',
      }}
    >
      {children}
    </div>
  );
}

/** Team totals, including the cumulative match scores only the backend knows. */
function TeamResults({ teamInfo, winningTeam }: {
  teamInfo: NonNullable<GameOverData['teamInfo']>;
  winningTeam?: number | null;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      {([1, 2] as const).map(team => {
        const info = team === 1 ? teamInfo.team1 : teamInfo.team2;
        const won = winningTeam === team;
        return (
          <ResultRow key={team} won={won}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <strong>Team {team} ({info.players.join(' & ')})</strong>
              {won && <span style={{ color: '#4CAF50', fontSize: 24 }}>🏆</span>}
            </div>
            <div>Round: {info.roundScore}</div>
            <div>Total: <strong>{info.cumulativeScore}</strong></div>
          </ResultRow>
        );
      })}
    </div>
  );
}

/** Per-player totals, shown when the room scores individuals rather than teams. */
function IndividualResults({ data, gameState }: { data: GameOverData; gameState: GameState | null }) {
  const winners = data.winners || [];
  return (
    <div style={{ marginBottom: 20 }}>
      {(gameState?.playerHandles || []).map(seat => {
        const won = winners.includes(seat.handle);
        return (
          <ResultRow key={seat.playerId} won={won}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{seat.handle}</strong>
              <span>Round: {data.scores[seat.playerId] ?? 0} {won && '🏆'}</span>
            </div>
          </ResultRow>
        );
      })}
    </div>
  );
}

interface GameOverModalProps {
  data: GameOverData;
  gameState: GameState | null;
  myHandle: string;
  /** Only the room's host may deal the next hand or start a new game. */
  canControl: boolean;
  hostHandle?: string;
  onClose: () => void;
  onContinue: () => void;
  onNewGame: () => void;
}

export default function GameOverModal({
  data,
  gameState,
  myHandle,
  canControl,
  hostHandle,
  onClose,
  onContinue,
  onNewGame,
}: GameOverModalProps) {
  const { teamInfo } = data;

  return (
    <div style={overlay}>
      <div role="dialog" aria-modal="true" aria-label="Results" style={modalCard}>
        <h2>{data.gameEnded ? 'Game Over!' : 'Round Over'}</h2>

        <h3>{teamInfo ? 'Team Scores' : 'Scores'}</h3>
        {teamInfo ? (
          <TeamResults teamInfo={teamInfo} winningTeam={data.winningTeam} />
        ) : (
          <IndividualResults data={data} gameState={gameState} />
        )}

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
          {canControl ? (
            <>
              {!data.gameEnded && (
                <button style={primaryButton} onClick={onContinue}>
                  {teamInfo ? 'Continue (Same Teams)' : 'Continue (Same Seats)'}
                </button>
              )}
              <button style={{ ...primaryButton, background: '#4CAF50' }} onClick={onNewGame}>
                {data.gameEnded ? 'Start New Game' : 'New Game (New Seats)'}
              </button>
            </>
          ) : (
            <span style={{ alignSelf: 'center', color: '#666' }}>
              Waiting for {hostHandle || 'the host'}…
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
