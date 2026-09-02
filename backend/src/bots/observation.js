'use strict';

const { suitOf } = require('../engine/cards');
const { HAND_SIZE } = require('../engine/game');

/**
 * Cards playable from `hand` given the cards already in `trick`, under the follow-suit
 * rule. `engine.legalMoves` is authoritative wherever a match object exists; this
 * reconstruction exists only for the legacy server, whose `game` object carries no
 * legal-move list.
 */
function legalMovesFor(hand, trick = []) {
  const cards = Array.isArray(hand) ? hand.slice() : [];
  if (trick.length === 0) return cards;
  const ledSuit = suitOf(trick[0].card);
  const following = cards.filter(card => suitOf(card) === ledSuit);
  return following.length > 0 ? following : cards;
}

/**
 * Build an engine-shaped observation from the legacy `game` object that
 * `backend/index.js` hands to bots.
 *
 * Only fields a player may legitimately see are read. In particular `game.hands` holds
 * every player's cards and is never touched, so a bot driven through this adapter has
 * the same information as a human at the table.
 *
 * Temporary shim: the legacy game object has no hand number and no exposure state, so
 * those come back empty. Delete this function, and the `gameState.observation` branch of
 * `toObservation` with it, once the server passes `engine.observation(match, playerId)`.
 */
function observationFromLegacy(hand, trick = [], gameState = {}) {
  const cards = Array.isArray(hand) ? hand.slice() : [];
  const plays = trick.map(play => ({ ...play }));
  const playerIds = Array.isArray(gameState.playerOrder) ? gameState.playerOrder.slice() : [];
  const seat = Number.isInteger(gameState.turn) ? gameState.turn : 0;
  const playerId = playerIds[seat] !== undefined ? playerIds[seat] : 'you';

  // Everyone starts a trick holding the same number of cards, so anyone who has already
  // played to the current trick holds one fewer than the player about to act.
  const played = new Set(plays.map(play => play.player));
  const handCounts = Object.fromEntries(playerIds.map(id => [
    id,
    id === playerId ? cards.length : cards.length - (played.has(id) ? 1 : 0),
  ]));

  const teams = gameState.teams || null;
  const ownTeam = teams
    ? (teams.team1.includes(playerId) ? teams.team1 : teams.team2)
    : null;

  return {
    playerId,
    seat,
    handNumber: null,
    trickNumber: HAND_SIZE + 1 - cards.length,
    hand: cards,
    legalMoves: legalMovesFor(cards, plays),
    trick: plays,
    leader: plays.length > 0 ? plays[0].player : playerId,
    turn: playerId,
    exposed: [],
    collected: Object.fromEntries(playerIds.map(id => [
      id,
      (gameState.collected && gameState.collected[id]) ? gameState.collected[id].slice() : [],
    ])),
    handCounts,
    playerIds,
    totals: { ...(gameState.scores || {}) },
    teamTotals: gameState.cumulativeTeamScores ? { ...gameState.cumulativeTeamScores } : null,
    teammate: ownTeam ? ownTeam.find(id => id !== playerId) || null : null,
    variant: gameState.variant || 'standard',
  };
}

/**
 * Prefer the observation the caller supplies; fall back to reconstructing one from the
 * legacy fields.
 *
 * A supplied observation is taken as authoritative, including an empty `legalMoves` —
 * that is how the engine reports "not this player's turn", and turning it into a move
 * set would let a stale bot invocation play out of turn.
 */
function toObservation(hand, trick = [], gameState = {}) {
  if (!gameState.observation) return observationFromLegacy(hand, trick, gameState);

  const observation = { ...gameState.observation };
  if (!Array.isArray(observation.legalMoves)) {
    observation.legalMoves = legalMovesFor(observation.hand || hand, observation.trick || trick);
  }
  return observation;
}

/** playerId -> display handle, so prompts can name players the way the table does. */
function namesFromGameState(gameState = {}) {
  const names = {};
  for (const entry of gameState.playerHandles || []) {
    if (entry && entry.playerId) names[entry.playerId] = entry.handle || entry.playerId;
  }
  return names;
}

module.exports = { legalMovesFor, observationFromLegacy, toObservation, namesFromGameState };
