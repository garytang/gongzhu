'use strict';

const { expect } = require('chai');
const { resolveLLMProvider } = require('../../src/server/createServer');

describe('server: LLM provider selection', () => {
  it('returns null when no provider key is configured', () => {
    expect(resolveLLMProvider({})).to.equal(null);
  });

  it('auto-detects the first provider with a key, in anthropic → openrouter → google order', () => {
    expect(resolveLLMProvider({ OPENROUTER_API_KEY: 'k' })).to.equal('openrouter');
    expect(resolveLLMProvider({ GOOGLE_API_KEY: 'k' })).to.equal('google');
    expect(resolveLLMProvider({ ANTHROPIC_API_KEY: 'k', OPENROUTER_API_KEY: 'k' })).to.equal('anthropic');
    expect(resolveLLMProvider({ OPENROUTER_API_KEY: 'k', GOOGLE_API_KEY: 'k' })).to.equal('openrouter');
  });

  it('honours an explicit LLM_PROVIDER over auto-detection', () => {
    const env = { LLM_PROVIDER: 'openrouter', ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'o' };
    expect(resolveLLMProvider(env)).to.equal('openrouter');
    expect(resolveLLMProvider({ ...env, LLM_PROVIDER: ' OpenRouter ' })).to.equal('openrouter');
  });

  it('rejects an unknown provider name', () => {
    expect(() => resolveLLMProvider({ LLM_PROVIDER: 'mistral', ANTHROPIC_API_KEY: 'k' }))
      .to.throw(/Unknown LLM_PROVIDER "mistral"/);
  });

  it('rejects an explicit provider whose key is missing rather than silently falling back', () => {
    expect(() => resolveLLMProvider({ LLM_PROVIDER: 'openrouter', ANTHROPIC_API_KEY: 'k' }))
      .to.throw(/OPENROUTER_API_KEY is not set/);
  });

  it('treats an empty LLM_PROVIDER as unset', () => {
    expect(resolveLLMProvider({ LLM_PROVIDER: '', GOOGLE_API_KEY: 'k' })).to.equal('google');
  });
});
