# LLM Bot Players for Gongzhu

This document describes the LLM-powered bot players that can be integrated into the Gongzhu card game.

## Overview

The LLM bot system extends the existing bot player functionality with AI-powered decision making using Large Language Models. The system supports multiple LLM providers and includes intelligent fallback mechanisms.

## Features

- **Multiple LLM Providers**: Anthropic Claude, Google Gemini, OpenRouter
- **Intelligent Game Analysis**: Considers current hand, trick state, collected cards, team dynamics
- **Robust Fallback**: Falls back to enhanced rule-based AI if LLM fails
- **Game Memory**: Tracks played cards and player tendencies
- **Strategic Decision Making**: Implements various strategies based on game state

## Configuration

### Environment Variables

Create a `.env` file in the backend directory with your API keys:

```bash
# Anthropic Claude API
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Google Gemini API  
GOOGLE_API_KEY=your_google_api_key_here

# OpenRouter API (supports multiple models)
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

### API Key Sources

- **Anthropic**: Get from [Anthropic Console](https://console.anthropic.com/)
- **Google**: Get from [Google AI Studio](https://makersuite.google.com/app/apikey)
- **OpenRouter**: Get from [OpenRouter](https://openrouter.ai/keys)

## Usage

### API Endpoints

#### Create LLM Bot

```bash
POST /api/bots/create
Content-Type: application/json

{
  "type": "llm",
  "llmConfig": {
    "handle": "Claude Bot",
    "provider": "anthropic",
    "model": "claude-3-haiku-20240307",
    "apiKey": "your_api_key_here",
    "fallbackDifficulty": "hard"
  }
}
```

#### Create Bot with Different Providers

**Anthropic Claude:**
```json
{
  "type": "llm",
  "llmConfig": {
    "handle": "Claude Pro",
    "provider": "anthropic",
    "model": "claude-3-sonnet-20240229"
  }
}
```

**Google Gemini:**
```json
{
  "type": "llm", 
  "llmConfig": {
    "handle": "Gemini Bot",
    "provider": "google",
    "model": "gemini-1.5-pro"
  }
}
```

**OpenRouter (Multiple Models):**
```json
{
  "type": "llm",
  "llmConfig": {
    "handle": "OpenRouter Bot",
    "provider": "openrouter", 
    "model": "anthropic/claude-3-haiku"
  }
}
```

#### List All Bots

```bash
GET /api/bots/list
```

Response:
```json
{
  "success": true,
  "bots": [
    {
      "id": "llm_bot_1234567890_0",
      "handle": "Claude Bot",
      "type": "llm",
      "provider": "anthropic",
      "model": "claude-3-haiku-20240307"
    }
  ]
}
```

#### Clear All Bots

```bash
DELETE /api/bots/clear
```

### Programmatic Usage

```javascript
const { LLMBotPlayer } = require('./llm-bot-player');

// Create an LLM bot
const bot = new LLMBotPlayer('bot1', {
  handle: 'Smart Bot',
  provider: 'anthropic',
  model: 'claude-3-haiku-20240307',
  apiKey: process.env.ANTHROPIC_API_KEY,
  fallbackDifficulty: 'hard'
});

// Use in game (returns a Promise)
const selectedCard = await bot.selectCard(hand, trick, gameState);
```

## LLM Providers

### Anthropic Claude

- **Models**: `claude-3-haiku-20240307`, `claude-3-sonnet-20240229`, `claude-3-opus-20240229`
- **Strengths**: Excellent reasoning, strategic thinking
- **Cost**: Moderate to high
- **Speed**: Fast (Haiku) to slower (Opus)

### Google Gemini

- **Models**: `gemini-1.5-flash`, `gemini-1.5-pro`
- **Strengths**: Good general performance, competitive pricing
- **Cost**: Low to moderate
- **Speed**: Very fast (Flash) to moderate (Pro)

### OpenRouter

- **Models**: Supports many models including Claude, GPT, Llama, etc.
- **Strengths**: Model variety, competitive pricing
- **Cost**: Varies by model
- **Speed**: Varies by model

## Bot Behavior

### LLM Response Format

The LLM is prompted to respond in a structured XML format:

```xml
<reasoning>
Strategic analysis of the current situation, explaining card choice
</reasoning>

<played_card>
A♠
</played_card>
```

**Benefits**:
- **Transparency**: Reasoning is logged to console for game analysis
- **Reliability**: Structured parsing improves card extraction accuracy
- **Debugging**: Clear separation of thinking and action

### Decision Making Process

1. **LLM Analysis**: Analyzes current game state and generates strategic response with reasoning
2. **Response Parsing**: Extracts reasoning and card choice from XML-formatted response
3. **Reasoning Logging**: Logs the LLM's strategic thinking to console for transparency
4. **Validation**: Ensures selected card is valid according to game rules
5. **Fallback**: Uses enhanced rule-based AI if LLM fails

### Strategic Considerations

The LLM bot considers:

- **Current Hand**: Available cards and their strategic value
- **Trick State**: Cards already played, who led, position in trick
- **Collected Cards**: Point cards collected by each player
- **Team Dynamics**: Teammate's position and needs
- **Game Rules**: Suit following, scoring system, special cards
- **Risk Assessment**: Probability of taking penalty cards

### Fallback Strategies

If LLM fails, the bot uses enhanced rule-based strategies:

- **Lead Safe**: Start with non-penalty cards
- **Avoid Penalty**: Don't take hearts or Queen of Spades
- **Win Jack**: Try to capture Jack of Diamonds for bonus
- **Support Teammate**: Help teammate avoid penalties
- **Dump Penalty**: Safely discard penalty cards

## Testing

Run the LLM bot tests:

```bash
npm run test:llm
```

Run all tests:

```bash
npm run test:all
```

## Integration

The LLM bots integrate seamlessly with the existing game system:

- **Socket.IO Compatibility**: Works with existing real-time game flow
- **Player Management**: Treated identically to human players in game state
- **Turn Handling**: Automatic turn processing with configurable delays
- **Error Handling**: Graceful degradation to rule-based play

## Performance Considerations

- **API Latency**: LLM calls add 1-8 seconds per decision
- **Rate Limits**: Respect provider rate limits
- **Cost**: Monitor API usage costs
- **Reliability**: Always have fallback mechanisms

## Troubleshooting

### Common Issues

1. **API Key Not Working**: Check key validity and environment variables
2. **Slow Response**: Some models are slower, adjust timeout settings
3. **Invalid Card Selection**: Parser may fail, relies on fallback
4. **Rate Limiting**: Implement retry logic or reduce request frequency

### Debugging

Enable detailed logging:

```javascript
console.log(`LLM Bot ${bot.handle} decision: ${response}`);
```

Check API responses and parsing logic in the bot implementation.

## Future Enhancements

- **Learning System**: Remember successful strategies
- **Opponent Modeling**: Track opponent playing patterns
- **Advanced Prompting**: Improve prompt engineering for better decisions
- **Multi-Round Strategy**: Consider long-term team strategy
- **Custom Models**: Support for self-hosted models