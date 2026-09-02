'use strict';

const { runMatch, SEATS } = require('./runner');

const TEAMS = { team1: [SEATS[0], SEATS[2]], team2: [SEATS[1], SEATS[3]] };
const Z95 = 1.959964; // two-sided 95% normal quantile

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function lcm(a, b) { return (a * b) / gcd(a, b); }

/**
 * The seat assignments a tournament plays.
 *
 * Seat matters in Gongzhu — the deal is fixed by the seed, and who leads and who plays
 * last to a trick is positional — so every arrangement is played in every rotation.
 * That way no policy is credited for a seat rather than for its play.
 *
 *   individual, 2..4 policies: all of them at one table, rotated through every seat.
 *   teams, or more than 4 policies: round robin over pairs, each pair in both seatings.
 */
function seatingsFor(policyNames, mode) {
  const k = policyNames.length;
  if (k < 2) throw new Error('A tournament needs at least two policies');

  if (mode === 'individual' && k <= 4) {
    const rotations = lcm(k, 4);
    return Array.from({ length: rotations }, (_, r) => ({
      seats: SEATS.map((_seat, i) => policyNames[(i + r) % k]),
    }));
  }

  const seatings = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      seatings.push({ seats: [policyNames[i], policyNames[j], policyNames[i], policyNames[j]] });
      seatings.push({ seats: [policyNames[j], policyNames[i], policyNames[j], policyNames[i]] });
    }
  }
  return seatings;
}

function summarise(samples) {
  const n = samples.length;
  if (n === 0) return { n: 0, mean: 0, ci: 0 };
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, ci: 0 };
  const variance = samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1);
  return { n, mean, ci: Z95 * Math.sqrt(variance / n) };
}

function proportion(successes, n) {
  if (n === 0) return { rate: 0, ci: 0, n: 0 };
  const rate = successes / n;
  return { rate, ci: Z95 * Math.sqrt((rate * (1 - rate)) / n), n };
}

/**
 * Play every seating `matches` times and report how each policy did.
 *
 * Reproducible from `seed`: match seeds are derived from the seating index and the
 * match index, so the same arguments always replay the same games.
 */
async function runTournament({
  policyNames,
  matches = 20,
  seed = 'tourney',
  options = {},
  mode = 'individual',
  onMatch,
} = {}) {
  const seatings = seatingsFor(policyNames, mode);
  const matchOptions = mode === 'teams' ? { ...options, teams: TEAMS } : { ...options };

  const stats = new Map(policyNames.map(name => [name, { handScores: [], wins: 0, matches: 0 }]));
  let played = 0;

  for (let s = 0; s < seatings.length; s++) {
    const { seats } = seatings[s];
    for (let m = 0; m < matches; m++) {
      const matchSeed = `${seed}-${s}-${m}`;
      // eslint-disable-next-line no-await-in-loop -- matches run one at a time
      const summary = await runMatch({
        seed: matchSeed,
        matchId: matchSeed,
        policyNames: seats,
        options: matchOptions,
      });
      played += 1;

      // A policy can hold more than one seat: score every hand it played, but count the
      // match itself once — won if any seat it held won — so win rate stays a
      // per-match probability.
      const winners = new Set(summary.outcome ? summary.outcome.winners : []);
      const wonThisMatch = new Map();
      seats.forEach((name, seatIndex) => {
        const player = SEATS[seatIndex];
        const entry = stats.get(name);
        for (const hand of summary.results) entry.handScores.push(hand.individual[player]);
        const side = mode === 'teams'
          ? (TEAMS.team1.includes(player) ? 'team1' : 'team2')
          : player;
        wonThisMatch.set(name, wonThisMatch.get(name) || winners.has(side));
      });
      for (const [name, won] of wonThisMatch) {
        const entry = stats.get(name);
        entry.matches += 1;
        if (won) entry.wins += 1;
      }

      if (onMatch) onMatch(summary);
    }
  }

  const rows = policyNames.map((name) => {
    const entry = stats.get(name);
    const score = summarise(entry.handScores);
    const win = proportion(entry.wins, entry.matches);
    return {
      policy: name,
      matches: entry.matches,
      hands: score.n,
      winRate: win.rate,
      winRateCi: win.ci,
      meanHandScore: score.mean,
      meanHandScoreCi: score.ci,
    };
  }).sort((a, b) => b.meanHandScore - a.meanHandScore);

  return { mode, seed, seatings: seatings.length, matchesPerSeating: matches, matchesPlayed: played, rows };
}

function formatTable(result) {
  const header = ['policy', 'matches', 'hands', 'win rate (95% CI)', 'mean hand score (95% CI)'];
  const body = result.rows.map(r => [
    r.policy,
    String(r.matches),
    String(r.hands),
    `${(r.winRate * 100).toFixed(1)}% ± ${(r.winRateCi * 100).toFixed(1)}`,
    `${r.meanHandScore.toFixed(1)} ± ${r.meanHandScoreCi.toFixed(1)}`,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map(row => row[i].length)));
  const line = cells => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');

  return [
    `mode: ${result.mode}   seatings: ${result.seatings}   matches: ${result.matchesPlayed}   seed: ${result.seed}`,
    '',
    line(header),
    widths.map(w => '-'.repeat(w)).join('  '),
    ...body.map(line),
    '',
  ].join('\n');
}

module.exports = { runTournament, seatingsFor, formatTable, summarise, proportion, TEAMS };
