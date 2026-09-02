'use strict';

const { expect } = require('chai');
const { createLLMPolicy } = require('../../src/bots/llm-policy');
const {
  openRouterRequestBody, DEFAULT_TIMEOUT_MS, DEFAULT_REASONING_EFFORT,
} = require('../../src/bots/providers');
const engine = require('../../src/engine');

/** Run `fn` with the given environment overrides, restoring the originals afterwards. */
async function withEnv(overrides, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

/** A real mid-hand position with two legal cards, so the LLM is actually consulted. */
function position() {
  const match = engine.startHand(engine.createMatch({ playerIds: ['a', 'b', 'c', 'd'], seed: 'latency' }));
  const obs = engine.observation(match, match.hand.leader);
  return { ...obs, legalMoves: obs.hand.slice(0, 2) };
}

const stalled = { async generateResponse() { return new Promise(() => {}); } };
const answering = (card, delayMs = 0) => ({
  async generateResponse() {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return `<card>${card}</card>`;
  },
});

describe('LLM bots: move deadline', () => {
  it('ships an eight-second default owned by the provider layer', () => {
    expect(DEFAULT_TIMEOUT_MS).to.equal(8000);
  });

  it('gives up on a stalled model after LLM_TIMEOUT_MS and plays a heuristic card', async () => {
    await withEnv({ LLM_TIMEOUT_MS: '40' }, async () => {
      const obs = position();
      const started = Date.now();
      const card = await createLLMPolicy({ provider: stalled }).choose(obs);
      expect(obs.legalMoves).to.include(card);
      expect(Date.now() - started).to.be.below(1000);
    });
  });

  it('lets an explicit timeoutMs win over the environment', async () => {
    await withEnv({ LLM_TIMEOUT_MS: '600000' }, async () => {
      const obs = position();
      const started = Date.now();
      const card = await createLLMPolicy({ provider: stalled, timeoutMs: 40 }).choose(obs);
      expect(obs.legalMoves).to.include(card);
      expect(Date.now() - started).to.be.below(1000);
    });
  });

  it('keeps a usable deadline when LLM_TIMEOUT_MS is malformed', async () => {
    // A NaN deadline would fire immediately; the model's answer must still get through.
    await withEnv({ LLM_TIMEOUT_MS: 'soon' }, async () => {
      const obs = position();
      const expected = obs.legalMoves[1];
      const card = await createLLMPolicy({ provider: answering(expected, 30) }).choose(obs);
      expect(card).to.equal(expected);
    });
  });
});

describe('LLM bots: reasoning effort', () => {
  it('defaults to low and reaches the provider on every call', async () => {
    await withEnv({ LLM_REASONING_EFFORT: undefined }, async () => {
      let seen;
      const provider = {
        async generateResponse(prompt, options) { seen = options; return '<card>x</card>'; },
      };
      await createLLMPolicy({ provider }).choose(position());
      expect(seen.reasoningEffort).to.equal(DEFAULT_REASONING_EFFORT);
      expect(DEFAULT_REASONING_EFFORT).to.equal('low');
      expect(seen.timeout).to.equal(DEFAULT_TIMEOUT_MS);
    });
  });

  it('reads LLM_REASONING_EFFORT from the environment', async () => {
    await withEnv({ LLM_REASONING_EFFORT: 'none' }, async () => {
      let seen;
      const provider = {
        async generateResponse(prompt, options) { seen = options; return '<card>x</card>'; },
      };
      await createLLMPolicy({ provider }).choose(position());
      expect(seen.reasoningEffort).to.equal('none');
    });
  });

  it('is sent to OpenRouter as its unified reasoning field', () => {
    const body = openRouterRequestBody('google/gemini-3.7-flash', 'prompt', { reasoningEffort: 'high' });
    expect(body.reasoning).to.deep.equal({ effort: 'high' });
    expect(body.model).to.equal('google/gemini-3.7-flash');
    expect(body.messages).to.deep.equal([{ role: 'user', content: 'prompt' }]);
    expect(openRouterRequestBody('m', 'p').reasoning.effort).to.equal('low');
  });
});
