const { createLLMProvider } = require('./llm-providers');

/**
 * Enhanced bot player that uses LLM for decision making
 */
class LLMBotPlayer {
  constructor(id, llmConfig = {}) {
    this.id = id;
    this.handle = llmConfig.handle || `AI ${id.slice(-4)}`;
    this.socketId = `llm_bot_${id}`;
    
    // LLM configuration
    this.llmProvider = llmConfig.provider || 'anthropic';
    this.llmModel = llmConfig.model;
    this.llmConfig = llmConfig;
    
    // Initialize LLM provider
    try {
      this.llm = createLLMProvider(this.llmProvider, {
        apiKey: llmConfig.apiKey,
        model: this.llmModel,
        ...llmConfig.providerConfig
      });
    } catch (error) {
      console.error(`Failed to initialize LLM provider: ${error.message}`);
      this.llm = null;
    }
    
    // Fallback to rule-based AI if LLM fails
    this.fallbackDifficulty = llmConfig.fallbackDifficulty || 'hard';
    
    // Game memory for better decision making
    this.gameMemory = {
      playedCards: new Set(),
      playerTendencies: new Map(),
      riskAssessment: new Map()
    };
  }

  /**
   * Main card selection method that tries LLM first, falls back to rules
   */
  async selectCard(hand, trick, gameState) {
    const validCards = this.getValidCards(hand, trick);
    
    // Update game memory
    this.updateGameMemory(trick, gameState);
    
    // Try LLM decision first
    if (this.llm) {
      console.log(`🤖 ${this.handle} attempting LLM decision using ${this.llmProvider}...`);
      try {
        const llmChoice = await this.selectCardWithLLM(hand, trick, gameState, validCards);
        if (llmChoice && validCards.includes(llmChoice)) {
          console.log(`LLM Bot ${this.handle} chose: ${llmChoice} (via ${this.llmProvider})`);
          return llmChoice;
        } else {
          console.log(`LLM Bot ${this.handle} returned invalid choice: ${llmChoice}, falling back to rules`);
        }
      } catch (error) {
        console.error(`LLM decision failed for ${this.handle}: ${error.message}`);
      }
    } else {
      console.log(`🤖 ${this.handle} no LLM provider configured, using rules`);
    }
    
    // Fallback to enhanced rule-based AI
    const fallbackChoice = this.selectCardWithRules(validCards, trick, gameState);
    console.log(`LLM Bot ${this.handle} chose: ${fallbackChoice} (fallback rules)`);
    return fallbackChoice;
  }

  /**
   * LLM-based card selection
   */
  async selectCardWithLLM(hand, trick, gameState, validCards) {
    try {
      const prompt = this.llm.formatGameStatePrompt(gameState, hand, trick, gameState.collected);
      
      // Add memory context
      const memoryContext = this.generateMemoryContext();
      const fullPrompt = `${prompt}\n\n${memoryContext}\n\nValid cards you can play: ${validCards.join(', ')}`;
      
      const response = await this.llm.generateResponse(fullPrompt, {
        maxTokens: 300,
        temperature: 0.3,
        timeout: 8000
      });
      
      console.log(`📝 Raw LLM response for ${this.handle}:`, response);
      
      // Extract card from response
      const selectedCard = this.parseCardFromResponse(response, validCards);
      console.log(`🎯 Parsed card for ${this.handle}:`, selectedCard);
      return selectedCard;
    } catch (error) {
      console.error(`LLM selection error: ${error.message}`);
      return null;
    }
  }

  /**
   * Enhanced rule-based fallback AI
   */
  selectCardWithRules(validCards, trick, gameState) {
    // If only one valid card, play it
    if (validCards.length === 1) {
      return validCards[0];
    }

    // Advanced strategy based on game state
    const strategy = this.determineStrategy(trick, gameState);
    
    switch (strategy) {
      case 'lead_safe':
        return this.selectLeadSafe(validCards, gameState);
      case 'avoid_penalty':
        return this.selectAvoidPenalty(validCards, trick, gameState);
      case 'win_jack':
        return this.selectWinJack(validCards, trick, gameState);
      case 'support_teammate':
        return this.selectSupportTeammate(validCards, trick, gameState);
      case 'dump_penalty':
        return this.selectDumpPenalty(validCards, trick, gameState);
      default:
        return this.selectSafeDefault(validCards, trick, gameState);
    }
  }

  /**
   * Determine optimal strategy based on game state
   */
  determineStrategy(trick, gameState) {
    const position = trick.length;
    const isLeading = position === 0;
    const isLast = position === 3;
    
    if (isLeading) {
      return 'lead_safe';
    }
    
    if (this.trickHasJackDiamonds(trick) && isLast) {
      return 'win_jack';
    }
    
    if (this.trickHasPenaltyCards(trick)) {
      return 'avoid_penalty';
    }
    
    if (this.shouldSupportTeammate(trick, gameState)) {
      return 'support_teammate';
    }
    
    if (this.shouldDumpPenalty(validCards, gameState)) {
      return 'dump_penalty';
    }
    
    return 'avoid_penalty';
  }

  /**
   * Parse card name and reasoning from LLM response
   */
  parseCardFromResponse(response, validCards) {
    // Extract reasoning and played card from XML tags
    const reasoning = this.extractXMLContent(response, 'reasoning');
    const playedCard = this.extractXMLContent(response, 'played_card');
    
    // Log the reasoning if available
    if (reasoning) {
      console.log(`\n🤖 ${this.handle} reasoning:\n${reasoning}\n`);
    }
    
    // Try to find the card from the played_card tag first
    if (playedCard) {
      const cardFromTag = this.findValidCard(playedCard, validCards);
      if (cardFromTag) {
        return cardFromTag;
      }
    }
    
    // Fallback to parsing the entire response
    return this.findValidCard(response, validCards);
  }

  /**
   * Extract content from XML tags
   */
  extractXMLContent(text, tagName) {
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  }

  /**
   * Find a valid card from text
   */
  findValidCard(text, validCards) {
    // Clean up the text
    const cleanText = text.replace(/[^\w♠♥♣♦\[\]]/g, '');
    
    // Look for exact matches first
    for (const card of validCards) {
      if (cleanText.includes(card)) {
        return card;
      }
    }
    
    // Try to match rank and suit separately
    const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    const suits = ['♠', '♥', '♣', '♦'];
    
    for (const rank of ranks) {
      for (const suit of suits) {
        const card = `${rank}${suit}`;
        if (validCards.includes(card) && cleanText.includes(rank) && cleanText.includes(suit)) {
          return card;
        }
      }
    }
    
    return null;
  }

  /**
   * Update game memory with observations
   */
  updateGameMemory(trick, gameState) {
    // Track played cards
    for (const play of trick) {
      this.gameMemory.playedCards.add(play.card);
    }
    
    // Analyze player tendencies (simplified)
    if (trick.length > 0) {
      const leader = trick[0];
      const suit = this.getSuit(leader.card);
      
      if (!this.gameMemory.playerTendencies.has(leader.player)) {
        this.gameMemory.playerTendencies.set(leader.player, {
          leadsWithSuit: new Map(),
          avoidsHearts: 0,
          takesRisks: 0
        });
      }
    }
  }

  /**
   * Generate memory context for LLM
   */
  generateMemoryContext() {
    const playedCount = this.gameMemory.playedCards.size;
    const remainingCards = 52 - playedCount;
    
    return `GAME MEMORY:
- Cards played so far: ${playedCount}/52
- Remaining cards: ${remainingCards}
- Key cards still in play: ${this.getKeyRemainingCards().join(', ')}`;
  }

  /**
   * Get list of important cards still in play
   */
  getKeyRemainingCards() {
    const keyCards = ['A♠', 'K♠', 'Q♠', 'A♥', 'K♥', 'Q♥', 'J♥', 'J♦', '10♣'];
    return keyCards.filter(card => !this.gameMemory.playedCards.has(card));
  }

  // Helper methods for rule-based strategies
  selectLeadSafe(validCards, gameState) {
    // Lead with safe cards, avoid hearts and high spades
    const safeCards = validCards.filter(card => 
      !card.endsWith('♥') && 
      card !== 'Q♠' && 
      card !== 'A♠' && 
      card !== 'K♠'
    );
    return safeCards.length > 0 ? safeCards[0] : validCards[0];
  }

  selectAvoidPenalty(validCards, trick, gameState) {
    // Avoid taking penalty cards
    const penaltyCards = ['Q♠'];
    const heartCards = validCards.filter(card => card.endsWith('♥'));
    
    const safeCards = validCards.filter(card => 
      !penaltyCards.includes(card) && 
      !heartCards.includes(card)
    );
    
    return safeCards.length > 0 ? safeCards[0] : validCards[0];
  }

  selectWinJack(validCards, trick, gameState) {
    // Try to win the Jack of Diamonds
    if (this.canWinTrick(validCards, trick)) {
      const winningCards = this.getWinningCards(validCards, trick);
      return winningCards[0];
    }
    return this.selectAvoidPenalty(validCards, trick, gameState);
  }

  selectSupportTeammate(validCards, trick, gameState) {
    // Support teammate's lead or avoid taking their penalty
    return this.selectAvoidPenalty(validCards, trick, gameState);
  }

  selectDumpPenalty(validCards, trick, gameState) {
    // Dump penalty cards when safe
    const penaltyCards = validCards.filter(card => 
      card.endsWith('♥') || card === 'Q♠'
    );
    return penaltyCards.length > 0 ? penaltyCards[0] : validCards[0];
  }

  selectSafeDefault(validCards, trick, gameState) {
    return this.selectAvoidPenalty(validCards, trick, gameState);
  }

  // Utility methods
  getValidCards(hand, trick) {
    if (trick.length === 0) {
      return hand; // Can play any card if leading
    }
    
    const ledSuit = this.getSuit(trick[0].card);
    const suitCards = hand.filter(card => this.getSuit(card) === ledSuit);
    return suitCards.length > 0 ? suitCards : hand;
  }

  getSuit(card) {
    return card.slice(-1);
  }

  getRank(card) {
    return card.slice(0, -1);
  }

  trickHasJackDiamonds(trick) {
    return trick.some(play => play.card === 'J♦');
  }

  trickHasPenaltyCards(trick) {
    return trick.some(play => 
      play.card.endsWith('♥') || play.card === 'Q♠'
    );
  }

  shouldSupportTeammate(trick, gameState) {
    // Simplified: would need team analysis
    return false;
  }

  shouldDumpPenalty(validCards, gameState) {
    // Simplified: check if safe to dump penalty cards
    return false;
  }

  canWinTrick(validCards, trick) {
    if (trick.length === 0) return true;
    
    const ledSuit = this.getSuit(trick[0].card);
    const winningCards = this.getWinningCards(validCards, trick);
    return winningCards.length > 0;
  }

  getWinningCards(validCards, trick) {
    if (trick.length === 0) return validCards;
    
    const ledSuit = this.getSuit(trick[0].card);
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    
    // Find highest card in led suit so far
    let highestRank = -1;
    for (const play of trick) {
      if (this.getSuit(play.card) === ledSuit) {
        const rank = ranks.indexOf(this.getRank(play.card));
        if (rank > highestRank) {
          highestRank = rank;
        }
      }
    }
    
    // Find cards that can win
    return validCards.filter(card => {
      if (this.getSuit(card) !== ledSuit) return false;
      return ranks.indexOf(this.getRank(card)) > highestRank;
    });
  }
}

module.exports = { LLMBotPlayer };