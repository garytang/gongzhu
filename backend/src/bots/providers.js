require('dotenv').config();
const axios = require('axios');

/**
 * Thin HTTP clients for the LLM services a bot can be pointed at.
 *
 * A provider is anything with `generateResponse(prompt, options) -> Promise<string>`,
 * so a stub object can be substituted wherever a provider is accepted.
 *
 * Model defaults are the cheapest current model of each family that is still worth
 * playing against; `backend/LLM_BOTS.md` lists the stronger alternatives and the
 * environment variables that select them.
 */

const DEFAULT_MODELS = {
  anthropic: 'claude-haiku-4-5',
  google: 'gemini-3.5-flash-lite',
  openrouter: 'anthropic/claude-haiku-4.5',
};

/** Environment variable holding each provider's API key, in auto-detection order. */
const PROVIDER_KEYS = {
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GOOGLE_API_KEY',
};

/** How a bot on each provider introduces itself. Only Anthropic's own API is certain to be Claude. */
const DISPLAY_NAMES = {
  anthropic: 'Claude',
  openrouter: 'AI',
  google: 'Gemini',
};

/**
 * Per-request deadline. The policy layer passes it through on every call, so this is
 * the one number a direct caller of a provider gets too. Reasoning models routinely need
 * more than five seconds; a heuristic fallback move is a worse outcome than a short wait.
 */
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Reasoning effort asked of the model on every move. Choosing one card does not need deep
 * deliberation, and latency is what a live table feels. Passed to every provider as
 * `options.reasoningEffort` (none | low | medium | high); OpenRouter maps it to its
 * unified `reasoning` field, which non-reasoning models ignore. Anthropic and Google
 * requests do not map it yet and run without extended thinking.
 */
const DEFAULT_REASONING_EFFORT = 'low';
const DEFAULT_MAX_TOKENS = 300;

class AnthropicProvider {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.model = config.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic;
    this.baseURL = 'https://api.anthropic.com/v1/messages';
  }

  async generateResponse(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    // `temperature` is deliberately not sent: Claude 4.7 and later reject a non-default
    // value with a 400.
    try {
      const response = await axios.post(this.baseURL, {
        model: this.model,
        max_tokens: options.maxTokens || DEFAULT_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: options.timeout || DEFAULT_TIMEOUT_MS,
      });

      return response.data.content[0].text.trim();
    } catch (error) {
      throw new Error(`Anthropic API request failed: ${describe(error)}`);
    }
  }
}

class GoogleProvider {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY;
    this.model = config.model || process.env.GOOGLE_MODEL || DEFAULT_MODELS.google;
    this.baseURL = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
  }

  async generateResponse(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('Google API key not configured');
    }

    try {
      const response = await axios.post(`${this.baseURL}?key=${this.apiKey}`, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: options.maxTokens || DEFAULT_MAX_TOKENS,
          temperature: options.temperature ?? 0.3,
        },
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: options.timeout || DEFAULT_TIMEOUT_MS,
      });

      return response.data.candidates[0].content.parts[0].text.trim();
    } catch (error) {
      throw new Error(`Google API request failed: ${describe(error)}`);
    }
  }
}

/** The chat-completions body for one move. Kept separate from the HTTP call so it can be asserted on. */
function openRouterRequestBody(model, prompt, options = {}) {
  return {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: options.maxTokens || DEFAULT_MAX_TOKENS,
    reasoning: { effort: options.reasoningEffort || DEFAULT_REASONING_EFFORT },
  };
}

class OpenRouterProvider {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;
    this.model = config.model || process.env.OPENROUTER_MODEL || DEFAULT_MODELS.openrouter;
    this.baseURL = 'https://openrouter.ai/api/v1/chat/completions';
  }

  async generateResponse(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    try {
      const response = await axios.post(this.baseURL, openRouterRequestBody(this.model, prompt, options), {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://gongzhu.up.railway.app',
          'X-Title': 'Gongzhu Card Game',
        },
        timeout: options.timeout || DEFAULT_TIMEOUT_MS,
      });

      return response.data.choices[0].message.content.trim();
    } catch (error) {
      throw new Error(`OpenRouter API request failed: ${describe(error)}`);
    }
  }
}

/** Collapse an axios failure into one line, without dumping the request headers. */
function describe(error) {
  const body = error.response && error.response.data;
  const detail = body && (body.error && body.error.message ? body.error.message : JSON.stringify(body));
  return detail ? `${error.message}: ${detail}` : error.message;
}

/**
 * Resolve a provider. `type` is a provider name, or an object already implementing
 * `generateResponse`, which is how tests inject a stub with no network or API key.
 */
function createLLMProvider(type, config = {}) {
  if (type && typeof type === 'object' && typeof type.generateResponse === 'function') {
    return type;
  }

  switch (String(type).toLowerCase()) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'google':
      return new GoogleProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
    default:
      throw new Error(`Unknown LLM provider type: ${type}`);
  }
}

module.exports = {
  DEFAULT_MODELS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_REASONING_EFFORT,
  openRouterRequestBody,
  PROVIDER_KEYS,
  DISPLAY_NAMES,
  AnthropicProvider,
  GoogleProvider,
  OpenRouterProvider,
  createLLMProvider,
};
