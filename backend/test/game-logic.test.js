const assert = require('assert');

// Mock the main game functions - in a real setup, these would be extracted to modules
function createDeck() {
  const SUITS = ['♠', '♥', '♣', '♦'];
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

function getSuit(card) {
  return card.slice(-1);
}

function getRank(card) {
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const rank = card.slice(0, -1);
  return RANKS.indexOf(rank);
}

function determineTrickWinner(trick) {
  if (trick.length === 0) return null;
  const ledSuit = getSuit(trick[0].card);
  let highestIdx = 0;
  let highestRank = getRank(trick[0].card);
  for (let i = 1; i < trick.length; i++) {
    if (getSuit(trick[i].card) === ledSuit && getRank(trick[i].card) > highestRank) {
      highestRank = getRank(trick[i].card);
      highestIdx = i;
    }
  }
  return trick[highestIdx].player;
}

// Mock players map for testing
const mockPlayers = new Map();

function calculateTeamScores(collected, teams, exposures = {}) {
  const cardValue = card => {
    const [rank, suit] = [card.slice(0, -1), card.slice(-1)];
    if (suit === '♥') {
      if (rank === 'A') return -50;
      if (rank === 'K') return -40;
      if (rank === 'Q') return -30;
      if (rank === 'J') return -20;
      if (["10", "9", "8", "7", "6", "5"].includes(rank)) return -10;
      return 0; // 4,3,2
    }
    if (card === 'Q♠') return -100;
    if (card === 'J♦') return 100;
    return 0;
  };

  // Step 1: Calculate individual player results
  const playerResults = {};
  for (const [socketId, cards] of Object.entries(collected)) {
    const handle = mockPlayers.get(socketId) || socketId;
    let base = 0;
    let hasQSpades = false, hasJDiamonds = false, has10Clubs = false;
    let hearts = 0;
    let heartRanks = new Set();
    for (const card of cards) {
      if (card === 'Q♠') hasQSpades = true;
      if (card === 'J♦') hasJDiamonds = true;
      if (card === '10♣') has10Clubs = true;
      if (card.slice(-1) === '♥') {
        hearts += 1;
        heartRanks.add(card.slice(0, -1));
      }
      base += cardValue(card);
    }
    // Check for all hearts (shooting the moon)
    const allHeartRanks = new Set(['A','K','Q','J','10','9','8','7','6','5','4','3','2']);
    if ([...allHeartRanks].every(r => heartRanks.has(r))) {
      base = 200;
      if (hasQSpades) base += 100;
      if (hasJDiamonds) base += 100;
    }
    playerResults[socketId] = {
      base,
      hasQSpades,
      hasJDiamonds,
      has10Clubs,
      hearts,
      heartRanks,
      cards,
    };
  }

  // Step 2: Apply 10♣ doubling
  for (const [socketId, res] of Object.entries(playerResults)) {
    let multiplier = 1;
    if (res.has10Clubs) {
      const cardValueFor10 = card => {
        const [rank, suit] = [card.slice(0, -1), card.slice(-1)];
        if (suit === '♥') return true;
        if (card === 'Q♠' || card === 'J♦') return true;
        return false;
      };
      const scoringCards = res.cards.filter(cardValueFor10);
      if (scoringCards.length === 0 && res.has10Clubs) {
        res.base = 50;
      } else {
        multiplier = 2; // 10♣ doubles all scoring cards
      }
    }
    res.final = res.base * multiplier;
  }

  // Step 3: Calculate team scores
  const team1Score = teams.team1.reduce((sum, socketId) => sum + (playerResults[socketId]?.final || 0), 0);
  const team2Score = teams.team2.reduce((sum, socketId) => sum + (playerResults[socketId]?.final || 0), 0);

  // Step 4: Return both individual scores (for UI) and team scores
  const individualScores = {};
  for (const socketId of Object.keys(collected)) {
    individualScores[socketId] = playerResults[socketId]?.final || 0;
  }

  return {
    individualScores,
    teamScores: { team1: team1Score, team2: team2Score },
    playerResults
  };
}

describe('Gongzhu Game Logic', () => {
  describe('Deck Creation', () => {
    it('should create a 52-card deck', () => {
      const deck = createDeck();
      assert.strictEqual(deck.length, 52);
    });

    it('should have all suits and ranks', () => {
      const deck = createDeck();
      assert(deck.includes('A♠'));
      assert(deck.includes('2♥'));
      assert(deck.includes('K♣'));
      assert(deck.includes('Q♦'));
    });
  });

  describe('Card Utilities', () => {
    it('should extract suit correctly', () => {
      assert.strictEqual(getSuit('A♠'), '♠');
      assert.strictEqual(getSuit('10♥'), '♥');
    });

    it('should extract rank correctly', () => {
      assert.strictEqual(getRank('A♠'), 12); // A is highest
      assert.strictEqual(getRank('2♠'), 0);  // 2 is lowest
      assert.strictEqual(getRank('10♠'), 8);
    });
  });

  describe('Trick Winner Determination', () => {
    it('should determine winner by highest card of led suit', () => {
      const trick = [
        { player: 'player1', card: '5♠' },
        { player: 'player2', card: 'A♥' }, // Different suit
        { player: 'player3', card: 'K♠' }, // Higher spade
        { player: 'player4', card: '7♠' }
      ];
      assert.strictEqual(determineTrickWinner(trick), 'player3');
    });

    it('should ignore off-suit cards', () => {
      const trick = [
        { player: 'player1', card: '5♠' },
        { player: 'player2', card: 'A♥' }, // Higher but wrong suit
        { player: 'player3', card: '7♠' }, // Higher spade wins
        { player: 'player4', card: 'K♦' }  // Higher but wrong suit
      ];
      assert.strictEqual(determineTrickWinner(trick), 'player3');
    });
  });

  describe('Team-based Scoring', () => {
    const mockTeams = {
      team1: ['player1', 'player3'],
      team2: ['player2', 'player4']
    };

    it('should calculate individual scores correctly', () => {
      const collected = {
        'player1': ['A♥', 'K♥', 'Q♥', 'J♥', '10♥'] // -50, -40, -30, -20, -10 = -150
      };
      const result = calculateTeamScores(collected, mockTeams);
      assert.strictEqual(result.individualScores['player1'], -150);
    });

    it('should calculate team scores correctly', () => {
      const collected = {
        'player1': ['A♥', 'K♥'], // -90 points (team1)
        'player2': ['Q♠'],       // -100 points (team2)  
        'player3': ['J♦'],       // +100 points (team1)
        'player4': ['10♣']       // +50 points (team2)
      };
      
      const result = calculateTeamScores(collected, mockTeams);
      
      // Team 1: player1 (-90) + player3 (+100) = +10
      // Team 2: player2 (-100) + player4 (+50) = -50
      assert.strictEqual(result.teamScores.team1, 10);
      assert.strictEqual(result.teamScores.team2, -50);
    });

    it('should handle Queen of Spades correctly', () => {
      const collected = {
        'player1': ['Q♠'] // -100
      };
      const result = calculateTeamScores(collected, mockTeams);
      assert.strictEqual(result.individualScores['player1'], -100);
    });

    it('should handle Jack of Diamonds correctly', () => {
      const collected = {
        'player1': ['J♦'] // +100
      };
      const result = calculateTeamScores(collected, mockTeams);
      assert.strictEqual(result.individualScores['player1'], 100);
    });

    it('should handle shooting the moon', () => {
      const allHearts = ['A♥', 'K♥', 'Q♥', 'J♥', '10♥', '9♥', '8♥', '7♥', '6♥', '5♥', '4♥', '3♥', '2♥'];
      const collected = {
        'player1': allHearts
      };
      const result = calculateTeamScores(collected, mockTeams);
      assert.strictEqual(result.individualScores['player1'], 200);
      assert.strictEqual(result.teamScores.team1, 200);
    });

    it('should handle 10 of Clubs doubling', () => {
      const collected = {
        'player1': ['A♥', '10♣'] // -50 * 2 = -100
      };
      const result = calculateTeamScores(collected, mockTeams);
      assert.strictEqual(result.individualScores['player1'], -100);
    });

    it('should handle 10 of Clubs alone', () => {
      const collected = {
        'player1': ['10♣'] // +50 when alone
      };
      const result = calculateTeamScores(collected, mockTeams);
      assert.strictEqual(result.individualScores['player1'], 50);
    });

    it('should return individual scores keyed by socket.id (not handle)', () => {
      // Set up mock players with handles
      mockPlayers.set('socket1', 'Alice');
      mockPlayers.set('socket2', 'Bob');
      
      const collected = {
        'socket1': ['A♥', 'K♥'], // -90 points
        'socket2': ['Q♠']        // -100 points
      };
      
      const teams = {
        team1: ['socket1'],
        team2: ['socket2']
      };
      
      const result = calculateTeamScores(collected, teams);
      
      // Individual scores should be keyed by socket.id, not handle
      assert.strictEqual(result.individualScores['socket1'], -90);
      assert.strictEqual(result.individualScores['socket2'], -100);
      assert.strictEqual(result.individualScores['Alice'], undefined);
      assert.strictEqual(result.individualScores['Bob'], undefined);
      
      // Clean up
      mockPlayers.clear();
    });

    it('should handle complex team scoring scenario', () => {
      const collected = {
        'player1': ['A♥', 'K♥', 'Q♥'],  // -120 points (team1)
        'player2': ['Q♠'],             // -100 points (team2)  
        'player3': ['J♦'],             // +100 points (team1)
        'player4': ['10♣']             // +50 points (team2)
      };
      
      const result = calculateTeamScores(collected, mockTeams);
      
      // Individual scores
      assert.strictEqual(result.individualScores['player1'], -120);
      assert.strictEqual(result.individualScores['player2'], -100);
      assert.strictEqual(result.individualScores['player3'], 100);
      assert.strictEqual(result.individualScores['player4'], 50);
      
      // Team scores
      // Team 1: -120 + 100 = -20
      // Team 2: -100 + 50 = -50
      assert.strictEqual(result.teamScores.team1, -20);
      assert.strictEqual(result.teamScores.team2, -50);
    });
  });
});

module.exports = {
  createDeck,
  getSuit,
  getRank,
  determineTrickWinner,
  calculateTeamScores
};