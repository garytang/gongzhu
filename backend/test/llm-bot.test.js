'use strict';

const { expect } = require('chai');
const { LLMBotPlayer } = require('../llm-bot-player');
const { createLLMPolicy, parseCard, extractTag } = require('../src/bots/llm-policy');
const { buildPrompt, MAX_PROMPT_CHARS } = require('../src/bots/prompt');
const {
  legalMovesFor,
  observationFromLegacy,
  toObservation,
  namesFromGameState,
} = require('../src/bots/observation');
const { createLLMProvider, DEFAULT_MODELS } = require('../src/bots/providers');

/**
 * A provider stub. Every test drives the bot through one of these, so the suite never
 * touches the network and never needs an API key.
 */
function stubProvider(behaviour) {
  const calls = [];
  return {
    calls,
    model: 'stub-model',
    async generateResponse(prompt) {
      calls.push(prompt);
      if (typeof behaviour === 'function') return behaviour(prompt);
      return behaviour;
    },
  };
}

const HAND = ['A♠', '5♥', '7♣', 'J♦', 'Q♠'];

function legacyGameState(overrides = {}) {
  return {
    playerOrder: ['p1', 'p2', 'p3', 'p4'],
    playerHandles: [
      { playerId: 'p1', handle: 'Alice' },
      { playerId: 'p2', handle: 'Bob' },
      { playerId: 'p3', handle: 'Charlie' },
      { playerId: 'p4', handle: 'Diana' },
    ],
    scores: { p1: 0, p2: -30, p3: 0, p4: 100 },
    teams: { team1: ['p1', 'p3'], team2: ['p2', 'p4'] },
    cumulativeTeamScores: { team1: 0, team2: 70 },
    turn: 0,
    trick: [],
    collected: { p1: [], p2: ['3♥', '5♥'], p3: [], p4: ['J♦', '2♣'] },
    // The legacy server hands bots the whole game object, every hand included. Nothing
    // downstream may read this.
    hands: { p1: HAND, p2: ['2♠'], p3: ['3♠'], p4: ['4♠'] },
    ...overrides,
  };
}

describe('bot observation', function () {
  it('restricts legal moves to the led suit when the player can follow', function () {
    expect(legalMovesFor(HAND, [{ player: 'p2', card: '2♠' }])).to.deep.equal(['A♠', 'Q♠']);
  });

  it('allows any card when the player is void in the led suit', function () {
    const hand = ['5♥', '7♣', 'J♦'];
    expect(legalMovesFor(hand, [{ player: 'p2', card: '2♠' }])).to.deep.equal(hand);
  });

  it('allows any card when leading', function () {
    expect(legalMovesFor(HAND, [])).to.deep.equal(HAND);
  });

  it('derives an observation that never carries another player\'s hand', function () {
    const obs = observationFromLegacy(HAND, [], legacyGameState());
    expect(obs).to.not.have.property('hands');
    expect(JSON.stringify(obs)).to.not.include('2♠');
  });

  it('reads identity, teammate and scores from the legacy game object', function () {
    const obs = observationFromLegacy(HAND, [], legacyGameState({ turn: 1 }));
    expect(obs.playerId).to.equal('p2');
    expect(obs.teammate).to.equal('p4');
    expect(obs.totals.p4).to.equal(100);
    expect(obs.teamTotals).to.deep.equal({ team1: 0, team2: 70 });
  });

  it('infers cards remaining from who has already played to the trick', function () {
    const trick = [{ player: 'p3', card: '2♠' }, { player: 'p4', card: '3♠' }];
    const obs = observationFromLegacy(HAND, trick, legacyGameState({ turn: 0 }));
    expect(obs.handCounts).to.deep.equal({ p1: 5, p2: 5, p3: 4, p4: 4 });
    expect(obs.leader).to.equal('p3');
    expect(obs.trickNumber).to.equal(9);
  });

  it('prefers a supplied engine observation over the legacy fields', function () {
    const supplied = { playerId: 'seat-2', hand: ['9♦'], legalMoves: ['9♦'], trick: [] };
    const obs = toObservation(HAND, [], { ...legacyGameState(), observation: supplied });
    expect(obs.playerId).to.equal('seat-2');
    expect(obs.legalMoves).to.deep.equal(['9♦']);
  });

  it('fills in legal moves when a supplied observation omits them', function () {
    const supplied = { playerId: 'p1', hand: HAND, trick: [{ player: 'p2', card: '2♠' }] };
    const obs = toObservation(HAND, [], { observation: supplied });
    expect(obs.legalMoves).to.deep.equal(['A♠', 'Q♠']);
  });

  it('keeps an empty legal move list, which the engine uses for "not your turn"', function () {
    const supplied = { playerId: 'p1', hand: HAND, legalMoves: [], trick: [] };
    expect(toObservation(HAND, [], { observation: supplied }).legalMoves).to.deep.equal([]);
  });

  it('maps player ids to handles', function () {
    expect(namesFromGameState(legacyGameState()).p3).to.equal('Charlie');
  });
});

describe('bot prompt', function () {
  const observation = observationFromLegacy(HAND, [{ player: 'p4', card: '2♠' }], legacyGameState());
  const prompt = buildPrompt(observation, namesFromGameState(legacyGameState()));

  it('shows the player their own hand and legal plays', function () {
    expect(prompt).to.include('A♠, 5♥, 7♣, J♦, Q♠');
    expect(prompt).to.include('LEGAL PLAYS');
    expect(prompt).to.include('A♠, Q♠');
  });

  it('names teammate, opponents and point cards taken', function () {
    expect(prompt).to.include('Your teammate: Charlie');
    expect(prompt).to.include('Bob: 3♥, 5♥');
    expect(prompt).to.include('Diana: J♦');
  });

  it('omits non-point cards other players have collected', function () {
    expect(prompt).to.not.include('2♣');
  });

  it('quotes heart values for the variant in play', function () {
    const pips = buildPrompt({ ...observation, variant: 'pips' }, {});
    expect(prompt).to.include('4♥ 0');
    expect(pips).to.include('4♥ -10');
  });

  it('caps its own length but keeps the response instructions', function () {
    const bloated = {
      ...observation,
      hand: Array.from({ length: 4000 }, (_, i) => `card${i}`),
    };
    const capped = buildPrompt(bloated, {});
    expect(capped.length).to.be.at.most(MAX_PROMPT_CHARS);
    expect(capped).to.include('<played_card>');
  });
});

describe('LLM policy', function () {
  const observation = observationFromLegacy(HAND, [{ player: 'p4', card: '2♠' }], legacyGameState());

  const answer = card => `<reasoning>because</reasoning><played_card>${card}</played_card>`;

  it('plays the card the model names', async function () {
    const policy = createLLMPolicy({ provider: stubProvider(answer('Q♠')) });
    expect(await policy.choose(observation)).to.equal('Q♠');
  });

  it('accepts a card named in prose when the tag is missing', async function () {
    const policy = createLLMPolicy({ provider: stubProvider('I will play the A♠ here.') });
    expect(await policy.choose(observation)).to.equal('A♠');
  });

  it('falls back when the model names an illegal card', async function () {
    const policy = createLLMPolicy({ provider: stubProvider(answer('J♦')) });
    const card = await policy.choose(observation);
    expect(observation.legalMoves).to.include(card);
    expect(card).to.not.equal('J♦');
  });

  it('falls back on garbage output', async function () {
    const policy = createLLMPolicy({ provider: stubProvider('{"nope": true}') });
    expect(observation.legalMoves).to.include(await policy.choose(observation));
  });

  it('falls back when the provider throws', async function () {
    const policy = createLLMPolicy({
      provider: { async generateResponse() { throw new Error('502 upstream'); } },
    });
    expect(observation.legalMoves).to.include(await policy.choose(observation));
  });

  it('gives up on a provider that never answers', async function () {
    const policy = createLLMPolicy({
      provider: { generateResponse: () => new Promise(() => {}) },
      timeoutMs: 30,
    });
    const started = Date.now();
    expect(observation.legalMoves).to.include(await policy.choose(observation));
    expect(Date.now() - started).to.be.below(2000);
  });

  it('skips the model entirely when only one card is legal', async function () {
    const provider = stubProvider(answer('A♠'));
    const policy = createLLMPolicy({ provider });
    const forced = { ...observation, legalMoves: ['Q♠'] };
    expect(await policy.choose(forced)).to.equal('Q♠');
    expect(provider.calls).to.have.length(0);
  });

  it('refuses to choose when no move is legal', async function () {
    const policy = createLLMPolicy({ provider: stubProvider('x') });
    let thrown = null;
    await policy.choose({ ...observation, legalMoves: [] }).catch(error => { thrown = error; });
    expect(thrown).to.be.an('error');
  });

  it('uses the fallback policy it was given', async function () {
    const policy = createLLMPolicy({
      provider: stubProvider('nothing useful'),
      fallback: { name: 'always-first', choose: obs => obs.legalMoves[0] },
    });
    expect(await policy.choose(observation)).to.equal(observation.legalMoves[0]);
  });

  it('does not call a provider that has no API key', async function () {
    const provider = { ...stubProvider('x'), apiKey: '' };
    const policy = createLLMPolicy({ provider });
    expect(observation.legalMoves).to.include(await policy.choose(observation));
    expect(provider.calls).to.have.length(0);
  });

  it('reports a name and the model in use', function () {
    const policy = createLLMPolicy({ provider: stubProvider('x'), name: 'Claude Bot 1' });
    expect(policy.name).to.equal('Claude Bot 1');
    expect(policy.model).to.equal('stub-model');
  });

  it('falls back without an API key instead of calling out', async function () {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const policy = createLLMPolicy({ provider: 'anthropic' });
      expect(observation.legalMoves).to.include(await policy.choose(observation));
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe('response parsing', function () {
  it('reads the played_card tag', function () {
    expect(parseCard('<played_card>J♦</played_card>', ['A♠', 'J♦'])).to.equal('J♦');
  });

  it('prefers a longer card name over a partial match', function () {
    expect(parseCard('<played_card>10♣</played_card>', ['10♣', '2♣'])).to.equal('10♣');
  });

  it('returns null when no legal card is named', function () {
    expect(parseCard('<played_card>Invalid</played_card>', ['A♠', 'J♦'])).to.be.null;
  });

  it('extracts tag content and tolerates malformed XML', function () {
    expect(extractTag('<reasoning>This is my thinking</reasoning>', 'reasoning'))
      .to.equal('This is my thinking');
    expect(extractTag('<reasoning>missing close', 'reasoning')).to.be.null;
  });
});

describe('LLMBotPlayer', function () {
  it('exposes the identity fields the server and bot API read', function () {
    const bot = new LLMBotPlayer('test1', { provider: stubProvider('x'), handle: 'SmartBot' });
    expect(bot.id).to.equal('test1');
    expect(bot.handle).to.equal('SmartBot');
    expect(bot.socketId).to.equal('llm_bot_test1');
    expect(bot.llmModel).to.equal('stub-model');
  });

  it('defaults to the Anthropic provider', function () {
    const bot = new LLMBotPlayer('test2');
    expect(bot.llmProvider).to.equal('anthropic');
    expect(bot.llmModel).to.equal(process.env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic);
  });

  it('plays a legal card from the legacy game object', async function () {
    const provider = stubProvider('<played_card>Q♠</played_card>');
    const bot = new LLMBotPlayer('test3', { provider });
    const card = await bot.selectCard(HAND, [{ player: 'p4', card: '2♠' }], legacyGameState());
    expect(card).to.equal('Q♠');
    expect(provider.calls[0]).to.not.include('3♠');
  });

  it('plays a legal card from an engine observation', async function () {
    const provider = stubProvider('<played_card>9♦</played_card>');
    const bot = new LLMBotPlayer('test4', { provider });
    const observation = {
      playerId: 'p1',
      playerIds: ['p1', 'p2', 'p3', 'p4'],
      hand: ['9♦', '3♣'],
      legalMoves: ['9♦', '3♣'],
      trick: [],
      leader: 'p1',
      trickNumber: 12,
      handNumber: 1,
      exposed: [],
      collected: { p1: [], p2: [], p3: [], p4: [] },
      handCounts: { p1: 2, p2: 2, p3: 2, p4: 2 },
      totals: { p1: 0, p2: 0, p3: 0, p4: 0 },
      teamTotals: null,
      teammate: 'p3',
      variant: 'standard',
    };
    const card = await bot.selectCard(observation.hand, [], { observation });
    expect(card).to.equal('9♦');
  });

  it('still returns a legal card when everything about the model fails', async function () {
    const bot = new LLMBotPlayer('test5', {
      provider: { async generateResponse() { throw new Error('down'); } },
    });
    const card = await bot.selectCard(HAND, [{ player: 'p4', card: '2♠' }], legacyGameState());
    expect(['A♠', 'Q♠']).to.include(card);
  });
});

describe('provider factory', function () {
  it('passes an injected provider object straight through', function () {
    const provider = stubProvider('x');
    expect(createLLMProvider(provider)).to.equal(provider);
  });

  it('builds each named provider with a current default model', function () {
    expect(createLLMProvider('google', {}).model)
      .to.equal(process.env.GOOGLE_MODEL || DEFAULT_MODELS.google);
    expect(createLLMProvider('openrouter', {}).model)
      .to.equal(process.env.OPENROUTER_MODEL || DEFAULT_MODELS.openrouter);
  });

  it('rejects an unknown provider name', function () {
    expect(() => createLLMProvider('nope')).to.throw(/Unknown LLM provider/);
  });
});

describe('LLM policy against the engine', function () {
  const engine = require('../src/engine');

  it('plays a full hand from real engine observations', async function () {
    const playerIds = ['n', 'e', 's', 'w'];
    let match = engine.startHand(engine.createMatch({
      playerIds,
      seed: 'llm-policy',
      options: { teams: { team1: ['n', 's'], team2: ['e', 'w'] } },
    }));

    // Answer with the last legal move the prompt offered, so the model path rather than
    // the heuristic fallback drives every play.
    const policy = createLLMPolicy({
      provider: {
        async generateResponse(prompt) {
          const legal = prompt.match(/LEGAL PLAYS[^:]*: (.+)/)[1].split(', ');
          return `<played_card>${legal[legal.length - 1]}</played_card>`;
        },
      },
    });

    while (match.phase === 'playing') {
      const turn = match.hand.turn;
      const observation = engine.observation(match, turn);
      const card = await policy.choose(observation);
      expect(observation.legalMoves).to.include(card);
      match = engine.playCard(match, turn, card).match;
    }

    expect(match.results).to.have.length(1);
  });
});
