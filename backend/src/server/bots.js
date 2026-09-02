'use strict';

const { makePolicy, avoidPointsPolicy } = require('../selfplay/policies');
const { LLMBotPlayer } = require('../../llm-bot-player');

/**
 * Bots seated at the table.
 *
 * Every bot exposes the same `chooseCard(observation)` and is guaranteed to return a
 * card from `observation.legalMoves`: a bot that throws, stalls or names an illegal card
 * falls through to the heuristic policy rather than wedging the table.
 */

/** Difficulty picks one of the self-play policies, not a separate set of rules. */
function heuristicChooser(difficulty, seedSuffix) {
  const policy = makePolicy(difficulty === 'easy' ? 'random' : 'avoidPoints', seedSuffix);
  return observation => policy.choose(observation);
}

function createBotRegistry(log = console) {
  const seated = new Map(); // socketId -> entry
  let counter = 0;

  function register(entry, pick) {
    entry.chooseCard = async (observation) => {
      // A forced move needs no deliberation, and for LLM bots it would waste a call.
      if (observation.legalMoves.length === 1) return observation.legalMoves[0];
      try {
        const card = await pick(observation);
        if (observation.legalMoves.includes(card)) return card;
        log.warn(`Bot ${entry.handle} chose illegal card ${card}; using fallback`);
      } catch (error) {
        log.error(`Bot ${entry.handle} failed to choose a card:`, error.message);
      }
      return avoidPointsPolicy.choose(observation);
    };
    seated.set(entry.socketId, entry);
    return entry;
  }

  return {
    /** A rule-based bot. `difficulty` only selects which policy plays the cards. */
    createBot(difficulty = 'easy') {
      const id = `bot_${Date.now()}_${counter++}`;
      const entry = { socketId: id, handle: `Bot ${id.slice(-4)}`, kind: 'regular', difficulty };
      log.log(`Created bot: ${entry.handle} (${id}) - ${difficulty} difficulty`);
      return register(entry, heuristicChooser(difficulty, id));
    },

    /**
     * A bot backed by an LLM. `LLMBotPlayer.selectCard` still takes the legacy
     * `(hand, trick, gameState)` arguments, so `describeTable(observation)` supplies that
     * gameState; nothing outside this bot needs to know the shape.
     */
    createLLMBot(llmConfig = {}, describeTable = () => ({})) {
      // LLMBotPlayer prefixes its own socket id, so the raw id goes in.
      const player = new LLMBotPlayer(`${Date.now()}_${counter++}`, llmConfig);
      const entry = {
        socketId: player.socketId,
        handle: player.handle,
        kind: 'llm',
        provider: player.llmProvider,
        model: player.llmModel,
        player,
      };
      log.log(`Created LLM bot: ${entry.handle} (${entry.socketId}) - ${entry.provider} provider`);
      return register(entry, observation =>
        player.selectCard(observation.hand, observation.trick, describeTable(observation)));
    },

    /** Register an already-built chooser. Used by tests to stand in for a provider. */
    registerCustom(socketId, handle, pick) {
      return register({ socketId, handle, kind: 'custom' }, pick);
    },

    has: socketId => seated.has(socketId),
    get: socketId => seated.get(socketId),
    ids: () => [...seated.keys()],
    removeAll() {
      const removed = [...seated.keys()];
      seated.clear();
      return removed;
    },
  };
}

module.exports = { createBotRegistry };
