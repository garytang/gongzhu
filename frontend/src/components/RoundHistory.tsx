import React, { useState } from 'react';
import type { Player } from '../PlayerContext';
import { teamPairs } from '../lib/scores';
import type { GameOverData } from './GameOverModal';
import { button } from './styles';

/** One hand's score for one side, and the match total it left them on. */
interface Score {
  round: number;
  total: number;
}

interface Ledger {
  /** Column headings: the two teams, or the four players. */
  labels: string[];
  /** One row per completed hand, its scores in `labels` order. */
  hands: Score[][];
}

/**
 * The ledger for the hands given. Team totals are the server's own, which is the
 * only side that keeps them; individual totals are summed here, which is exact
 * because the caller drops the results whenever the match restarts.
 */
function ledgerFor(results: GameOverData[], seats: Player[]): Ledger {
  const teamInfos = results
    .map(result => result.teamInfo)
    .filter((info): info is NonNullable<GameOverData['teamInfo']> => Boolean(info));

  if (teamInfos.length === results.length && teamInfos.length > 0) {
    return {
      labels: teamPairs(teamInfos[0]).map(([team]) => `Team ${team}`),
      hands: teamInfos.map(info =>
        teamPairs(info).map(([, side]) => ({ round: side.roundScore, total: side.cumulativeScore }))),
    };
  }

  const totals: Record<string, number> = {};
  return {
    labels: seats.map(seat => seat.handle),
    hands: results.map(result =>
      seats.map(seat => {
        const round = result.scores[seat.playerId] ?? 0;
        totals[seat.playerId] = (totals[seat.playerId] ?? 0) + round;
        return { round, total: totals[seat.playerId] };
      })),
  };
}

const cell: React.CSSProperties = {
  padding: '4px 6px',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

interface RoundHistoryProps {
  /** The `game_over` payloads of the current match, oldest first. */
  results: GameOverData[];
  seats: Player[];
}

/**
 * Every hand of the current match, newest first: what each side scored and the
 * running total it left them on. Collapsed by default so it costs no room on a phone.
 */
export default function RoundHistory({ results, seats }: RoundHistoryProps) {
  const [open, setOpen] = useState(false);

  if (results.length === 0) return null;

  const { labels, hands } = ledgerFor(results, seats);

  return (
    <div style={{ marginTop: 18 }}>
      <button type="button" style={button} onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide' : 'Show'} round history ({hands.length})
      </button>

      {open && (
        <table
          data-testid="round-history"
          style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse', fontSize: 13 }}
        >
          <thead>
            <tr>
              <th style={{ ...cell, textAlign: 'left' }}>Hand</th>
              {labels.map(label => (
                <th key={label} style={cell}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hands
              .map((scores, index) => ({ hand: index + 1, scores }))
              .reverse()
              .map(({ hand, scores }) => (
                <tr key={hand} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ ...cell, textAlign: 'left' }}>{hand}</td>
                  {scores.map((score, column) => (
                    <td key={labels[column]} style={cell}>
                      {score.round > 0 ? `+${score.round}` : score.round}
                      <span style={{ color: '#888' }}> ({score.total})</span>
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
