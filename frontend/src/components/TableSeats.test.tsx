import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Player } from '../PlayerContext';
import TableSeats from './TableSeats';

const seats: Player[] = [
  { handle: 'Ann', playerId: 'p0' },
  { handle: 'Bob', playerId: 'p1' },
  { handle: 'Cat', playerId: 'p2' },
  { handle: 'Dan', playerId: 'p3' },
];

// Teams as the server pairs them: seats 0 & 2 against 1 & 3.
const teamOf = (playerId: string): 0 | 1 | 2 => (['p0', 'p2'].includes(playerId) ? 1 : 2);

function renderTable(props: Partial<React.ComponentProps<typeof TableSeats>> = {}) {
  const onSelect = jest.fn();
  render(
    <TableSeats
      seats={seats}
      trick={[]}
      myPlayerId="p0"
      teamOf={teamOf}
      lastWinnerHandle={null}
      onSelect={onSelect}
      {...props}
    />
  );
  return { onSelect };
}

const seatText = (position: string) => screen.getByTestId(`seat-${position}`).textContent || '';

describe('TableSeats', () => {
  it('seats the viewer at the bottom and their teammate across the table', () => {
    renderTable({ myPlayerId: 'p0' });
    expect(seatText('bottom')).toContain('Ann');
    expect(seatText('left')).toContain('Bob');
    expect(seatText('top')).toContain('Cat');
    expect(seatText('right')).toContain('Dan');
  });

  it('rotates the table so every player sees themselves at the bottom', () => {
    renderTable({ myPlayerId: 'p1' });
    expect(seatText('bottom')).toContain('Bob');
    expect(seatText('left')).toContain('Cat');
    expect(seatText('top')).toContain('Dan');
    expect(seatText('right')).toContain('Ann');
  });

  it('seats a spectator behind the first chair', () => {
    renderTable({ myPlayerId: 'watcher' });
    expect(seatText('bottom')).toContain('Ann');
    expect(seatText('top')).toContain('Cat');
  });

  it('shows each seat the card it played into the trick', () => {
    renderTable({
      trick: [
        { player: 'p1', card: '5♥' },
        { player: 'p2', card: 'K♥' },
      ],
    });
    expect(seatText('left')).toContain('5♥');
    expect(seatText('top')).toContain('K♥');
    expect(seatText('right')).toContain('—');
  });

  it('marks the seat that led the trick', () => {
    renderTable({ leaderId: 'p3' });
    expect(seatText('right')).toContain('leads');
    expect(seatText('bottom')).not.toContain('leads');
  });

  it('marks a seat filled by a bot', () => {
    renderTable({ seats: [...seats.slice(0, 3), { ...seats[3], isBot: true }] });
    expect(within(screen.getByTestId('seat-right')).getByText('🤖')).toBeInTheDocument();
    expect(within(screen.getByTestId('seat-left')).queryByText('🤖')).not.toBeInTheDocument();
  });

  it('announces the winner of the trick just played', () => {
    renderTable({ lastWinnerHandle: 'Cat' });
    expect(screen.getByText('Cat won the trick')).toBeInTheDocument();
  });

  it('opens a seat\'s collected cards when it is clicked', async () => {
    const { onSelect } = renderTable();
    await userEvent.click(screen.getByTestId('seat-top'));
    expect(onSelect).toHaveBeenCalledWith('p2');
  });
});
