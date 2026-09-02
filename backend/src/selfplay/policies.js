'use strict';

const { createRng } = require('../engine/rng');
const {
  PIG, SHEEP, TRANSFORMER, isPointCard, isHeart, suitOf, rankValue,
} = require('../engine/cards');
const { cardCounterPolicy } = require('./card-counter');

/**
 * A policy is `(observation, ctx) => card`, choosing from `observation.legalMoves`.
 * Policies see only what the player legitimately sees, so anything trained on the
 * resulting logs is learning from a fair information set.
 */

const randomPolicy = (name = 'random') => {
  const rng = createRng(name);
  return {
    name,
    choose(obs) {
      return obs.legalMoves[Math.floor(rng() * obs.legalMoves.length)];
    },
  };
};

const lowestPolicy = {
  name: 'lowest',
  choose(obs) {
    return obs.legalMoves.slice().sort((a, b) => rankValue(a) - rankValue(b))[0];
  },
};

/**
 * A reasonable heuristic baseline: duck point cards, dump the pig when void,
 * and try to win the trick when the sheep is on the table.
 */
const avoidPointsPolicy = {
  name: 'avoidPoints',
  choose(obs) {
    const moves = obs.legalMoves;
    if (moves.length === 1) return moves[0];

    const leading = obs.trick.length === 0;
    const ledSuit = leading ? null : suitOf(obs.trick[0].card);
    const following = !leading && moves.some(c => suitOf(c) === ledSuit);

    if (leading) {
      // Lead a low card in a suit where we do not hold the dangerous cards.
      const safe = moves.filter(c => !isPointCard(c) && c !== PIG);
      const pool = safe.length > 0 ? safe : moves;
      return pool.slice().sort((a, b) => rankValue(a) - rankValue(b))[0];
    }

    if (!following) {
      // Void in the led suit: this is the moment to shed liabilities.
      const pig = moves.find(c => c === PIG);
      if (pig) return pig;
      const highHearts = moves.filter(isHeart).sort((a, b) => rankValue(b) - rankValue(a));
      if (highHearts.length > 0) return highHearts[0];
      return moves.slice().sort((a, b) => rankValue(b) - rankValue(a))[0];
    }

    const highestSoFar = obs.trick
      .filter(t => suitOf(t.card) === ledSuit)
      .reduce((best, t) => (rankValue(t.card) > rankValue(best.card) ? t : best), obs.trick[0]);
    const trickHasSheep = obs.trick.some(t => t.card === SHEEP);
    const trickHasPenalty = obs.trick.some(t => t.card === PIG || isHeart(t.card));
    const isLastToPlay = obs.trick.length === 3;

    const winning = moves.filter(c => rankValue(c) > rankValue(highestSoFar.card));
    const ducking = moves.filter(c => rankValue(c) < rankValue(highestSoFar.card));

    // Worth taking: the sheep is here, or nothing painful is, and we can grab the transformer.
    if ((trickHasSheep || (!trickHasPenalty && isLastToPlay)) && winning.length > 0) {
      const transformer = winning.find(c => c === TRANSFORMER);
      if (transformer && trickHasSheep) return transformer;
      return winning.sort((a, b) => rankValue(a) - rankValue(b))[0];
    }

    if (ducking.length > 0) {
      return ducking.sort((a, b) => rankValue(b) - rankValue(a))[0];
    }
    return moves.slice().sort((a, b) => rankValue(a) - rankValue(b))[0];
  },
};

const POLICIES = {
  random: randomPolicy,
  lowest: () => lowestPolicy,
  avoidPoints: () => avoidPointsPolicy,
  cardCounter: name => cardCounterPolicy(name),
};

/**
 * Register a policy from outside this file, so a policy that lives elsewhere in the
 * codebase (an LLM bot, a trained model) becomes usable by name from the CLI, the
 * batch runner and the tournament without editing the harness.
 *
 * `factory(name)` must return `{ name, choose(observation, ctx) }`. `choose` may return
 * a card or a promise of one, and must pick from `observation.legalMoves`. A factory is
 * called once per seat per match, so it is the right place to allocate per-match state.
 */
function registerPolicy(name, factory) {
  if (typeof factory !== 'function') {
    throw new Error(`registerPolicy("${name}") needs a factory function`);
  }
  POLICIES[name] = factory;
  return factory;
}

function makePolicy(name, seedSuffix = '') {
  const factory = POLICIES[name];
  if (!factory) {
    throw new Error(`Unknown policy "${name}". Available: ${Object.keys(POLICIES).join(', ')}`);
  }
  return factory(`${name}${seedSuffix}`);
}

module.exports = {
  POLICIES,
  registerPolicy,
  makePolicy,
  randomPolicy,
  lowestPolicy,
  avoidPointsPolicy,
  cardCounterPolicy,
};
