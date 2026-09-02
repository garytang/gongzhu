import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Player } from '../PlayerContext';
import type { GameOverData } from './GameOverModal';
import RoundHistory from './RoundHistory';

const seats: Player[] = [
  { handle: 'Ann', playerId: 'p0' },
  { handle: 'Bob', playerId: 'p1' },
];

function teamResult(round1: number, total1: number, round2: number, total2: number): GameOverData {
  return {
    scores: {},
    collected: {},
    teamInfo: {
      team1: { players: ['Ann'], roundScore: round1, cumulativeScore: total1 },
      team2: { players: ['Bob'], roundScore: round2, cumulativeScore: total2 },
    },
  };
}

function individualResult(scores: Record<string, number>): GameOverData {
  return { scores, collected: {}, teamInfo: null };
}

const teamResults = [teamResult(-100, -100, -100, -100), teamResult(100, 0, -300, -400)];

async function open() {
  await userEvent.click(screen.getByRole('button', { name: /round history/i }));
  return within(screen.getByTestId('round-history'));
}

describe('RoundHistory', () => {
  it('renders nothing before a hand has been completed', () => {
    const { container } = render(<RoundHistory results={[]} seats={seats} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays collapsed until it is asked for', async () => {
    render(<RoundHistory results={teamResults} seats={seats} />);
    expect(screen.queryByTestId('round-history')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /round history \(2\)/i }));
    expect(screen.getByTestId('round-history')).toBeInTheDocument();
  });

  it('lists the hands newest first with the server\'s team totals', async () => {
    render(<RoundHistory results={teamResults} seats={seats} />);
    const table = await open();

    expect(table.getAllByRole('columnheader').map(h => h.textContent))
      .toEqual(['Hand', 'Team 1', 'Team 2']);
    const rows = table.getAllByRole('row');
    // Row 0 is the header.
    expect(rows[1]).toHaveTextContent('2');
    expect(rows[1]).toHaveTextContent('+100 (0)');
    expect(rows[1]).toHaveTextContent('-300 (-400)');
    expect(rows[2]).toHaveTextContent('-100 (-100)');
  });

  it('sums running totals itself when the room scores individuals', async () => {
    render(
      <RoundHistory
        results={[individualResult({ p0: -50, p1: -150 }), individualResult({ p0: -30, p1: 20 })]}
        seats={seats}
      />
    );
    const table = await open();

    expect(table.getAllByRole('columnheader').map(h => h.textContent))
      .toEqual(['Hand', 'Ann', 'Bob']);
    const rows = table.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('-30 (-80)');
    expect(rows[1]).toHaveTextContent('+20 (-130)');
    expect(rows[2]).toHaveTextContent('-50 (-50)');
  });
});
