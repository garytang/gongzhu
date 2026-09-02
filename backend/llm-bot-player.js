const { createLLMPolicy } = require('./src/bots/llm-policy');
const { toObservation, namesFromGameState, legalMovesFor } = require('./src/bots/observation');

/**
 * A seat at the table played by an LLM.
 *
 * The class is the adapter between the Socket.IO server, which calls
 * `selectCard(hand, trick, gameState)`, and the observation-driven policy in
 * `src/bots/llm-policy.js`. It holds no rules of its own.
 */
class LLMBotPlayer {
  constructor(id, llmConfig = {}) {
    this.id = id;
    this.handle = llmConfig.handle || `AI ${id.slice(-4)}`;
    this.socketId = `llm_bot_${id}`;

    this.policy = createLLMPolicy({
      provider: llmConfig.provider,
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
      providerConfig: llmConfig.providerConfig,
      timeoutMs: llmConfig.timeoutMs,
      fallback: llmConfig.fallback,
      name: this.handle,
    });

    // Reported by /api/bots/list, so both name what is actually in use.
    this.llmProvider = this.policy.provider;
    this.llmModel = this.policy.model;
  }

  /**
   * Choose a card. Prefers `gameState.observation` (what the engine reports the player
   * may see) and otherwise derives an equivalent observation from the legacy game
   * object. Always resolves to a legal card.
   */
  async selectCard(hand, trick = [], gameState = {}) {
    const observation = toObservation(hand, trick, gameState);
    const card = await this.policy.choose(observation, { names: namesFromGameState(gameState) });
    return observation.legalMoves.includes(card) ? card : observation.legalMoves[0];
  }

  /** Cards this bot may legally play. Retained for callers that validate before playing. */
  getValidCards(hand, trick) {
    return legalMovesFor(hand, trick);
  }
}

module.exports = { LLMBotPlayer };
