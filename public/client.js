const entryScreen = document.getElementById('entry-screen');
const chatScreen = document.getElementById('chat-screen');
const usernameInput = document.getElementById('username-input');
const startBtn = document.getElementById('start-btn');

const statusEl = document.getElementById('status');
const remoteVideo = document.getElementById('remote-video');
const remoteLabel = document.getElementById('remote-label');
const localVideo = document.getElementById('local-video');
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

let socket = null;
let localStream = null;
let pc = null;
let myName = 'Stranger';
let partnerName = 'Stranger';
let camOn = true;
let micOn = true;

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

async function start() {
  myName = usernameInput.value.trim() || 'Stranger';

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    alert('Camera/mic access is needed for video chat. You can still use text chat, but please allow access for the full experience.');
    localStream = null;
  }

  if (localStream) {
    localVideo.srcObject = localStream;
  }

  entryScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');

  socket = io();
  wireSocketEvents();
  socket.emit('set-username', myName);
}

function wireSocketEvents() {
  socket.on('waiting', () => {
    statusEl.textContent = 'Looking for a teammate…';
    remoteLabel.textContent = 'Waiting for someone…';
    remoteVideo.srcObject = null;
  });

  socket.on('matched', ({ partnerName: pName, initiator }) => {
    partnerName = pName;
    statusEl.textContent = `Connected with ${partnerName}`;
    remoteLabel.textContent = partnerName;
    addChatMessage(`You matched with ${partnerName}.`, null, 'system');
    setupPeerConnection(initiator);
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
    remoteLabel.textContent = 'Waiting for someone…';
    remoteVideo.srcObject = null;
    teardownPeerConnection();
  });

  socket.on('chat-message', ({ text, from }) => {
    addChatMessage(text, from);
  });
}

function setupPeerConnection(initiator) {
  teardownPeerConnection();
  pc = new RTCPeerConnection(ICE_SERVERS);

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
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
}

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

startBtn.addEventListener('click', start);
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') start();
});
