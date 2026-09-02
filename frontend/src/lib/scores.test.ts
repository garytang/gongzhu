import type { GameState } from '../PlayerContext';
import { displayTeamScores, roundTeamScores, teamOf } from './scores';

const seats = [
  { handle: 'Ann', playerId: 'p0' },
  { handle: 'Bob', playerId: 'p1' },
  { handle: 'Cat', playerId: 'p2' },
  { handle: 'Dan', playerId: 'p3' },
];

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    trick: [],
    turn: 0,
    playerHandles: seats,
    scores: { p0: -40, p1: 100, p2: -10, p3: 0 },
    teams: { team1: ['p0', 'p2'], team2: ['p1', 'p3'] },
    ...overrides,
  };
}

describe('roundTeamScores', () => {
  it('sums the per-player scores of each team', () => {
    expect(roundTeamScores(state())).toEqual({ team1: -50, team2: 100 });
  });

  it('falls back to seat parity when the server sends no teams', () => {
    expect(roundTeamScores(state({ teams: undefined }))).toEqual({ team1: -50, team2: 100 });
  });
});

describe('displayTeamScores', () => {
  it('prefers the cumulative match totals', () => {
    const scores = displayTeamScores(state({ cumulativeTeamScores: { team1: 220, team2: -80 } }));
    expect(scores).toEqual({ team1: 220, team2: -80 });
  });

  it('keeps a cumulative total of 0 instead of falling back to the round total', () => {
    const scores = displayTeamScores(state({ cumulativeTeamScores: { team1: 0, team2: 0 } }));
    expect(scores).toEqual({ team1: 0, team2: 0 });
  });

  it('uses the round totals when the server sends no cumulative scores', () => {
    expect(displayTeamScores(state())).toEqual({ team1: -50, team2: 100 });
  });
});

describe('teamOf', () => {
  it('reads the server team assignments', () => {
    expect(teamOf(state(), 'p2')).toBe(1);
    expect(teamOf(state(), 'p1')).toBe(2);
  });

  it('falls back to seat parity', () => {
    const fallback = state({ teams: undefined });
    expect(teamOf(fallback, 'p2')).toBe(1);
    expect(teamOf(fallback, 'p3')).toBe(2);
  });

  it('returns 0 for an unknown player', () => {
    expect(teamOf(state(), 'nobody')).toBe(0);
  });
});
