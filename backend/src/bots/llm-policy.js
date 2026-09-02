'use strict';

const { rankOf, suitOf } = require('../engine/cards');
const { avoidPointsPolicy } = require('../selfplay/policies');
const { createLLMProvider } = require('./providers');
const { buildPrompt } = require('./prompt');

/**
 * A move has to come back fast enough that a live table does not visibly stall. The
 * server has its own fallback, but the bot gives up on its own first.
 */
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_TOKENS = 300;

function debug(...args) {
  if (process.env.LLM_BOT_DEBUG) console.log(...args);
}

/** Reject a pending promise once `ms` has elapsed, so a hung provider cannot block a turn. */
function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`LLM call exceeded ${ms}ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** Content of the first `<tag>…</tag>` pair, or null. */
function extractTag(text, tagName) {
  const match = String(text).match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'));
  return match ? match[1].trim() : null;
}

/**
 * Find which of `legalMoves` a chunk of model output names. A card written out in full
 * wins; failing that, a rank and a suit mentioned anywhere in the text are matched to a
 * legal card.
 */
function findLegalCard(text, legalMoves) {
  if (!text) return null;
  const cleaned = String(text).replace(/[^\w♠♥♣♦]/g, '');
  return legalMoves.find(card => cleaned.includes(card))
    || legalMoves.find(card => cleaned.includes(rankOf(card)) && cleaned.includes(suitOf(card)))
    || null;
}

/** Pull a legal card out of a model response, preferring the `<played_card>` tag. */
function parseCard(response, legalMoves) {
  debug('LLM reasoning:', extractTag(response, 'reasoning'));
  return findLegalCard(extractTag(response, 'played_card'), legalMoves)
    || findLegalCard(response, legalMoves);
}

/**
 * Build a self-play `Policy` backed by an LLM: `{ name, choose(observation, ctx) }`.
 *
 * `choose` is async and always resolves to a member of `observation.legalMoves`. Any
 * failure — no API key, a timeout, a malformed answer, an illegal card — falls back to
 * the `fallback` policy rather than stalling or playing illegally.
 *
 * `provider` may be a provider name or an object with a `generateResponse(prompt, opts)`
 * method, which is how tests run without a network or an API key.
 */
function createLLMPolicy(config = {}) {
  const {
    provider = 'anthropic',
    model,
    apiKey,
    providerConfig = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxTokens = DEFAULT_MAX_TOKENS,
    fallback = avoidPointsPolicy,
    name,
  } = config;

  let llm = null;
  try {
    llm = createLLMProvider(provider, { apiKey, model, ...providerConfig });
  } catch (error) {
    console.warn(`LLM policy disabled: ${error.message}`);
  }

  // Reported even when the policy ends up disabled, so bot listings still say which
  // model the seat is configured for.
  const resolvedModel = (llm && llm.model) || model || null;

  // Whether a key exists is knowable once, here. Without this the policy would build and
  // discard a full prompt on every move of every hand before failing the same way.
  if (llm && 'apiKey' in llm && !llm.apiKey) {
    console.warn(`LLM policy disabled: no API key for the ${provider} provider`);
    llm = null;
  }

  const providerName = typeof provider === 'string' ? provider : 'injected';

  return {
    name: name || `llm:${providerName}${model ? `:${model}` : ''}`,
    provider: providerName,
    model: resolvedModel,

    async choose(observation, ctx = {}) {
      const legalMoves = observation.legalMoves;
      if (!Array.isArray(legalMoves) || legalMoves.length === 0) {
        throw new Error(`No legal moves for ${observation.playerId}; not this seat's turn`);
      }
      if (legalMoves.length === 1) return legalMoves[0];

      if (llm) {
        try {
          const prompt = buildPrompt(observation, ctx.names || {});
          const response = await withDeadline(
            llm.generateResponse(prompt, { maxTokens, timeout: timeoutMs }),
            timeoutMs,
          );
          debug('LLM raw response:', response);
          const card = parseCard(response, legalMoves);
          if (card) return card;
          console.warn('LLM named no legal card; falling back to heuristics');
        } catch (error) {
          console.warn(`LLM move failed (${error.message}); falling back to heuristics`);
        }
      }

      return fallback.choose(observation, ctx);
    },
  };
}

module.exports = { createLLMPolicy, parseCard, extractTag };
