const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const METERED_DOMAIN = 'squadup.metered.live';
const METERED_SECRET_KEY = process.env.METERED_SECRET_KEY;

// The browser calls this to get short-lived TURN credentials.
// The secret key itself stays on the server and is never sent to the browser.
app.get('/api/turn-credentials', async (req, res) => {
  try {
    if (!METERED_SECRET_KEY) {
      throw new Error('METERED_SECRET_KEY is not set on the server');
    }
    const response = await fetch(
      `https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${METERED_SECRET_KEY}`
    );
    if (!response.ok) {
      throw new Error(`Metered API responded with ${response.status}`);
    }
    const iceServers = await response.json();
    res.json({ iceServers });
  } catch (err) {
    console.error('Failed to fetch TURN credentials:', err.message);
    // Fall back to public STUN-only servers so the app doesn't crash;
    // direct connections on the same network will still work.
    res.json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
  }
});

const VALID_MODES = ['video', 'voice', 'text'];

// One waiting queue PER mode, so people only match with others in the same mode
let waitingQueues = {
  video: [],
  voice: [],
  text: [],
};

// Map of socket.id -> partner socket.id
let partners = {};
// Map of socket.id -> username
let usernames = {};
// Map of socket.id -> mode ('video' | 'voice' | 'text')
let modes = {};

function removeFromQueue(socketId) {
  const mode = modes[socketId];
  if (mode && waitingQueues[mode]) {
    waitingQueues[mode] = waitingQueues[mode].filter((id) => id !== socketId);
  }
}

function tryMatch(socket) {
  const mode = modes[socket.id];
  if (!mode) return;

  removeFromQueue(socket.id);
  const queue = waitingQueues[mode];

  if (queue.length > 0) {
    const partnerId = queue.shift();
    const partnerSocket = io.sockets.sockets.get(partnerId);

    if (partnerSocket) {
      partners[socket.id] = partnerId;
      partners[partnerId] = socket.id;

      // socket.id will be the "initiator" who creates the WebRTC offer (video/voice only)
      socket.emit('matched', {
        partnerName: usernames[partnerId] || 'Stranger',
        initiator: true,
        mode,
      });
      partnerSocket.emit('matched', {
        partnerName: usernames[socket.id] || 'Stranger',
        initiator: false,
        mode,
      });
      return;
    }
  }

  // No one available in this mode yet, wait
  queue.push(socket.id);
  socket.emit('waiting', { mode });
}

io.on('connection', (socket) => {
  socket.on('set-username', ({ name, mode } = {}) => {
    if (!VALID_MODES.includes(mode)) mode = 'text';
    usernames[socket.id] = (name || 'Stranger').toString().slice(0, 24);
    modes[socket.id] = mode;
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

  // User clicks "Next" to skip current partner and find someone new (same mode)
  socket.on('next', () => {
    const partnerId = partners[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('partner-left');
      delete partners[partnerId];
      delete partners[socket.id];
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) tryMatch(partnerSocket);
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
    delete modes[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
