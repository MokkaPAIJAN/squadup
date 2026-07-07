const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Database ----
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('MongoDB connection error:', err.message));
} else {
  console.warn('MONGODB_URI is not set — login/profile features will not work.');
}

// ---- Auth helpers ----
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const COOKIE_NAME = 'squadup_token';
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60 * 1000; // 90 days, in milliseconds

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '90d' });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
  });
}

// Attaches req.userId if a valid login cookie is present; does not block the request either way.
async function attachUser(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.userId = payload.userId;
    } catch (e) {
      // invalid/expired token, treat as logged out
    }
  }
  next();
}
app.use(attachUser);

// Blocks the request unless logged in
function requireAuth(req, res, next) {
  if (!req.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

// ---- Auth routes ----

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are all required.' });
    }
    if (username.length < 3 || username.length > 24) {
      return res.status(400).json({ error: 'Username must be 3-24 characters.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = await User.findOne({
      $or: [{ email: email.toLowerCase().trim() }, { username: username.trim() }],
    });
    if (existing) {
      return res.status(409).json({ error: 'Username or email is already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
    });

    const token = signToken(user._id.toString());
    setAuthCookie(res, token);
    res.json({
      user: { id: user._id, username: user.username, bio: user.bio, favoriteGames: user.favoriteGames },
    });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Something went wrong creating your account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    const token = signToken(user._id.toString());
    setAuthCookie(res, token);
    res.json({
      user: { id: user._id, username: user.username, bio: user.bio, favoriteGames: user.favoriteGames },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Something went wrong logging in.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.userId) {
    return res.json({ user: null });
  }
  try {
    const user = await User.findById(req.userId).select('-passwordHash');
    if (!user) return res.json({ user: null });
    res.json({
      user: { id: user._id, username: user.username, bio: user.bio, favoriteGames: user.favoriteGames },
    });
  } catch (err) {
    res.json({ user: null });
  }
});

app.put('/api/profile', requireAuth, async (req, res) => {
  try {
    const { bio, favoriteGames } = req.body || {};
    const update = {};
    if (typeof bio === 'string') update.bio = bio.slice(0, 200);
    if (Array.isArray(favoriteGames)) {
      update.favoriteGames = favoriteGames.slice(0, 10).map((g) => String(g).slice(0, 30));
    }

    const user = await User.findByIdAndUpdate(req.userId, update, { new: true }).select('-passwordHash');
    res.json({
      user: { id: user._id, username: user.username, bio: user.bio, favoriteGames: user.favoriteGames },
    });
  } catch (err) {
    console.error('Profile update error:', err.message);
    res.status(500).json({ error: 'Could not update profile.' });
  }
});

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
