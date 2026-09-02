import type { GameState } from '../PlayerContext';

export type TeamScores = { team1: number; team2: number };

/**
 * Player ids of team 1 and team 2. The backend sends explicit team assignments;
 * the seat-parity fallback (seats 0 & 2 against 1 & 3) covers states sent before
 * that field existed.
 */
export function teamMembers(state: GameState | null): [string[], string[]] {
  if (state?.teams) return [state.teams.team1, state.teams.team2];
  const seats = state?.playerHandles || [];
  return [
    [seats[0]?.playerId, seats[2]?.playerId].filter(Boolean) as string[],
    [seats[1]?.playerId, seats[3]?.playerId].filter(Boolean) as string[],
  ];
}

export function teamOf(state: GameState | null, playerId: string | undefined): 0 | 1 | 2 {
  if (!playerId) return 0;
  const [team1, team2] = teamMembers(state);
  if (team1.includes(playerId)) return 1;
  if (team2.includes(playerId)) return 2;
  return 0;
}

/** Sums one team's share of a score map, which may be missing players. */
export function sumTeamScore(scores: Record<string, number>, memberIds: string[]): number {
  return memberIds.reduce((sum, id) => sum + (scores[id] || 0), 0);
}

/** Team totals for the current round, summed from the per-player scores. */
export function roundTeamScores(state: GameState): TeamScores {
  const [team1, team2] = teamMembers(state);
  return {
    team1: sumTeamScore(state.scores, team1),
    team2: sumTeamScore(state.scores, team2),
  };
}

/**
 * Scores shown on the scoreboard: the backend's cumulative match totals when it
 * sends them, otherwise this round's totals. A cumulative total of 0 is a real
 * score and must not fall through to the round totals.
 */
export function displayTeamScores(state: GameState): TeamScores {
  const round = roundTeamScores(state);
  return {
    team1: state.cumulativeTeamScores?.team1 ?? round.team1,
    team2: state.cumulativeTeamScores?.team2 ?? round.team2,
  };
}
