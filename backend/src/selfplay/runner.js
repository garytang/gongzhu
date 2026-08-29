'use strict';

const {
  createMatch, startHand, legalMoves, playCard, observation,
} = require('../engine/game');
const { makePolicy } = require('./policies');

const SEATS = ['p0', 'p1', 'p2', 'p3'];

/**
 * Play one hand, emitting a training record at every decision point.
 *
 * Records are buffered until the hand settles so each one can be stamped with the
 * realised reward — the score the acting player actually ended the hand with. That
 * makes the log directly usable for supervised or offline-RL training without a
 * second pass to join decisions to outcomes.
 */
function playHand(match, policies, { matchId, onRecord } = {}) {
  const pending = [];

  while (match.phase === 'playing') {
    const player = match.hand.turn;
    const obs = observation(match, player);
    const policy = policies[player];
    const action = policy.choose(obs, { match });

    const legal = legalMoves(match, player);
    if (!legal.includes(action)) {
      throw new Error(`Policy "${policy.name}" chose illegal card ${action} for ${player}`);
    }

    pending.push({
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
 * Play a full match to its target score. Deterministic given `seed`.
 */
function runMatch({
  seed = 'match',
  matchId = `m-${seed}`,
  policyNames = ['avoidPoints', 'avoidPoints', 'avoidPoints', 'avoidPoints'],
  options = {},
  maxHands = 200,
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
    const played = playHand(match, policies, { matchId, onRecord });
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

/**
 * Run many matches. Returns aggregate stats; per-decision records go to `onRecord`.
 */
function runBatch({
  games = 100,
  seedPrefix = 'batch',
  policyNames,
  options = {},
  onRecord,
  onMatch,
} = {}) {
  const wins = {};
  const scoreTotals = {};
  let decisions = 0;
  let handsPlayed = 0;

  for (let i = 0; i < games; i++) {
    const summary = runMatch({
      seed: `${seedPrefix}-${i}`,
      matchId: `${seedPrefix}-${i}`,
      policyNames,
      options,
      onRecord: onRecord && ((record) => { decisions++; onRecord(record); }),
    });
    handsPlayed += summary.hands;

    for (const [name, total] of Object.entries(summary.totals)) {
      scoreTotals[name] = (scoreTotals[name] || 0) + total;
    }
    if (summary.outcome) {
      for (const winner of summary.outcome.winners) {
        wins[winner] = (wins[winner] || 0) + 1;
      }
    }
    if (onMatch) onMatch(summary);
  }

  return { games, handsPlayed, decisions, wins, scoreTotals };
}

module.exports = { runMatch, runBatch, playHand, SEATS };
