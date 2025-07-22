const WebSocket = require('ws');
const http = require('http');
const server = http.createServer();
const wss = new WebSocket.Server({ server });

// Game state management
const rooms = new Map();
const players = new Map();

// Track all connected clients
const onlineClients = new Set();

// Generate random room codes
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
  onlineClients.add(ws);
  broadcastOnlineCount();
  console.log('New client connected');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleMessage(ws, data);
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });
  
  ws.on('close', () => {
    onlineClients.delete(ws);
    broadcastOnlineCount();
    handlePlayerDisconnect(ws);
  });
});

function broadcastOnlineCount() {
  const countMsg = JSON.stringify({ type: 'online_count', count: onlineClients.size });
  for (const client of onlineClients) {
    if (client.readyState === 1) {
      client.send(countMsg);
    }
  }
}

function handleMessage(ws, data) {
  switch (data.type) {
    case 'join':
      handleJoinRoom(ws, data);
      break;
    case 'make_move':
      handleMakeMove(ws, data);
      break;
    case 'chat':
      handleChat(ws, data);
      break;
    case 'leave_room':
      handleLeaveRoom(ws, data);
      break;
  }
}

function handleJoinRoom(ws, data) {
  const { playerName, roomCode } = data;
  
  // Store player info
  players.set(ws, { name: playerName, roomCode: null });
  
  let targetRoomCode = roomCode;
  
  // If no room code provided, create new room
  if (!targetRoomCode) {
    targetRoomCode = generateRoomCode();
    rooms.set(targetRoomCode, {
      players: [],
      game: null,
      currentTurn: null
    });
  }
  
  // Check if room exists
  if (!rooms.has(targetRoomCode)) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Room not found'
    }));
    return;
  }
  
  const room = rooms.get(targetRoomCode);
  
  // Check if room is full
  if (room.players.length >= 2) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Room is full'
    }));
    return;
  }
  
  // Add player to room
  const playerColor = room.players.length === 0 ? 'w' : 'b';
  const player = { ws, name: playerName, color: playerColor };
  room.players.push(player);
  players.set(ws, { name: playerName, roomCode: targetRoomCode });
  
  // Send room joined confirmation
  ws.send(JSON.stringify({
    type: 'room_joined',
    roomCode: targetRoomCode,
    color: playerColor,
    opponentName: room.players.length > 1 ? room.players[0].name : null
  }));
  
  // Notify other player
  if (room.players.length > 1) {
    room.players[0].ws.send(JSON.stringify({
      type: 'opponent_joined',
      opponentName: playerName
    }));
    
    // Start the game
    const Chess = require('chess.js').Chess;
    room.game = new Chess();
    room.currentTurn = 'w';
    
    // Notify both players that game has started
    room.players.forEach((p, index) => {
      p.ws.send(JSON.stringify({
        type: 'game_start',
        firstPlayer: room.players[0].name
      }));
    });
  }
}

function handleMakeMove(ws, data) {
  const player = players.get(ws);
  if (!player || !player.roomCode) return;
  
  const room = rooms.get(player.roomCode);
  if (!room || !room.game) return;
  
  // Validate it's the player's turn
  const currentPlayer = room.players.find(p => p.ws === ws);
  if (!currentPlayer || room.game.turn() !== currentPlayer.color) return;
  
  try {
    // Make the move
    const result = room.game.move(data.move);
    if (result) {
      // Broadcast move to all players in room
      room.players.forEach(p => {
        p.ws.send(JSON.stringify({
          type: 'move_made',
          playerName: currentPlayer.name,
          move: data.move
        }));
      });
      
      // Check for game over
      if (room.game.game_over()) {
        let result = 'Draw';
        if (room.game.in_checkmate()) {
          result = `${currentPlayer.name} wins by checkmate!`;
        } else if (room.game.in_stalemate()) {
          result = 'Draw by stalemate';
        } else if (room.game.in_threefold_repetition()) {
          result = 'Draw by repetition';
        } else if (room.game.insufficient_material()) {
          result = 'Draw by insufficient material';
        }
        
        room.players.forEach(p => {
          p.ws.send(JSON.stringify({
            type: 'game_over',
            result: result
          }));
        });
      }
    }
  } catch (error) {
    console.error('Invalid move:', error);
  }
}

function handleChat(ws, data) {
  const player = players.get(ws);
  if (!player || !player.roomCode) return;
  
  const room = rooms.get(player.roomCode);
  if (!room) return;
  
  // Broadcast chat message to all players in room
  room.players.forEach(p => {
    p.ws.send(JSON.stringify({
      type: 'chat_message',
      playerName: player.name,
      message: data.message
    }));
  });
}

function handleLeaveRoom(ws, data) {
  const player = players.get(ws);
  if (!player || !player.roomCode) return;
  
  const room = rooms.get(player.roomCode);
  if (!room) return;
  
  // Remove player from room
  room.players = room.players.filter(p => p.ws !== ws);
  
  // Notify other players
  room.players.forEach(p => {
    p.ws.send(JSON.stringify({
      type: 'opponent_left'
    }));
  });
  
  // Clean up room if empty
  if (room.players.length === 0) {
    rooms.delete(player.roomCode);
  }
  
  // Clean up player
  players.delete(ws);
}

function handlePlayerDisconnect(ws) {
  const player = players.get(ws);
  if (player && player.roomCode) {
    handleLeaveRoom(ws, { roomCode: player.roomCode });
  }
  players.delete(ws);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chess server running on port ${PORT}`);
}); 