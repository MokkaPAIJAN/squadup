const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Users waiting to be matched
let waitingQueue = [];
// Map of socket.id -> partner socket.id
let partners = {};
// Map of socket.id -> username
let usernames = {};

function removeFromQueue(socketId) {
  waitingQueue = waitingQueue.filter((id) => id !== socketId);
}

function tryMatch(socket) {
  removeFromQueue(socket.id);

  if (waitingQueue.length > 0) {
    const partnerId = waitingQueue.shift();
    const partnerSocket = io.sockets.sockets.get(partnerId);

    if (partnerSocket) {
      partners[socket.id] = partnerId;
      partners[partnerId] = socket.id;

      // socket.id will be the "initiator" who creates the WebRTC offer
      socket.emit('matched', {
        partnerName: usernames[partnerId] || 'Stranger',
        initiator: true,
      });
      partnerSocket.emit('matched', {
        partnerName: usernames[socket.id] || 'Stranger',
        initiator: false,
      });
      return;
    }
  }

  // No one available, wait
  waitingQueue.push(socket.id);
  socket.emit('waiting');
}

io.on('connection', (socket) => {
  socket.on('set-username', (name) => {
    usernames[socket.id] = (name || 'Stranger').toString().slice(0, 24);
    tryMatch(socket);
  });

  // Relay WebRTC signaling data to whichever partner this socket has
  socket.on('signal', (data) => {
    const partnerId = partners[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('signal', data);
    }
  });

  // Relay text chat messages
  socket.on('chat-message', (msg) => {
    const partnerId = partners[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('chat-message', {
        text: (msg || '').toString().slice(0, 1000),
        from: usernames[socket.id] || 'Stranger',
      });
    }
  });

  // User clicks "Next" to skip current partner and find someone new
  socket.on('next', () => {
    const partnerId = partners[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('partner-left');
      delete partners[partnerId];
      delete partners[socket.id];
      tryMatch(io.sockets.sockets.get(partnerId));
    }
    tryMatch(socket);
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket.id);
    const partnerId = partners[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('partner-left');
      delete partners[partnerId];
    }
    delete partners[socket.id];
    delete usernames[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
