const entryScreen = document.getElementById('entry-screen');
const modeScreen = document.getElementById('mode-screen');
const chatScreen = document.getElementById('chat-screen');
const loginScreen = document.getElementById('login-screen');
const signupScreen = document.getElementById('signup-screen');
const profileScreen = document.getElementById('profile-screen');

const usernameInput = document.getElementById('username-input');
const continueBtn = document.getElementById('continue-btn');
const modeButtons = document.querySelectorAll('.mode-btn');
const welcomeName = document.getElementById('welcome-name');
const changeNameBtn = document.getElementById('change-name-btn');
const backBtn = document.getElementById('back-btn');
const brandBtn = document.getElementById('brand-btn');
const viewProfileBtn = document.getElementById('view-profile-btn');

const showLoginBtn = document.getElementById('show-login-btn');
const showSignupBtn = document.getElementById('show-signup-btn');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const loginSubmitBtn = document.getElementById('login-submit-btn');
const loginErrorEl = document.getElementById('login-error');
const loginToSignupBtn = document.getElementById('login-to-signup-btn');
const loginBackBtn = document.getElementById('login-back-btn');

const signupUsernameInput = document.getElementById('signup-username');
const signupEmailInput = document.getElementById('signup-email');
const signupPasswordInput = document.getElementById('signup-password');
const signupSubmitBtn = document.getElementById('signup-submit-btn');
const signupErrorEl = document.getElementById('signup-error');
const signupToLoginBtn = document.getElementById('signup-to-login-btn');
const signupBackBtn = document.getElementById('signup-back-btn');

const profileUsernameEl = document.getElementById('profile-username');
const profileBioInput = document.getElementById('profile-bio');
const profileGamesInput = document.getElementById('profile-games');
const profileSaveBtn = document.getElementById('profile-save-btn');
const profileSavedMsg = document.getElementById('profile-saved-msg');
const profileBackBtn = document.getElementById('profile-back-btn');
const logoutBtn = document.getElementById('logout-btn');

const statusEl = document.getElementById('status');
const videoPane = document.getElementById('video-pane');
const voicePane = document.getElementById('voice-pane');
const remoteVideo = document.getElementById('remote-video');
const remoteLabel = document.getElementById('remote-label');
const localVideo = document.getElementById('local-video');
const voiceAvatar = document.getElementById('voice-avatar');
const voiceLabel = document.getElementById('voice-label');
const nextBtn = document.getElementById('next-btn');
const toggleCamBtn = document.getElementById('toggle-cam-btn');
const toggleMicBtn = document.getElementById('toggle-mic-btn');
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

// ICE servers are fetched from our own server (which holds the secret key),
// rather than hardcoded here. Falls back to STUN-only if the fetch fails.
let ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

async function loadIceServers() {
  try {
    const res = await fetch('/api/turn-credentials');
    const data = await res.json();
    if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      ICE_SERVERS = { iceServers: data.iceServers };
    }
  } catch (e) {
    console.error('Could not load TURN credentials, using STUN-only fallback', e);
  }
}
let iceServersReady = loadIceServers();

const NAME_KEY = 'squadup_username';

let socket = null;
let localStream = null;
let pc = null;
let myName = 'Stranger';
let partnerName = 'Stranger';
let camOn = true;
let micOn = true;
let currentMode = 'text'; // 'video' | 'voice' | 'text'
let currentUser = null; // set when logged in via a real account (not guest)

// Boosts the incoming voice/video audio above the device's normal max volume.
// Created during the mode-button click (a user gesture) so mobile browsers
// allow audio playback right away.
const VOLUME_BOOST = 2.5; // 2.5x louder than normal
let audioCtx = null;
let gainNode = null;
let audioSourceNode = null;

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = VOLUME_BOOST;
    gainNode.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playBoostedAudio(stream) {
  ensureAudioContext();
  if (audioSourceNode) {
    audioSourceNode.disconnect();
  }
  audioSourceNode = audioCtx.createMediaStreamSource(stream);
  audioSourceNode.connect(gainNode);
}

function stopBoostedAudio() {
  if (audioSourceNode) {
    audioSourceNode.disconnect();
    audioSourceNode = null;
  }
}

function addChatMessage(text, who, kind) {
  const div = document.createElement('div');
  div.className = 'chat-msg' + (kind ? ' ' + kind : '');
  if (kind === 'system') {
    div.textContent = text;
  } else {
    div.innerHTML = `<span class="who">${who}:</span> ${escapeHtml(text)}`;
  }
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---- Screen navigation using browser History API ----
// This makes the browser's own back/forward buttons work the same way
// as our in-app "Back" button.

function showScreen(screen) {
  entryScreen.classList.add('hidden');
  modeScreen.classList.add('hidden');
  chatScreen.classList.add('hidden');
  loginScreen.classList.add('hidden');
  signupScreen.classList.add('hidden');
  profileScreen.classList.add('hidden');

  if (screen === 'entry') {
    entryScreen.classList.remove('hidden');
  } else if (screen === 'mode') {
    welcomeName.textContent = `Hi, ${myName}`;
    viewProfileBtn.classList.toggle('hidden', !currentUser);
    modeScreen.classList.remove('hidden');
  } else if (screen === 'chat') {
    chatScreen.classList.remove('hidden');
  } else if (screen === 'login') {
    loginScreen.classList.remove('hidden');
  } else if (screen === 'signup') {
    signupScreen.classList.remove('hidden');
  } else if (screen === 'profile') {
    profileUsernameEl.textContent = currentUser ? currentUser.username : '';
    profileBioInput.value = currentUser ? currentUser.bio || '' : '';
    profileGamesInput.value = currentUser && currentUser.favoriteGames ? currentUser.favoriteGames.join(', ') : '';
    profileScreen.classList.remove('hidden');
  }
}

function goToModeScreen(pushHistory = true) {
  if (pushHistory) {
    history.pushState({ screen: 'mode' }, '', '#mode');
  }
  showScreen('mode');
}

window.addEventListener('popstate', (event) => {
  const screen = (event.state && event.state.screen) || 'entry';

  if (screen !== 'chat') {
    // Leaving the chat screen (whether via browser back or app back) should
    // disconnect cleanly: stop camera/mic, close the peer connection, etc.
    leaveCurrentChat();
  }

  showScreen(screen);
});

// ---- Startup: check for a real logged-in account first, then fall back to guest name ----
async function checkAuthAndStart() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data && data.user) {
      currentUser = data.user;
      myName = data.user.username;
      history.replaceState({ screen: 'mode' }, '', '#mode');
      showScreen('mode');
      return;
    }
  } catch (e) {
    // network error or server not reachable yet; fall through to guest flow
  }

  const savedName = sessionStorage.getItem(NAME_KEY);
  if (savedName) {
    myName = savedName;
    history.replaceState({ screen: 'mode' }, '', '#mode');
    showScreen('mode');
  } else {
    history.replaceState({ screen: 'entry' }, '', '#entry');
  }
}
checkAuthAndStart();

// ---- Step 1: username ----
continueBtn.addEventListener('click', () => {
  myName = usernameInput.value.trim() || 'Stranger';
  sessionStorage.setItem(NAME_KEY, myName);
  goToModeScreen();
});

usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') continueBtn.click();
});

changeNameBtn.addEventListener('click', () => {
  sessionStorage.removeItem(NAME_KEY);
  usernameInput.value = '';
  history.pushState({ screen: 'entry' }, '', '#entry');
  showScreen('entry');
});

// ---- Auth: navigation between entry/login/signup ----
showLoginBtn.addEventListener('click', () => {
  loginErrorEl.classList.add('hidden');
  history.pushState({ screen: 'login' }, '', '#login');
  showScreen('login');
});

showSignupBtn.addEventListener('click', () => {
  signupErrorEl.classList.add('hidden');
  history.pushState({ screen: 'signup' }, '', '#signup');
  showScreen('signup');
});

loginToSignupBtn.addEventListener('click', () => {
  signupErrorEl.classList.add('hidden');
  history.pushState({ screen: 'signup' }, '', '#signup');
  showScreen('signup');
});

signupToLoginBtn.addEventListener('click', () => {
  loginErrorEl.classList.add('hidden');
  history.pushState({ screen: 'login' }, '', '#login');
  showScreen('login');
});

loginBackBtn.addEventListener('click', () => {
  history.pushState({ screen: 'entry' }, '', '#entry');
  showScreen('entry');
});

signupBackBtn.addEventListener('click', () => {
  history.pushState({ screen: 'entry' }, '', '#entry');
  showScreen('entry');
});

// ---- Auth: submit login ----
loginSubmitBtn.addEventListener('click', async () => {
  const email = loginEmailInput.value.trim();
  const password = loginPasswordInput.value;
  loginErrorEl.classList.add('hidden');

  if (!email || !password) {
    loginErrorEl.textContent = 'Please enter your email and password.';
    loginErrorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      loginErrorEl.textContent = data.error || 'Could not log in.';
      loginErrorEl.classList.remove('hidden');
      return;
    }
    currentUser = data.user;
    myName = data.user.username;
    loginEmailInput.value = '';
    loginPasswordInput.value = '';
    goToModeScreen();
  } catch (e) {
    loginErrorEl.textContent = 'Network error. Please try again.';
    loginErrorEl.classList.remove('hidden');
  }
});

// ---- Auth: submit signup ----
signupSubmitBtn.addEventListener('click', async () => {
  const username = signupUsernameInput.value.trim();
  const email = signupEmailInput.value.trim();
  const password = signupPasswordInput.value;
  signupErrorEl.classList.add('hidden');

  if (!username || !email || !password) {
    signupErrorEl.textContent = 'Please fill in all fields.';
    signupErrorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      signupErrorEl.textContent = data.error || 'Could not create your account.';
      signupErrorEl.classList.remove('hidden');
      return;
    }
    currentUser = data.user;
    myName = data.user.username;
    signupUsernameInput.value = '';
    signupEmailInput.value = '';
    signupPasswordInput.value = '';
    goToModeScreen();
  } catch (e) {
    signupErrorEl.textContent = 'Network error. Please try again.';
    signupErrorEl.classList.remove('hidden');
  }
});

// ---- Profile ----
viewProfileBtn.addEventListener('click', () => {
  history.pushState({ screen: 'profile' }, '', '#profile');
  showScreen('profile');
});

profileBackBtn.addEventListener('click', () => {
  history.back();
});

profileSaveBtn.addEventListener('click', async () => {
  const bio = profileBioInput.value.trim();
  const favoriteGames = profileGamesInput.value
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);

  try {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bio, favoriteGames }),
    });
    const data = await res.json();
    if (res.ok) {
      currentUser = data.user;
      profileSavedMsg.classList.remove('hidden');
      setTimeout(() => profileSavedMsg.classList.add('hidden'), 2000);
    }
  } catch (e) {
    console.error('Could not save profile', e);
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    // ignore network errors on logout
  }
  currentUser = null;
  myName = 'Stranger';
  sessionStorage.removeItem(NAME_KEY);
  history.pushState({ screen: 'entry' }, '', '#entry');
  showScreen('entry');
});

// ---- Step 2: mode selection ----
modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    currentMode = btn.dataset.mode;
    if (currentMode === 'video' || currentMode === 'voice') {
      ensureAudioContext();
    }
    startChat(currentMode);
  });
});

async function startChat(mode) {
  // Show/hide panes based on mode
  videoPane.classList.toggle('hidden', mode !== 'video');
  voicePane.classList.toggle('hidden', mode !== 'voice');
  toggleCamBtn.classList.toggle('hidden', mode !== 'video');
  toggleMicBtn.classList.toggle('hidden', mode === 'text');

  const needsMedia = mode === 'video' || mode === 'voice';

  if (needsMedia) {
    try {
      const constraints = mode === 'video'
        ? { video: true, audio: true }
        : { video: false, audio: true };
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      alert('Camera/mic access is needed for this mode. You can still use text chat instead.');
      localStream = null;
    }
    if (mode === 'video' && localStream) {
      localVideo.srcObject = localStream;
    }
  }

  history.pushState({ screen: 'chat', mode }, '', '#chat');
  showScreen('chat');

  socket = io();
  wireSocketEvents();
  socket.emit('set-username', { name: myName, mode });
}

let pendingSignals = [];

async function handleSignal(data) {
  try {
    if (data.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', answer);
    } else if (data.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data));
    } else if (data.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(data));
    }
  } catch (e) {
    console.error('Signal handling error', e);
  }
}

function wireSocketEvents() {
  socket.on('waiting', () => {
    statusEl.textContent = 'Looking for a teammate…';
    setWaitingLabel('Waiting for someone…');
    remoteVideo.srcObject = null;
  });

  socket.on('matched', async ({ partnerName: pName, initiator }) => {
    partnerName = pName;
    statusEl.textContent = `Connected with ${partnerName}`;
    setWaitingLabel(partnerName);
    addChatMessage(`You matched with ${partnerName}.`, null, 'system');

    if (currentMode === 'video' || currentMode === 'voice') {
      await setupPeerConnection(initiator);
    }
  });

  socket.on('signal', async (data) => {
    if (!pc) {
      pendingSignals.push(data);
      return;
    }
    await handleSignal(data);
  });

  socket.on('partner-left', () => {
    addChatMessage(`${partnerName} left the chat.`, null, 'system');
    statusEl.textContent = 'Looking for a teammate…';
    setWaitingLabel('Waiting for someone…');
    remoteVideo.srcObject = null;
    teardownPeerConnection();
  });

  socket.on('chat-message', ({ text, from }) => {
    addChatMessage(text, from);
  });
}

function setWaitingLabel(text) {
  remoteLabel.textContent = text;
  voiceLabel.textContent = text;
}

async function setupPeerConnection(initiator) {
  teardownPeerConnection();
  await iceServersReady;
  pc = new RTCPeerConnection(ICE_SERVERS);

  // Process any signal messages that arrived while we were still setting up
  const queued = pendingSignals;
  pendingSignals = [];
  for (const data of queued) {
    await handleSignal(data);
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.ontrack = (event) => {
    if (currentMode === 'video') {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.muted = true; // avoid double/normal-volume audio; we play boosted audio separately
      playBoostedAudio(event.streams[0]);
    } else {
      // Voice mode: play the remote audio through the volume-boosted path
      playBoostedAudio(event.streams[0]);
      voiceAvatar.classList.add('talking');
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', event.candidate);
    }
  };

  if (initiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('signal', offer);
      } catch (e) {
        console.error('Negotiation error', e);
      }
    };
  }
}

function teardownPeerConnection() {
  if (pc) {
    pc.close();
    pc = null;
  }
  pendingSignals = [];
  voiceAvatar.classList.remove('talking');
  stopBoostedAudio();
}

// Fully leave the current chat: stop media, disconnect socket, clear chat log
function leaveCurrentChat() {
  teardownPeerConnection();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  chatLog.innerHTML = '';
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  camOn = true;
  micOn = true;
}

backBtn.addEventListener('click', () => {
  history.back();
});

brandBtn.addEventListener('click', () => {
  leaveCurrentChat();
  goToModeScreen();
});

nextBtn.addEventListener('click', () => {
  chatLog.innerHTML = '';
  socket.emit('next');
});

toggleCamBtn.addEventListener('click', () => {
  if (!localStream) return;
  camOn = !camOn;
  localStream.getVideoTracks().forEach((t) => (t.enabled = camOn));
  toggleCamBtn.textContent = `Cam: ${camOn ? 'On' : 'Off'}`;
});

toggleMicBtn.addEventListener('click', () => {
  if (!localStream) return;
  micOn = !micOn;
  localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
  toggleMicBtn.textContent = `Mic: ${micOn ? 'On' : 'Off'}`;
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', text);
  addChatMessage(text, myName, 'me');
  chatInput.value = '';
});
