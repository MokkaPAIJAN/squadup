const entryScreen = document.getElementById('entry-screen');
const modeScreen = document.getElementById('mode-screen');
const chatScreen = document.getElementById('chat-screen');
const usernameInput = document.getElementById('username-input');
const continueBtn = document.getElementById('continue-btn');
const modeButtons = document.querySelectorAll('.mode-btn');
const welcomeName = document.getElementById('welcome-name');
const changeNameBtn = document.getElementById('change-name-btn');
const backBtn = document.getElementById('back-btn');

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

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const NAME_KEY = 'squadup_username';

let socket = null;
let localStream = null;
let pc = null;
let myName = 'Stranger';
let partnerName = 'Stranger';
let camOn = true;
let micOn = true;
let currentMode = 'text'; // 'video' | 'voice' | 'text'

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

// ---- Restore name from this browser session (cleared when tab/browser closes) ----
function goToModeScreen() {
  welcomeName.textContent = `Hi, ${myName}`;
  entryScreen.classList.add('hidden');
  chatScreen.classList.add('hidden');
  modeScreen.classList.remove('hidden');
}

const savedName = sessionStorage.getItem(NAME_KEY);
if (savedName) {
  myName = savedName;
  goToModeScreen();
}

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
  modeScreen.classList.add('hidden');
  entryScreen.classList.remove('hidden');
});

// ---- Step 2: mode selection ----
modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    currentMode = btn.dataset.mode;
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

  modeScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');

  socket = io();
  wireSocketEvents();
  socket.emit('set-username', { name: myName, mode });
}

function wireSocketEvents() {
  socket.on('waiting', () => {
    statusEl.textContent = 'Looking for a teammate…';
    setWaitingLabel('Waiting for someone…');
    remoteVideo.srcObject = null;
  });

  socket.on('matched', ({ partnerName: pName, initiator }) => {
    partnerName = pName;
    statusEl.textContent = `Connected with ${partnerName}`;
    setWaitingLabel(partnerName);
    addChatMessage(`You matched with ${partnerName}.`, null, 'system');

    if (currentMode === 'video' || currentMode === 'voice') {
      setupPeerConnection(initiator);
    }
  });

  socket.on('signal', async (data) => {
    if (!pc) return;
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

function setupPeerConnection(initiator) {
  teardownPeerConnection();
  pc = new RTCPeerConnection(ICE_SERVERS);

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.ontrack = (event) => {
    if (currentMode === 'video') {
      remoteVideo.srcObject = event.streams[0];
    } else {
      // Voice mode: play remote audio via a hidden audio element
      let audioEl = document.getElementById('remote-audio');
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = 'remote-audio';
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = event.streams[0];
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
  voiceAvatar.classList.remove('talking');
  const audioEl = document.getElementById('remote-audio');
  if (audioEl) audioEl.srcObject = null;
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
