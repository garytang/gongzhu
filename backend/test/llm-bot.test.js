const { expect } = require('chai');
const { LLMBotPlayer } = require('../llm-bot-player');
const { createLLMProvider } = require('../llm-providers');

describe('LLM Bot Player', function() {
  let mockGameState, mockHand, mockTrick;
  
  beforeEach(function() {
    mockGameState = {
      playerOrder: ['player1', 'player2', 'player3', 'player4'],
      playerHandles: [
        { playerId: 'player1', handle: 'Alice' },
        { playerId: 'player2', handle: 'Bob' },
        { playerId: 'player3', handle: 'Charlie' },
        { playerId: 'player4', handle: 'Diana' }
      ],
      scores: { player1: 0, player2: 0, player3: 0, player4: 0 },
      teams: {
        team1: ['player1', 'player3'],
        team2: ['player2', 'player4']
      },
      turn: 0,
      collected: {
        player1: [],
        player2: [],
        player3: [],
        player4: []
      }
    };
    
    mockHand = ['A♠', '5♥', '7♣', 'J♦', 'Q♠'];
    mockTrick = [];
  });

  describe('Bot Creation', function() {
    it('should create a bot with default configuration', function() {
      const bot = new LLMBotPlayer('test1');
      expect(bot.id).to.equal('test1');
      expect(bot.handle).to.include('AI');
      expect(bot.socketId).to.include('llm_bot_');
      expect(bot.llmProvider).to.equal('anthropic');
    });

    it('should create a bot with custom configuration', function() {
      const config = {
        handle: 'SmartBot',
        provider: 'google',
        model: 'gemini-pro',
        fallbackDifficulty: 'hard'
      };
      
      const bot = new LLMBotPlayer('test2', config);
      expect(bot.handle).to.equal('SmartBot');
      expect(bot.llmProvider).to.equal('google');
      expect(bot.llmModel).to.equal('gemini-pro');
      expect(bot.fallbackDifficulty).to.equal('hard');
    });
  });

  describe('Card Validation', function() {
    it('should return all cards when leading', function() {
      const bot = new LLMBotPlayer('test3');
      const validCards = bot.getValidCards(mockHand, []);
      expect(validCards).to.deep.equal(mockHand);
    });

    it('should return suit cards when following suit', function() {
      const bot = new LLMBotPlayer('test4');
      const trickWithSpades = [{ player: 'player1', card: '2♠' }];
      const validCards = bot.getValidCards(mockHand, trickWithSpades);
      expect(validCards).to.deep.equal(['A♠', 'Q♠']);
    });

    it('should return all cards when cannot follow suit', function() {
      const bot = new LLMBotPlayer('test5');
      const handWithoutSpades = ['5♥', '7♣', 'J♦', '10♣'];
      const trickWithSpades = [{ player: 'player1', card: '2♠' }];
      const validCards = bot.getValidCards(handWithoutSpades, trickWithSpades);
      expect(validCards).to.deep.equal(handWithoutSpades);
    });
  });

  describe('Rule-based Fallback', function() {
    it('should select a valid card using rules', function() {
      const bot = new LLMBotPlayer('test6');
      const validCards = ['A♠', '5♥', '7♣'];
      const result = bot.selectCardWithRules(validCards, mockTrick, mockGameState);
      expect(validCards).to.include(result);
    });

    it('should avoid penalty cards when possible', function() {
      const bot = new LLMBotPlayer('test7');
      const validCards = ['Q♠', '7♣', '5♥'];
      const result = bot.selectCardWithRules(validCards, mockTrick, mockGameState);
      // Should prefer non-penalty cards
      expect(['7♣', '5♥']).to.include(result);
    });
  });

  describe('Response Parsing', function() {
    it('should parse XML-formatted responses', function() {
      const bot = new LLMBotPlayer('test8');
      const validCards = ['A♠', '5♥', 'J♦'];
      const response = `<reasoning>
I should lead with a safe card to avoid taking penalty cards.
</reasoning>

<played_card>A♠</played_card>`;
      const result = bot.parseCardFromResponse(response, validCards);
      expect(result).to.equal('A♠');
    });

    it('should parse cards from played_card tag', function() {
      const bot = new LLMBotPlayer('test9');
      const validCards = ['A♠', '5♥', 'J♦'];
      const response = `<reasoning>Playing for bonus points</reasoning>
<played_card>J♦</played_card>`;
      const result = bot.parseCardFromResponse(response, validCards);
      expect(result).to.equal('J♦');
    });

    it('should fallback to parsing entire response', function() {
      const bot = new LLMBotPlayer('test10');
      const validCards = ['A♠', '5♥', 'J♦'];
      const response = 'I choose A♠ to lead safely.';
      const result = bot.parseCardFromResponse(response, validCards);
      expect(result).to.equal('A♠');
    });

    it('should return null for invalid responses', function() {
      const bot = new LLMBotPlayer('test11');
      const validCards = ['A♠', '5♥', 'J♦'];
      const response = '<reasoning>I cannot decide</reasoning><played_card>Invalid</played_card>';
      const result = bot.parseCardFromResponse(response, validCards);
      expect(result).to.be.null;
    });

    it('should extract XML content correctly', function() {
      const bot = new LLMBotPlayer('test12');
      const text = '<reasoning>This is my thinking</reasoning>';
      const result = bot.extractXMLContent(text, 'reasoning');
      expect(result).to.equal('This is my thinking');
    });

    it('should handle malformed XML gracefully', function() {
      const bot = new LLMBotPlayer('test13');
      const text = '<reasoning>Missing closing tag';
      const result = bot.extractXMLContent(text, 'reasoning');
      expect(result).to.be.null;
    });
  });

  describe('Game Memory', function() {
    it('should update played cards memory', function() {
      const bot = new LLMBotPlayer('test14');
      const trick = [{ player: 'player1', card: 'A♠' }];
      bot.updateGameMemory(trick, mockGameState);
      expect(bot.gameMemory.playedCards.has('A♠')).to.be.true;
    });

    it('should track key remaining cards', function() {
      const bot = new LLMBotPlayer('test15');
      bot.gameMemory.playedCards.add('A♠');
      bot.gameMemory.playedCards.add('Q♠');
      const remaining = bot.getKeyRemainingCards();
      expect(remaining).to.not.include('A♠');
      expect(remaining).to.not.include('Q♠');
      expect(remaining).to.include('J♦');
    });
  });

  describe('Strategy Detection', function() {
    it('should detect leading strategy', function() {
      const bot = new LLMBotPlayer('test16');
      const strategy = bot.determineStrategy([], mockGameState);
      expect(strategy).to.equal('lead_safe');
    });

    it('should detect Jack of Diamonds win opportunity', function() {
      const bot = new LLMBotPlayer('test17');
      const trick = [
        { player: 'player1', card: 'A♠' },
        { player: 'player2', card: 'J♦' },
        { player: 'player3', card: '5♠' }
      ];
      const strategy = bot.determineStrategy(trick, mockGameState);
      expect(strategy).to.equal('win_jack');
    });
  });

  describe('Async Card Selection', function() {
    it('should handle async selection with fallback', async function() {
      this.timeout(5000); // Increase timeout for async operations
      
      const bot = new LLMBotPlayer('test18', {
        provider: 'anthropic',
        // No API key provided, should fallback
      });
      
      const result = await bot.selectCard(mockHand, mockTrick, mockGameState);
      expect(mockHand).to.include(result);
    });
  });

  describe('Utility Functions', function() {
    it('should detect card suits correctly', function() {
      const bot = new LLMBotPlayer('test19');
      expect(bot.getSuit('A♠')).to.equal('♠');
      expect(bot.getSuit('5♥')).to.equal('♥');
      expect(bot.getSuit('J♦')).to.equal('♦');
      expect(bot.getSuit('10♣')).to.equal('♣');
    });

    it('should detect card ranks correctly', function() {
      const bot = new LLMBotPlayer('test20');
      expect(bot.getRank('A♠')).to.equal('A');
      expect(bot.getRank('10♥')).to.equal('10');
      expect(bot.getRank('J♦')).to.equal('J');
    });

    it('should detect penalty cards in tricks', function() {
      const bot = new LLMBotPlayer('test21');
      const trickWithPenalty = [{ player: 'player1', card: 'Q♠' }];
      const trickWithHeart = [{ player: 'player1', card: '5♥' }];
      const trickSafe = [{ player: 'player1', card: '7♣' }];
      
      expect(bot.trickHasPenaltyCards(trickWithPenalty)).to.be.true;
      expect(bot.trickHasPenaltyCards(trickWithHeart)).to.be.true;
      expect(bot.trickHasPenaltyCards(trickSafe)).to.be.false;
    });

    it('should detect Jack of Diamonds in tricks', function() {
      const bot = new LLMBotPlayer('test22');
      const trickWithJack = [{ player: 'player1', card: 'J♦' }];
      const trickWithoutJack = [{ player: 'player1', card: '7♣' }];
      
      expect(bot.trickHasJackDiamonds(trickWithJack)).to.be.true;
      expect(bot.trickHasJackDiamonds(trickWithoutJack)).to.be.false;
    });
  });
});