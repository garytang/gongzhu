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
  const playerList = Array.from(players.values());
  console.log('Broadcasting player list:', playerList);
  io.emit('player_list', playerList);
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('register_handle', (handle) => {
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
    } else {
      console.log('Not enough players to start game:', players.size);
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