const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    credentials: false
  },
  transports: ['websocket', 'polling']
});

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Gongzhu backend is running!');
});

// --- Player and Lobby Management ---
const players = new Map(); // socket.id -> handle
const bots = new Map(); // botId -> { handle, difficulty, socketId }

// Bot player class for future AI expansion
class BotPlayer {
  constructor(id, difficulty = 'easy') {
    this.id = id;
    this.handle = `Bot ${id.slice(-4)}`;
    this.difficulty = difficulty;
    this.socketId = `bot_${id}`;
  }

  // Simple AI card selection - can be enhanced later
  selectCard(hand, trick, gameState) {
    const validCards = this.getValidCards(hand, trick);
    
    switch (this.difficulty) {
      case 'hard':
        return this.selectCardHard(validCards, trick, gameState);
      case 'medium':
        return this.selectCardMedium(validCards, trick, gameState);
      case 'easy':
      default:
        return this.selectCardEasy(validCards);
    }
  }

  getValidCards(hand, trick) {
    if (trick.length === 0) {
      return hand; // Can play any card if leading
    }
    
    const ledSuit = getSuit(trick[0].card);
    const suitCards = hand.filter(card => getSuit(card) === ledSuit);
    return suitCards.length > 0 ? suitCards : hand;
  }

  selectCardEasy(validCards) {
    // Random selection for easy difficulty
    return validCards[Math.floor(Math.random() * validCards.length)];
  }

  selectCardMedium(validCards, trick, gameState) {
    // Slightly smarter: avoid high hearts and Q♠ when possible
    const dangerousCards = validCards.filter(card => 
      (card.endsWith('♥') && ['A', 'K', 'Q', 'J'].includes(card.slice(0, -1))) ||
      card === 'Q♠'
    );
    
    const safeCards = validCards.filter(card => !dangerousCards.includes(card));
    
    if (safeCards.length > 0 && trick.length < 3) {
      return safeCards[Math.floor(Math.random() * safeCards.length)];
    }
    
    return validCards[Math.floor(Math.random() * validCards.length)];
  }

  selectCardHard(validCards, trick, gameState) {
    // More sophisticated logic can be added here
    // For now, same as medium but with preference for J♦ when safe
    if (validCards.includes('J♦') && trick.length === 3) {
      return 'J♦'; // Try to win J♦ on last card
    }
    
    return this.selectCardMedium(validCards, trick, gameState);
  }
}

let botIdCounter = 0;

function createBot(difficulty = 'easy') {
  const botId = `bot_${Date.now()}_${botIdCounter++}`;
  const bot = new BotPlayer(botId, difficulty);
  bots.set(bot.socketId, bot);
  
  // Add bot to players map with its socketId
  players.set(bot.socketId, bot.handle);
  
  console.log(`Created bot: ${bot.handle} (${bot.socketId}) - ${difficulty} difficulty`);
  return bot;
}

function removeAllBots() {
  for (const [socketId, bot] of bots.entries()) {
    players.delete(socketId);
    bots.delete(socketId);
  }
  console.log('Removed all bots');
}

function isBot(socketId) {
  return bots.has(socketId);
}

function broadcastPlayerList() {
  const playerList = Array.from(players.entries()).map(([socketId, handle]) => ({
    playerId: socketId,
    handle: handle,
    isBot: isBot(socketId)
  }));
  console.log('Broadcasting player list:', playerList);
  io.emit('player_list', playerList);
}

const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

let game = null;

function assignTeams(playerIds) {
  // Shuffle players for random team assignment
  const shuffledPlayers = [...playerIds];
  shuffle(shuffledPlayers);
  
  // Assign teams randomly
  const team1 = [shuffledPlayers[0], shuffledPlayers[1]];
  const team2 = [shuffledPlayers[2], shuffledPlayers[3]];
  
  return {
    team1,
    team2
  };
}

function arrangePlayersForTurnOrder(teams) {
  // Arrange players so teammates are not adjacent
  // Pattern: team1[0], team2[0], team1[1], team2[1]
  return [teams.team1[0], teams.team2[0], teams.team1[1], teams.team2[1]];
}

function startNewGame(continueGame = false) {
  // Get human players (non-bot players)
  const humanPlayerIds = Array.from(players.keys()).filter(id => !isBot(id));
  
  // Auto-fill with bots if needed
  const neededBots = 4 - humanPlayerIds.length;
  if (neededBots > 0 && !continueGame) {
    console.log(`Adding ${neededBots} bots to fill the game`);
    for (let i = 0; i < neededBots; i++) {
      createBot('easy');
    }
  }
  
  const playerIds = Array.from(players.keys());
  
  // Preserve teams if continuing, otherwise assign new teams
  let teams;
  let cumulativeTeamScores;
  let arrangedPlayerOrder;
  
  if (continueGame && game && game.teams) {
    teams = game.teams;
    cumulativeTeamScores = game.cumulativeTeamScores;
    // Maintain the same turn order when continuing
    arrangedPlayerOrder = game.playerOrder;
  } else {
    teams = assignTeams(playerIds);
    cumulativeTeamScores = { team1: 0, team2: 0 };
    // Arrange players so teammates are not adjacent
    arrangedPlayerOrder = arrangePlayersForTurnOrder(teams);
  }
  
  const playerHandles = arrangedPlayerOrder.map(id => ({
    playerId: id,
    handle: players.get(id)
  }));
  
  const deck = createDeck();
  shuffle(deck);
  const hands = {};
  for (let i = 0; i < arrangedPlayerOrder.length; i++) {
    hands[arrangedPlayerOrder[i]] = deck.slice(i * 13, (i + 1) * 13);
  }
  game = {
    playerOrder: arrangedPlayerOrder,
    playerHandles,
    hands,
    trick: [],
    turn: 0, // index in playerOrder
    scores: Object.fromEntries(playerHandles.map(p => [p.playerId, 0])),
    collected: Object.fromEntries(arrangedPlayerOrder.map(id => [id, []])), // cards won by each player (keyed by socket id)
    teams,
    cumulativeTeamScores,
    started: true,
  };
  return game;
}

function broadcastGameState() {
  if (!game) return;
  io.emit('game_state', {
    trick: game.trick,
    turn: game.turn,
    playerHandles: game.playerHandles,
    scores: game.scores,
    teams: game.teams,
    cumulativeTeamScores: game.cumulativeTeamScores,
  });
  console.log('Broadcasted game state:', {
    trick: game.trick,
    turn: game.turn,
    playerHandles: game.playerHandles,
    scores: game.scores,
    teams: game.teams,
    cumulativeTeamScores: game.cumulativeTeamScores,
  });
}

function getSuit(card) {
  return card.slice(-1);
}

function getRank(card) {
  const rank = card.slice(0, -1);
  return RANKS.indexOf(rank);
}

function isValidPlay(socket, card) {
  if (!game) return false;
  const playerId = socket.id || socket; // Handle both socket object and direct ID for bots
  const playerIdx = game.playerOrder.indexOf(playerId);
  if (playerIdx !== game.turn) return false; // Not this player's turn
  if (!game.hands[playerId] || !game.hands[playerId].includes(card)) return false; // Card not in hand
  // Suit-following validation
  if (game.trick.length > 0) {
    const ledSuit = getSuit(game.trick[0].card);
    const hand = game.hands[playerId];
    const hasLedSuit = hand.some(c => getSuit(c) === ledSuit);
    if (getSuit(card) !== ledSuit && hasLedSuit) {
      return false; // Must follow suit if possible
    }
  }
  return true;
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
  return trick[highestIdx].player; // Return socket ID of winner
}

function scoreTrick(cards) {
  // No longer used for final scoring; kept for possible UI feedback or trick display
  return 0;
}

function calculateTeamScores(collected, teams, exposures = {}) {
  // collected: { socketId: [cards] }
  // teams: { team1: [socketId1, socketId2], team2: [socketId3, socketId4] }
  // exposures: { handle: { 'A♥': true, ... } }
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
    // 10♣ handled separately
    return 0;
  };

  // Step 1: Calculate individual player results
  const playerResults = {};
  for (const [socketId, cards] of Object.entries(collected)) {
    const handle = players.get(socketId) || socketId;
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
      if (hasQSpades) base += 100; // Q♠ is +100 if all hearts
      if (hasJDiamonds) base += 100; // J♦ is +100 as usual
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

function handleTrickCompletion() {
  if (!game) return;
  const trick = game.trick;
  console.log('Trick completed:', trick);
  // Determine winner by suit and rank
  const winnerId = determineTrickWinner(trick);
  if (winnerId) {
    game.turn = game.playerOrder.indexOf(winnerId);
    const winnerHandle = players.get(winnerId);
    console.log('Trick winner:', winnerHandle, `(socket.id: ${winnerId})`);
    // Add trick cards to winner's collection (keyed by socket id)
    game.collected[winnerId].push(...trick.map(t => t.card));
    // No per-trick scoring
  }
  game.trick = [];

  // Emit collected cards (by socket id for frontend to use with playerId)
  io.emit('collected', game.collected);

  // Check for end of round (all hands empty)
  const allEmpty = Object.values(game.hands).every(hand => hand.length === 0);
  if (allEmpty) {
    console.log('Collected cards at round end:', JSON.stringify(game.collected, null, 2));
    
    // Calculate team scores for this round
    const scoreResults = calculateTeamScores(game.collected, game.teams);
    console.log('Round score results:', JSON.stringify(scoreResults, null, 2));
    
    // Update cumulative team scores
    game.cumulativeTeamScores.team1 += scoreResults.teamScores.team1;
    game.cumulativeTeamScores.team2 += scoreResults.teamScores.team2;
    
    console.log('Updated cumulative team scores:', game.cumulativeTeamScores);
    
    // Check for game end conditions (reach +1000 or -1000)
    const team1Wins = game.cumulativeTeamScores.team1 >= 1000 || game.cumulativeTeamScores.team2 <= -1000;
    const team2Wins = game.cumulativeTeamScores.team2 >= 1000 || game.cumulativeTeamScores.team1 <= -1000;
    const gameEnded = team1Wins || team2Wins;
    
    // Emit collected cards by handle for game over display
    const collectedByHandle = Object.fromEntries(
      Object.entries(game.collected).map(([sid, cards]) => [players.get(sid) || sid, cards])
    );
    
    // Prepare team information for the frontend
    const teamInfo = {
      team1: {
        players: game.teams.team1.map(sid => players.get(sid) || sid),
        roundScore: scoreResults.teamScores.team1,
        cumulativeScore: game.cumulativeTeamScores.team1
      },
      team2: {
        players: game.teams.team2.map(sid => players.get(sid) || sid),
        roundScore: scoreResults.teamScores.team2,
        cumulativeScore: game.cumulativeTeamScores.team2
      }
    };
    
    io.emit('game_over', { 
      scores: scoreResults.individualScores, 
      collected: collectedByHandle,
      teamInfo,
      gameEnded,
      winningTeam: team1Wins ? 1 : (team2Wins ? 2 : null)
    });
    
    console.log('Round over! Team info:', teamInfo);
    if (gameEnded) {
      console.log('Game ended! Winning team:', team1Wins ? 1 : 2);
    }
  } else {
    // Continue the game - check if the next player is a bot
    const currentPlayerId = game.playerOrder[game.turn];
    if (isBot(currentPlayerId)) {
      setTimeout(() => {
        handleBotTurn();
      }, 1500); // Slightly longer delay after trick completion
    }
  }

  // Broadcast updated hands and game state
  for (const pid of game.playerOrder) {
    if (!isBot(pid)) {
      io.to(pid).emit('deal_hand', game.hands[pid]);
    }
  }
  broadcastGameState();
}

function advanceTurn() {
  if (!game) return;
  game.turn = (game.turn + 1) % game.playerOrder.length;
  
  // Check if it's a bot's turn and handle it automatically
  const currentPlayerId = game.playerOrder[game.turn];
  if (isBot(currentPlayerId)) {
    setTimeout(() => {
      handleBotTurn();
    }, 1000); // 1 second delay to make bot plays feel more natural
  }
}

function handleBotTurn() {
  if (!game) return;
  
  const currentPlayerId = game.playerOrder[game.turn];
  const bot = bots.get(currentPlayerId);
  
  if (!bot) return; // Not a bot's turn
  
  console.log(`Bot ${bot.handle} is taking turn`);
  
  const hand = game.hands[currentPlayerId];
  const selectedCard = bot.selectCard(hand, game.trick, game);
  
  console.log(`Bot ${bot.handle} plays: ${selectedCard}`);
  
  // Simulate the card play
  if (isValidPlay(currentPlayerId, selectedCard)) {
    // Remove card from bot's hand
    game.hands[currentPlayerId] = game.hands[currentPlayerId].filter(c => c !== selectedCard);
    // Add to trick
    game.trick.push({ player: currentPlayerId, card: selectedCard });
    
    // Broadcast updated hands and game state
    for (const pid of game.playerOrder) {
      if (!isBot(pid)) {
        io.to(pid).emit('deal_hand', game.hands[pid]);
      }
    }
    broadcastGameState();
    
    // Handle trick completion or advance turn
    if (game.trick.length === 4) {
      handleTrickCompletion();
    } else {
      advanceTurn();
      // Broadcast updated hands and game state after advancing turn
      for (const pid of game.playerOrder) {
        if (!isBot(pid)) {
          io.to(pid).emit('deal_hand', game.hands[pid]);
        }
      }
      broadcastGameState();
    }
  }
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  
  // Broadcast current player list to new connection
  broadcastPlayerList();

  socket.on('register_handle', (data) => {
    const handle = typeof data === 'string' ? data : data.handle;
    players.set(socket.id, handle);
    console.log(`Registered handle: ${handle} (socket.id: ${socket.id})`);
    broadcastPlayerList();
    console.log('Current players map:', Array.from(players.entries()));
  });

  socket.on('start_game', () => {
    console.log('Received start_game event from', socket.id);
    const humanPlayers = Array.from(players.keys()).filter(id => !isBot(id));
    
    if (humanPlayers.length >= 1) {
      // Remove existing bots before starting new game
      removeAllBots();
      broadcastPlayerList();
      
      io.emit('game_started');
      console.log('Game started!');
      // --- Card dealing and game state ---
      const g = startNewGame(false); // New game with new teams
      // Send each player their hand privately (only to human players)
      for (const pid of g.playerOrder) {
        if (!isBot(pid)) {
          io.to(pid).emit('deal_hand', g.hands[pid]);
          console.log(`Dealt hand to ${players.get(pid)} (${pid}):`, g.hands[pid]);
        }
      }
      broadcastGameState();
      
      // Start bot turn handling if first player is a bot
      setTimeout(() => {
        handleBotTurn();
      }, 1500);
    } else {
      console.log('Need at least 1 human player to start game');
    }
  });

  socket.on('continue_game', () => {
    console.log('Received continue_game event from', socket.id);
    if (players.size === 4 && game && game.teams) {
      io.emit('game_started');
      console.log('Game continued with same teams!');
      // --- Card dealing and game state ---
      const g = startNewGame(true); // Continue with same teams
      // Send each player their hand privately (only to human players)
      for (const pid of g.playerOrder) {
        if (!isBot(pid)) {
          io.to(pid).emit('deal_hand', g.hands[pid]);
          console.log(`Dealt hand to ${players.get(pid)} (${pid}):`, g.hands[pid]);
        }
      }
      broadcastGameState();
      
      // Start bot turn handling if first player is a bot
      setTimeout(() => {
        handleBotTurn();
      }, 1500);
    } else {
      console.log('Cannot continue game - not enough players or no existing game');
    }
  });

  socket.on('play_card', (card) => {
    console.log(`Received play_card from ${socket.id}: ${card}`);
    if (!game) return;
    if (!isValidPlay(socket, card)) {
      console.log('Invalid play by', socket.id, card);
      socket.emit('invalid_play', card);
      return;
    }
    // Remove card from player's hand
    game.hands[socket.id] = game.hands[socket.id].filter(c => c !== card);
    // Add to trick
    game.trick.push({ player: socket.id, card });
    // Broadcast updated hands and game state after every play
    for (const pid of game.playerOrder) {
      if (!isBot(pid)) {
        io.to(pid).emit('deal_hand', game.hands[pid]);
      }
    }
    broadcastGameState();
    // If trick is complete (4 cards), resolve trick
    if (game.trick.length === 4) {
      handleTrickCompletion();
    } else {
      advanceTurn();
      // Broadcast updated hands and game state after advancing turn
      for (const pid of game.playerOrder) {
        if (!isBot(pid)) {
          io.to(pid).emit('deal_hand', game.hands[pid]);
        }
      }
      broadcastGameState();
    }
  });

  socket.on('disconnect', () => {
    const handle = players.get(socket.id);
    players.delete(socket.id);
    console.log('User disconnected:', socket.id, handle);
    broadcastPlayerList();
    console.log('Current players map:', Array.from(players.entries()));
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 