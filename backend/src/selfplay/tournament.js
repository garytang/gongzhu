'use strict';

const { runBatchRange, SEATS, TEAMS } = require('./runner');

const Z95 = 1.959964; // two-sided 95% normal quantile

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function lcm(a, b) { return (a * b) / gcd(a, b); }

/** Every policy at one table, rotated through every seat an equal number of times. */
function rotationSeatings(policyNames) {
  const k = policyNames.length;
  return Array.from({ length: lcm(k, 4) }, (_, r) => (
    SEATS.map((_seat, i) => policyNames[(i + r) % k])
  ));
}

/** Round robin over pairs: each pair holds one side of the table, in both seatings. */
function pairwiseSeatings(policyNames) {
  const seatings = [];
  for (let i = 0; i < policyNames.length; i++) {
    for (let j = i + 1; j < policyNames.length; j++) {
      const [a, b] = [policyNames[i], policyNames[j]];
      seatings.push([a, b, a, b], [b, a, b, a]);
    }
  }
  return seatings;
}

/**
 * The seat assignments a tournament plays.
 *
 * Seat matters in Gongzhu — the deal is fixed by the seed, and who leads and who plays
 * last to a trick is positional — so every arrangement is played in every rotation.
 * That way no policy is credited for a seat rather than for its play.
 */
function seatingsFor(policyNames, mode) {
  if (policyNames.length < 2) throw new Error('A tournament needs at least two policies');
  if (mode === 'teams') return pairwiseSeatings(policyNames);
  if (policyNames.length > 4) {
    // More policies than seats: they cannot all sit at one table, so pair them off.
    return pairwiseSeatings(policyNames);
  }
  return rotationSeatings(policyNames);
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

/** Which side of the match a seat belongs to: its team in partnerships, itself otherwise. */
function sideOf(player, teams) {
  if (!teams) return player;
  return Object.keys(teams).find(name => teams[name].includes(player));
}

/**
 * Play every seating `matches` times and report how each policy did.
 *
 * Reproducible from `seed`: seeds are derived from the seating index and the match
 * index, so the same arguments always replay the same games.
 */
async function runTournament({
  policyNames,
  matches = 20,
  seed = 'tourney',
  options = {},
  mode = 'individual',
} = {}) {
  const seatings = seatingsFor(policyNames, mode);
  const matchOptions = mode === 'teams' ? { ...options, teams: TEAMS } : options;
  const stats = new Map(policyNames.map(name => [name, { handScores: [], wins: 0, matches: 0 }]));

  for (let s = 0; s < seatings.length; s++) {
    const seats = seatings[s];
    // eslint-disable-next-line no-await-in-loop -- seatings run one at a time
    await runBatchRange({
      from: 0,
      to: matches,
      seedPrefix: `${seed}-${s}`,
      policyNames: seats,
      options: matchOptions,
      onMatch: summary => recordMatch(stats, seats, summary, matchOptions.teams),
    });
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

  return {
    mode,
    seed,
    seatings: seatings.length,
    matchesPlayed: seatings.length * matches,
    rows,
  };
}

/**
 * Credit one match to the policies that played it. A policy can hold more than one
 * seat: score every hand it played, but count the match once — won if any of its seats
 * won — so win rate stays a per-match probability.
 */
function recordMatch(stats, seats, summary, teams) {
  const winners = new Set(summary.outcome ? summary.outcome.winners : []);
  const wonThisMatch = new Map();

  seats.forEach((name, seatIndex) => {
    const player = SEATS[seatIndex];
    const entry = stats.get(name);
    for (const hand of summary.results) entry.handScores.push(hand.individual[player]);
    wonThisMatch.set(name, wonThisMatch.get(name) || winners.has(sideOf(player, teams)));
  });

  for (const [name, won] of wonThisMatch) {
    const entry = stats.get(name);
    entry.matches += 1;
    if (won) entry.wins += 1;
  }
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

module.exports = { runTournament, seatingsFor, formatTable, summarise, proportion };
