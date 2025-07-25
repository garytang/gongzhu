require('dotenv').config();
const axios = require('axios');

/**
 * Abstract base class for LLM providers
 */
class LLMProvider {
  constructor(config = {}) {
    this.config = config;
  }

  async generateResponse(prompt, options = {}) {
    throw new Error('generateResponse must be implemented by subclasses');
  }

  formatGameStatePrompt(gameState, hand, trick, collected) {
    const { playerOrder, playerHandles, scores, teams, turn } = gameState;
    const currentPlayerIndex = turn;
    const currentPlayer = playerHandles[currentPlayerIndex];
    
    // Format team information and determine current player's team
    const team1Players = teams.team1.map(id => playerHandles.find(p => p.playerId === id)?.handle || id);
    const team2Players = teams.team2.map(id => playerHandles.find(p => p.playerId === id)?.handle || id);
    
    const currentPlayerId = playerOrder[currentPlayerIndex];
    const isOnTeam1 = teams.team1.includes(currentPlayerId);
    const currentTeam = isOnTeam1 ? team1Players : team2Players;
    const opposingTeam = isOnTeam1 ? team2Players : team1Players;
    const teammate = currentTeam.find(name => name !== currentPlayer.handle);
    
    // Format current trick
    const trickInfo = trick.map(t => {
      const playerHandle = playerHandles.find(p => p.playerId === t.player)?.handle || t.player;
      return `${playerHandle}: ${t.card}`;
    }).join(', ');

    // Format collected point cards for all players (only show scoring cards)
    const pointCards = ['♥', 'Q♠', 'J♦', '10♣'];
    const collectedInfo = playerHandles.map(playerInfo => {
      const playerId = playerInfo.playerId;
      const playerHandle = playerInfo.handle;
      const cards = collected[playerId] || [];
      const relevantCards = cards.filter(card => 
        pointCards.some(pc => card.includes(pc.slice(-1)) || card === pc)
      );
      const pointCardsStr = relevantCards.join(', ') || 'none';
      return `  ${playerHandle}: ${pointCardsStr}`;
    }).join('\n');

    return `You are playing Gongzhu (Chinese Hearts), a trick-taking card game.

GAME RULES:
- You must follow suit if you have a card of the lead suit; otherwise any card can be played
- The cards are ranked according to conventional card ranks i.e. 2 < 3 < ... < 10 < J < Q < K < Q
- Player with highest card wins the trick; they collect all the cards in the trick and are scored according to the cards
- Scoring: Hearts are negative (-10 to -50), Q♠ is -100, J♦ is +100, 10♣ doubles your score or gives +50 if no other scoring cards; 
- "Shooting the moon" (getting all hearts) gives +200 points
- Team scores are the sum of the member scores
- Game is played in teams: Team 1 (${team1Players.join(', ')}) vs Team 2 (${team2Players.join(', ')})
- The first team to reach +1000 is the winner or the first team to -1000 is the loser.

CURRENT SITUATION:
Your hand: ${hand.join(', ')}
Current trick: ${trickInfo || 'Empty (you lead)'}
Your position: ${currentPlayer.handle} (Player ${currentPlayerIndex + 1})

TEAM INFORMATION:
Your teammate: ${teammate}
Your team: ${currentTeam.join(', ')}
Opposing team: ${opposingTeam.join(', ')}

COLLECTED POINT CARDS SO FAR:
${collectedInfo}

CURRENT SCORES:
${playerHandles.map(p => `${p.handle}: ${scores[p.playerId] || 0}`).join(', ')}

Please choose one card from your hand to play. Consider:
1. If it is desirable to win or avoid winning a given trick and play accordingly i.e. will winning this trick lead to positive points (good) or negative points (bad)
2. A long term strategy; will a given card be valuable to play now or later,
3. Your teammate's position and needs,
4. The strategy of players from the opposing team and foil their goals if possible,
5. What cards have been played, which cards remain and what cards people likely have

Please provide your response in the following format:
<reasoning>
Brief strategic reasoning (1-3 sentences max)
</reasoning>

<played_card>
[Card name, e.g., "A♠", "5♥", "J♦"]
</played_card>`;
  }
}

/**
 * Anthropic Claude provider
 */
class AnthropicProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.model = config.model || process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022';
    this.baseURL = 'https://api.anthropic.com/v1/messages';
  }

  async generateResponse(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    try {
      const response = await axios.post(this.baseURL, {
        model: this.model,
        max_tokens: options.maxTokens || 100,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        timeout: options.timeout || 10000
      });

      return response.data.content[0].text.trim();
    } catch (error) {
      console.error('Anthropic API error:', error.response?.data || error.message);
      throw new Error(`Anthropic API request failed: ${error.message}`);
    }
  }
}

/**
 * Google Gemini provider
 */
class GoogleProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY;
    this.model = config.model || process.env.GOOGLE_MODEL || 'gemini-1.5-flash';
    this.baseURL = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
  }

  async generateResponse(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('Google API key not configured');
    }

    try {
      const response = await axios.post(`${this.baseURL}?key=${this.apiKey}`, {
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          maxOutputTokens: options.maxTokens || 100,
          temperature: options.temperature || 0.7
        }
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: options.timeout || 10000
      });

      return response.data.candidates[0].content.parts[0].text.trim();
    } catch (error) {
      console.error('Google API error:', error.response?.data || error.message);
      throw new Error(`Google API request failed: ${error.message}`);
    }
  }
}

/**
 * OpenRouter provider (supports multiple models)
 */
class OpenRouterProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;
    this.model = config.model || process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku';
    this.baseURL = 'https://openrouter.ai/api/v1/chat/completions';
  }

  async generateResponse(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    try {
      const response = await axios.post(this.baseURL, {
        model: this.model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: options.maxTokens || 100,
        temperature: options.temperature || 0.7
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://gongzhu-game.com',
          'X-Title': 'Gongzhu Card Game'
        },
        timeout: options.timeout || 10000
      });

      return response.data.choices[0].message.content.trim();
    } catch (error) {
      console.error('OpenRouter API error:', error.response?.data || error.message);
      throw new Error(`OpenRouter API request failed: ${error.message}`);
    }
  }
}

/**
 * Factory function to create LLM providers
 */
function createLLMProvider(type, config = {}) {
  switch (type.toLowerCase()) {
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
  LLMProvider,
  AnthropicProvider,
  GoogleProvider,
  OpenRouterProvider,
  createLLMProvider
};