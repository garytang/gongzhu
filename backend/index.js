const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Gongzhu backend is running!');
});

// --- Player and Lobby Management ---
const players = new Map(); // socket.id -> handle

function broadcastPlayerList() {
  const playerList = Array.from(players.entries()).map(([socketId, handle]) => ({
    playerId: socketId,
    handle: handle
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

function startNewGame() {
  const playerIds = Array.from(players.keys());
  const playerHandles = playerIds.map(id => ({
    playerId: id,
    handle: players.get(id)
  }));
  const deck = createDeck();
  shuffle(deck);
  const hands = {};
  for (let i = 0; i < playerIds.length; i++) {
    hands[playerIds[i]] = deck.slice(i * 13, (i + 1) * 13);
  }
  game = {
    playerOrder: playerIds,
    playerHandles,
    hands,
    trick: [],
    turn: 0, // index in playerOrder
    scores: Object.fromEntries(playerHandles.map(p => [p.playerId, 0])),
    collected: Object.fromEntries(playerIds.map(id => [id, []])), // cards won by each player (keyed by socket id)
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
  });
  console.log('Broadcasted game state:', {
    trick: game.trick,
    turn: game.turn,
    playerHandles: game.playerHandles,
    scores: game.scores,
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
  const playerIdx = game.playerOrder.indexOf(socket.id);
  if (playerIdx !== game.turn) return false; // Not this player's turn
  if (!game.hands[socket.id] || !game.hands[socket.id].includes(card)) return false; // Card not in hand
  // Suit-following validation
  if (game.trick.length > 0) {
    const ledSuit = getSuit(game.trick[0].card);
    const hand = game.hands[socket.id];
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

function calculateFinalScores(collected, exposures = {}) {
  // collected: { socketId: [cards] }
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

  // Step 1: Tally base points and special cards
  const results = {};
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
    // Check for all hearts
    const allHeartRanks = new Set(['A','K','Q','J','10','9','8','7','6','5','4','3','2']);
    if ([...allHeartRanks].every(r => heartRanks.has(r))) {
      // Shooting the moon
      base = 200;
      if (hasQSpades) base += 100; // Q♠ is +100 if all hearts
      if (hasJDiamonds) base += 100; // J♦ is +100 as usual
      // 10♣ and exposures handled below
    }
    results[handle] = {
      base,
      hasQSpades,
      hasJDiamonds,
      has10Clubs,
      hearts,
      heartRanks,
      cards,
    };
  }

  // Step 2: Apply 10♣ doubling/quadrupling and exposures (not implemented yet)
  for (const [handle, res] of Object.entries(results)) {
    let multiplier = 1;
    if (res.has10Clubs) {
      // If 10♣ and no other scoring cards: +50
      const cardValueFor10 = card => {
        const [rank, suit] = [card.slice(0, -1), card.slice(-1)];
        if (suit === '♥') return true;
        if (card === 'Q♠' || card === 'J♦') return true;
        return false;
      };
      const scoringCards = res.cards.filter(cardValueFor10);
      if (scoringCards.length === 1 && res.has10Clubs) {
        res.base = 50;
      } else {
        multiplier = 2; // 10♣ doubles all scoring cards
      }
    }
    // Exposures: not implemented (future feature)
    res.final = res.base * multiplier;
  }

  // Step 3: Return final scores
  const finalScores = {};
  for (const [handle, res] of Object.entries(results)) {
    finalScores[handle] = res.final;
  }
  return finalScores;
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

  // Check for end of game (all hands empty)
  const allEmpty = Object.values(game.hands).every(hand => hand.length === 0);
  if (allEmpty) {
    // Calculate final scores
    console.log('Collected cards at game end:', JSON.stringify(game.collected, null, 2));
    const finalScores = calculateFinalScores(game.collected);
    console.log('Computed final scores:', JSON.stringify(finalScores, null, 2));
    // Emit collected cards by handle for game over display
    const collectedByHandle = Object.fromEntries(
      Object.entries(game.collected).map(([sid, cards]) => [players.get(sid) || sid, cards])
    );
    io.emit('game_over', { scores: finalScores, collected: collectedByHandle });
    console.log('Game over! Final scores:', finalScores);
  }

  // Broadcast updated hands and game state
  for (const pid of game.playerOrder) {
    io.to(pid).emit('deal_hand', game.hands[pid]);
  }
  broadcastGameState();
}

function advanceTurn() {
  if (!game) return;
  game.turn = (game.turn + 1) % game.playerOrder.length;
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('register_handle', (data) => {
    const handle = typeof data === 'string' ? data : data.handle;
    players.set(socket.id, handle);
    console.log(`Registered handle: ${handle} (socket.id: ${socket.id})`);
    broadcastPlayerList();
    console.log('Current players map:', Array.from(players.entries()));
  });

  socket.on('start_game', () => {
    console.log('Received start_game event from', socket.id);
    if (players.size === 4) {
      io.emit('game_started');
      console.log('Game started!');
      // --- Card dealing and game state ---
      const g = startNewGame();
      // Send each player their hand privately
      for (const pid of g.playerOrder) {
        io.to(pid).emit('deal_hand', g.hands[pid]);
        console.log(`Dealt hand to ${players.get(pid)} (${pid}):`, g.hands[pid]);
      }
      broadcastGameState();
    } else {
      console.log('Not enough players to start game:', players.size);
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
      io.to(pid).emit('deal_hand', game.hands[pid]);
    }
    broadcastGameState();
    // If trick is complete (4 cards), resolve trick
    if (game.trick.length === 4) {
      handleTrickCompletion();
    } else {
      advanceTurn();
      // Broadcast updated hands and game state after advancing turn
      for (const pid of game.playerOrder) {
        io.to(pid).emit('deal_hand', game.hands[pid]);
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