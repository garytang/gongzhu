'use strict';

const {
  createMatch, startHand, legalMoves, playCard, observation,
} = require('../engine/game');
const { makePolicy } = require('./policies');
const { SCHEMA_VERSION } = require('./meta');

const SEATS = ['p0', 'p1', 'p2', 'p3'];

const DEFAULT_POLICIES = ['avoidPoints', 'avoidPoints', 'avoidPoints', 'avoidPoints'];

/**
 * Play one hand, emitting a training record at every decision point.
 *
 * Records are buffered until the hand settles so each one can be stamped with the
 * realised reward — the score the acting player actually ended the hand with. That
 * makes the log directly usable for supervised or offline-RL training without a
 * second pass to join decisions to outcomes.
 */
async function playHand(match, policies, { matchId, datasetId, onRecord } = {}) {
  const pending = [];

  while (match.phase === 'playing') {
    const player = match.hand.turn;
    const obs = observation(match, player);
    const policy = policies[player];

    // A policy may be synchronous (the heuristics) or return a promise (an LLM, or a
    // model served over the network). Awaiting only a real thenable keeps a batch of
    // synchronous policies running in one uninterrupted pass.
    const chosen = policy.choose(obs, { match });
    const action = typeof chosen?.then === 'function' ? await chosen : chosen;

    const legal = legalMoves(match, player);
    if (!legal.includes(action)) {
      throw new Error(`Policy "${policy.name}" chose illegal card ${action} for ${player}`);
    }

    pending.push({
      schemaVersion: SCHEMA_VERSION,
      datasetId: datasetId || null,
      matchId,
      seed: String(match.seed),
      handNumber: match.handNumber,
      trickNumber: obs.trickNumber,
      player,
      seat: obs.seat,
      policy: policy.name,
      observation: {
        hand: obs.hand,
        trick: obs.trick,
        leader: obs.leader,
        exposed: obs.exposed,
        collected: obs.collected,
        handCounts: obs.handCounts,
        totals: obs.totals,
        teamTotals: obs.teamTotals,
        teammate: obs.teammate,
        variant: obs.variant,
      },
      legalMoves: legal,
      action,
    });

    match = playCard(match, player, action).match;
  }

  const result = match.results[match.results.length - 1];
  for (const record of pending) {
    record.reward = result.individual[record.player];
    record.handScores = result.individual;
    record.handTeamScores = result.teamScores;
    if (onRecord) onRecord(record);
  }

  return { match, result, records: pending };
}

/**
 * Play a full match to its target score. Deterministic given `seed`, for any policy
 * that is itself deterministic.
 */
async function runMatch({
  seed = 'match',
  matchId = `m-${seed}`,
  policyNames = DEFAULT_POLICIES,
  options = {},
  maxHands = 200,
  datasetId,
  onRecord,
} = {}) {
  const playerIds = SEATS.slice();
  const policies = Object.fromEntries(
    playerIds.map((id, i) => [id, makePolicy(policyNames[i], `-${seed}-${i}`)]),
  );

  let match = createMatch({ playerIds, seed, options });
  const hands = [];

  while (match.phase !== 'matchComplete' && match.handNumber < maxHands) {
    match = startHand(match);
    const played = await playHand(match, policies, { matchId, datasetId, onRecord });
    match = played.match;
    hands.push(played.result);
  }

  return {
    matchId,
    seed,
    policyNames,
    hands: hands.length,
    totals: match.totals,
    teamTotals: match.teamTotals,
    outcome: match.outcome || null,
    results: hands,
  };
}

/** The seed for match `index` of a batch. Fixed here so every runner agrees on it. */
function seedFor(seedPrefix, index) {
  return `${seedPrefix}-${index}`;
}

const emptyStats = () => ({ games: 0, handsPlayed: 0, decisions: 0, wins: {}, scoreTotals: {} });

/** Fold one match summary into a running aggregate. */
function accumulate(stats, summary) {
  stats.games += 1;
  stats.handsPlayed += summary.hands;
  for (const [name, total] of Object.entries(summary.totals)) {
    stats.scoreTotals[name] = (stats.scoreTotals[name] || 0) + total;
  }
  if (summary.outcome) {
    for (const winner of summary.outcome.winners) {
      stats.wins[winner] = (stats.wins[winner] || 0) + 1;
    }
  }
  return stats;
}

/** Combine aggregates from several workers. Addition only, so worker count cannot change it. */
function mergeStats(parts) {
  const merged = emptyStats();
  for (const part of parts) {
    merged.games += part.games;
    merged.handsPlayed += part.handsPlayed;
    merged.decisions += part.decisions;
    for (const [name, n] of Object.entries(part.wins)) merged.wins[name] = (merged.wins[name] || 0) + n;
    for (const [name, n] of Object.entries(part.scoreTotals)) {
      merged.scoreTotals[name] = (merged.scoreTotals[name] || 0) + n;
    }
  }
  return merged;
}

/**
 * Run matches `[from, to)` of a batch. Returns aggregate stats; per-decision records go
 * to `onRecord`. Splitting a batch by index is what lets workers divide the work and
 * still produce exactly the output a single process would.
 */
async function runBatchRange({
  from = 0,
  to = 100,
  seedPrefix = 'batch',
  policyNames,
  options = {},
  datasetId,
  onRecord,
  onMatch,
} = {}) {
  const stats = emptyStats();

  for (let i = from; i < to; i++) {
    const seed = seedFor(seedPrefix, i);
    // eslint-disable-next-line no-await-in-loop -- matches are sequential by design
    const summary = await runMatch({
      seed,
      matchId: seed,
      policyNames,
      options,
      datasetId,
      onRecord: (record) => { stats.decisions++; if (onRecord) onRecord(record); },
    });
    accumulate(stats, summary);
    if (onMatch) onMatch(summary);
  }

  return stats;
}

/** Run `games` matches, seeded `${seedPrefix}-0` .. `${seedPrefix}-${games-1}`. */
function runBatch({ games = 100, ...rest } = {}) {
  return runBatchRange({ from: 0, to: games, ...rest });
}

module.exports = {
  runMatch, runBatch, runBatchRange, playHand, mergeStats, seedFor, SEATS, DEFAULT_POLICIES,
};
