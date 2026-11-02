/**
 * =============================================================================
 * TRABAJO PRÁCTICO WEBRTC - E.E.T. Nº 3139 “GRAL. MARTÍN M. DE GÜEMES”
 * Archivo: js/main.js
 * Descripción: Aplicación WhatsApp WebRTC P2P con Chat en tiempo real y Videollamada
 * =============================================================================
 */

// Elementos HTML de video e interfaz
var localVideoComponent;
var remoteVideoComponent;
var localStream = null;
var remoteMediaStream = null;

// Cola para almacenar candidatos ICE remotos recibidos antes de fijar la descripción remota
let iceCandidatesQueue = [];

// Temporizador para el video sintético de la PC
let fallbackCanvasInterval = null;

// Efectos sonoros y estado de sala
let audioToneCtx = null;
let toneInterval = null;
let currentRoomPeers = 1;

// Identificadores de usuario y par destino seleccionado
let myPeerId = "Yo";
let currentTargetPeerId = null;
let isVideoCallActive = false;

// Servidores STUN públicos y redundantes para asegurar conectividad NAT Traversal
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};

// Instancia dinámica de RTCPeerConnection
let pc = null;

/**
 * Crea o recupera la instancia activa de RTCPeerConnection.
 */
function getPeerConnection() {
  if (pc && pc.signalingState !== 'closed') {
    return pc;
  }

  console.log("[WebRTC] Creando nueva instancia RTCPeerConnection...");
  pc = new RTCPeerConnection(iceServers);

  // 1. Detección y envío de candidatos ICE locales hacia el par destino
  pc.onicecandidate = ({ candidate }) => {
    if (candidate && candidate.candidate) {
      signaling.send({ candidate, target: currentTargetPeerId });
    }
  };

  // 2. Monitoreo del estado de conexión P2P
  pc.onconnectionstatechange = () => {
    console.log("[WebRTC] connectionState:", pc.connectionState);
    if (pc.connectionState === 'connected') {
      updateConnectionStatus("En videollamada (En vivo)", "active");
    } else if (pc.connectionState === 'failed') {
      console.warn("[WebRTC] Conexión P2P fallida.");
      updateConnectionStatus("Fallo P2P", "error");
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log("[WebRTC] iceConnectionState:", pc.iceConnectionState);
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      updateConnectionStatus("En videollamada", "active");
    }
  };

  // 3. Recepción de pistas de audio y video remotas de forma desacoplada
  pc.ontrack = (event) => {
    console.log("[WebRTC] Pista remota recibida:", event.track.kind);

    if (event.track.kind === 'video') {
      if (!remoteMediaStream) {
        remoteMediaStream = new MediaStream();
      }
      const existing = remoteMediaStream.getVideoTracks()[0];
      if (existing) remoteMediaStream.removeTrack(existing);
      remoteMediaStream.addTrack(event.track);

      setupRemoteVideoElement(remoteMediaStream);

      const placeholder = document.getElementById('remote-placeholder');
      if (placeholder) placeholder.style.display = 'none';

    } else if (event.track.kind === 'audio') {
      // Elemento de audio dedicado para garantizar que el navegador lo reproduzca
      setupRemoteAudioElement(event.track);
    }

    closeCallModal();
    openVideoOverlay();
    updateConnectionStatus("En videollamada", "active");
  };

  return pc;
}

/**
 * Configura la reproducción del audio remoto usando un elemento <audio> dedicado
 */
function setupRemoteAudioElement(audioTrack) {
  let remoteAudio = document.getElementById('remote-audio');
  if (!remoteAudio) {
    remoteAudio = document.createElement('audio');
    remoteAudio.id = 'remote-audio';
    remoteAudio.autoplay = true;
    remoteAudio.playsInline = true;
    document.body.appendChild(remoteAudio);
  }

  remoteAudio.srcObject = new MediaStream([audioTrack]);
  remoteAudio.muted = false;
  remoteAudio.volume = 1.0;

  remoteAudio.play().then(() => {
    console.log("[WebRTC] Audio remoto reproduciéndose activamente.");
    hideUnmuteBanner();
  }).catch((err) => {
    console.warn("[WebRTC] Autoplay bloqueó audio remoto. Esperando clic:", err);
    showUnmuteBanner();
    document.addEventListener('click', unmuteRemoteAudio, { once: true });
  });
}

/**
 * Configura la reproducción remota de video
 */
function setupRemoteVideoElement(stream) {
  if (!remoteVideoComponent) return;

  if (remoteVideoComponent.srcObject !== stream) {
    remoteVideoComponent.srcObject = stream;
  }
  remoteVideoComponent.playsInline = true;
  remoteVideoComponent.setAttribute('playsinline', '');
  remoteVideoComponent.setAttribute('webkit-playsinline', '');

  remoteVideoComponent.play().then(() => {
    console.log("[WebRTC] Video remoto reproduciéndose.");
  }).catch((err) => {
    console.warn("[WebRTC] Video autoplay con restricción, activando mudo visual:", err);
    remoteVideoComponent.muted = true;
    remoteVideoComponent.play().catch(e => console.warn(e));
  });
}

function unmuteRemoteAudio() {
  const remoteAudio = document.getElementById('remote-audio');
  if (remoteAudio) {
    remoteAudio.muted = false;
    remoteAudio.volume = 1.0;
    remoteAudio.play().catch(e => console.warn(e));
  }
  if (remoteVideoComponent) {
    remoteVideoComponent.muted = false;
    remoteVideoComponent.volume = 1.0;
    remoteVideoComponent.play().catch(e => console.warn(e));
  }
  hideUnmuteBanner();
  console.log("[WebRTC] Audio remoto activado por el usuario.");
}

function showUnmuteBanner() {
  const banner = document.getElementById('unmute-banner');
  if (banner) banner.style.display = 'flex';
}

function hideUnmuteBanner() {
  const banner = document.getElementById('unmute-banner');
  if (banner) banner.style.display = 'none';
}

/**
 * Alterna el encuadre del video remoto entre contain (ajustado natural) y cover (pantalla completa)
 */
function toggleVideoAspect() {
  const vid = document.getElementById('remote-video');
  if (!vid) return;
  const currentFit = vid.style.objectFit || window.getComputedStyle(vid).objectFit;
  if (currentFit === 'cover') {
    vid.style.objectFit = 'contain';
    console.log("[UI] Encuadre de video cambiado a: contain (ajustado)");
  } else {
    vid.style.objectFit = 'cover';
    console.log("[UI] Encuadre de video cambiado a: cover (lleno)");
  }
}

// =============================================================================
// GESTIÓN DE PERIFÉRICOS CON VIDEO SINTÉTICO ADAPTATIVO
// =============================================================================

function createFallbackVideoTrack() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  let angle = 0;

  const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const deviceLabel = isMobileDevice ? 'Celular (Sin Cámara)' : 'PC (Solo Micrófono)';

  function draw() {
    angle += 0.08;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pulse = Math.sin(angle) * 8;
    ctx.strokeStyle = '#00a884';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(320, 195, 76 + pulse, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(320, 195, 70, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#00a884';
    ctx.beginPath();
    ctx.arc(320, 175, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(320, 265, 48, Math.PI, 0, false);
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(deviceLabel, 320, 350);
  }

  draw();
  if (fallbackCanvasInterval) clearInterval(fallbackCanvasInterval);
  fallbackCanvasInterval = setInterval(draw, 100);

  const stream = canvas.captureStream(10);
  return stream.getVideoTracks()[0];
}

/**
 * Conecta EXCLUSIVAMENTE la pista de video al elemento miniatura local.
 * De esta manera NUNCA se conecta la pista de audio local al elemento <video>
 * eliminando por completo cualquier posibilidad de eco o autoescucha del micrófono.
 */
function attachLocalVideoOnly(stream) {
  if (!localVideoComponent) return;
  if (!stream) {
    localVideoComponent.srcObject = null;
    return;
  }
  const videoTracks = stream.getVideoTracks();
  if (videoTracks.length > 0) {
    localVideoComponent.srcObject = new MediaStream([videoTracks[0]]);
  } else {
    localVideoComponent.srcObject = null;
  }
  localVideoComponent.muted = true;
  localVideoComponent.volume = 0;
  localVideoComponent.playsInline = true;
  localVideoComponent.play().catch(e => console.warn(e));
}

async function acquireLocalMedia() {
  if (localStream && localStream.active && localStream.getVideoTracks().length > 0) {
    return localStream;
  }

  // Intento 1: Cámara web frontal con cancelación de eco
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      },
      video: {
        facingMode: "user"
      }
    });
    console.log("[WebRTC] Cámara web y micrófono obtenidos con éxito (Intento 1).");
    attachLocalVideoOnly(localStream);
    hideNoCameraPlaceholder();
    return localStream;
  } catch (errVideo) {
    console.warn("[WebRTC] Intento 1 falló:", errVideo);
  }

  // Intento 2: Cámara y micrófono básicos (máxima compatibilidad en celulares Android / iOS)
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    });
    console.log("[WebRTC] Cámara y micrófono obtenidos con video básico (Intento 2).");
    attachLocalVideoOnly(localStream);
    hideNoCameraPlaceholder();
    return localStream;
  } catch (errBasic) {
    console.warn("[WebRTC] Intento 2 falló (dispositivo sin cámara física):", errBasic);
  }

  // Intento 3: Micrófono real + Video sintético (PC de escritorio sin cámara web física)
  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true
      },
      video: false
    });
    const fallbackVideo = createFallbackVideoTrack();
    audioStream.addTrack(fallbackVideo);

    localStream = audioStream;
    console.log("[WebRTC] PC de escritorio sin cámara: Micrófono real y video sintético adaptativo listos.");

    attachLocalVideoOnly(localStream);
    showNoCameraPlaceholder("Micrófono activo (PC sin cámara)");
    return localStream;
  } catch (errAudio) {
    console.warn("[WebRTC] Sin micrófono:", errAudio);
  }

  showNoCameraPlaceholder("Sin periféricos");
  return null;
}

function showNoCameraPlaceholder(text) {
  const indicator = document.getElementById('no-camera-indicator');
  const label = document.getElementById('no-camera-label');
  if (indicator) indicator.style.display = 'flex';
  if (label && text) label.innerText = text;
}

function hideNoCameraPlaceholder() {
  const indicator = document.getElementById('no-camera-indicator');
  if (indicator) indicator.style.display = 'none';
}

function ensureLocalTracksAdded() {
  const peer = getPeerConnection();
  if (localStream) {
    const senders = peer.getSenders();
    localStream.getTracks().forEach((track) => {
      const alreadyAdded = senders.some(s => s.track && s.track.id === track.id);
      if (!alreadyAdded) {
        peer.addTrack(track, localStream);
        console.log(`[WebRTC] Pista agregada al Peer: ${track.kind}`);
      }
    });
  }
}

// =============================================================================
// CANAL DE SEÑALIZACIÓN WEBSOCKET CON AUTORRECONEXIÓN
// =============================================================================
const signaling = {
  ws: null,
  reconnectTimer: null,
  serverUrl: null,

  connect: function(url) {
    if (url) this.serverUrl = url;
    const targetUrl = this.serverUrl;
    if (!targetUrl) return;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(targetUrl);
    } catch (err) {
      console.warn("[Signaling] Fallo al crear WebSocket:", err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      updateConnectionStatus("En línea", "active");
      console.log("[Signaling] WebSocket conectado.");
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    this.ws.onclose = () => {
      updateConnectionStatus("Reconectando...", "standby");
      console.log("[Signaling] WebSocket cerrado. Reintentando...");
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.warn("[Signaling] Error WebSocket:", err);
    };

    this.ws.onmessage = async (message) => {
      try {
        const data = JSON.parse(message.data);
        if (this.onmessage) {
          await this.onmessage(data);
        }
      } catch (err) {
        console.error("[Signaling] Error JSON:", err);
      }
    };
  },

  scheduleReconnect: function() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  },

  send: function(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    } else {
      console.warn("[Signaling] Canal no listo. Reconectando y reintentando...", data);
      this.connect();
      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(data));
        }
      }, 800);
      return false;
    }
  },

  onmessage: null
};

// =============================================================================
// GESTIÓN DE CONTACTOS Y DISPOSITIVOS EN EL PANEL LATERAL
// =============================================================================

function updateContactsList(peersList, totalPeers) {
  const chatList = document.getElementById('chat-list');
  const headerStatus = document.getElementById('chat-header-status');
  const chatHeaderName = document.getElementById('chat-header-name');
  if (!chatList) return;

  const otherPeers = (peersList || []).filter(p => p.peerId !== myPeerId);

  if (otherPeers.length === 0) {
    currentTargetPeerId = null;
    chatList.innerHTML = `
      <div class="chat-item active" id="peer-chat-item">
        <div class="avatar contact-avatar">
          <svg class="icon-svg" viewBox="0 0 24 24">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <span class="online-indicator offline"></span>
        </div>
        <div class="chat-item-content">
          <div class="chat-item-top">
            <h3>Esperando compañero...</h3>
            <span class="chat-time">--:--</span>
          </div>
          <div class="chat-item-bottom">
            <p>Conecta tu celular a la sala</p>
          </div>
        </div>
      </div>
    `;
    if (chatHeaderName) chatHeaderName.innerText = "Compañero";
    if (headerStatus) {
      headerStatus.innerText = "Esperando que se una...";
      headerStatus.classList.remove('online');
    }
    return;
  }

  // Si no hay seleccionado o el seleccionado ya no existe, seleccionar el primero
  if (!currentTargetPeerId || !otherPeers.some(p => p.peerId === currentTargetPeerId)) {
    currentTargetPeerId = otherPeers[0].peerId;
  }

  chatList.innerHTML = "";
  otherPeers.forEach((p) => {
    const isSelected = p.peerId === currentTargetPeerId;
    const isPhone = (p.deviceType === 'Celular') || p.peerId.includes('Celular');

    const item = document.createElement('div');
    item.className = `chat-item ${isSelected ? 'active' : ''}`;
    item.onclick = () => selectContact(p.peerId);

    // Icono SVG según dispositivo
    const deviceIconSvg = isPhone
      ? `<svg class="icon-svg" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>`
      : `<svg class="icon-svg" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;

    item.innerHTML = `
      <div class="avatar contact-avatar">
        ${deviceIconSvg}
        <span class="online-indicator"></span>
      </div>
      <div class="chat-item-content">
        <div class="chat-item-top">
          <h3>${p.peerId}</h3>
          <span class="chat-time">En línea</span>
        </div>
        <div class="chat-item-bottom">
          <p>Toca para chatear o llamar</p>
        </div>
      </div>
    `;
    chatList.appendChild(item);
  });

  const selectedPeerObj = otherPeers.find(p => p.peerId === currentTargetPeerId);
  if (selectedPeerObj) {
    if (chatHeaderName) chatHeaderName.innerText = selectedPeerObj.peerId;
    if (headerStatus) {
      headerStatus.innerText = "En línea";
      headerStatus.classList.add('online');
    }
  }
}

function selectContact(peerId) {
  currentTargetPeerId = peerId;
  openChatView();
  const chatHeaderName = document.getElementById('chat-header-name');
  if (chatHeaderName) chatHeaderName.innerText = peerId;

  const items = document.querySelectorAll('.chat-item');
  items.forEach(el => {
    const h3 = el.querySelector('h3');
    if (h3 && h3.innerText === peerId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

// =============================================================================
// MOTOR DE CHAT EN TIEMPO REAL ESTILO WHATSAPP
// =============================================================================

function formatCurrentTime() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function handleSendMessage(event) {
  if (event) event.preventDefault();

  const input = document.getElementById('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  const timeStr = formatCurrentTime();

  // 1. Agregar burbuja a mi pantalla (verde, a la derecha)
  appendChatMessage(text, timeStr, true);

  // 2. Enviar por WebSocket al par destino
  signaling.send({
    type: 'chat-message',
    text: text,
    sender: myPeerId,
    target: currentTargetPeerId,
    time: timeStr
  });

  // 3. Actualizar vista previa lateral
  updateLastMessagePreview("Tú: " + text, timeStr);
  playMessagePop();

  input.value = "";
  input.focus();
}

function appendChatMessage(text, timeStr, isMine) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isMine ? 'mine' : 'peer'}`;

  const messageText = document.createElement('span');
  messageText.innerText = text;
  bubble.appendChild(messageText);

  const meta = document.createElement('div');
  meta.className = 'message-meta';

  const time = document.createElement('span');
  time.innerText = timeStr;
  meta.appendChild(time);

  if (isMine) {
    const check = document.createElement('span');
    check.innerHTML = `
      <svg class="check-icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z"/>
      </svg>
    `;
    meta.appendChild(check);
  }

  bubble.appendChild(meta);
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

function appendSystemMessage(text) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const msg = document.createElement('div');
  msg.className = 'system-message';
  msg.innerHTML = `<span>${text}</span>`;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function updateLastMessagePreview(text, timeStr) {
  const preview = document.getElementById('peer-last-preview');
  const time = document.getElementById('peer-last-time');
  if (preview) preview.innerText = text;
  if (time && timeStr) time.innerText = timeStr;
}

// =============================================================================
// NAVEGACIÓN Y RESPONSIVE (MÓVIL / DESKTOP)
// =============================================================================

function openChatView() {
  if (window.innerWidth <= 768) {
    const sidebar = document.getElementById('sidebar-panel');
    const chat = document.getElementById('chat-panel');
    if (sidebar) sidebar.classList.add('hidden-mobile');
    if (chat) chat.classList.add('active-mobile');
  }

  const badge = document.getElementById('unread-badge');
  if (badge) badge.style.display = 'none';
}

function backToSidebar() {
  if (window.innerWidth <= 768) {
    const sidebar = document.getElementById('sidebar-panel');
    const chat = document.getElementById('chat-panel');
    if (sidebar) sidebar.classList.remove('hidden-mobile');
    if (chat) chat.classList.remove('active-mobile');
  }
}

// =============================================================================
// EFECTOS DE SONIDO SINTETIZADOS (Web Audio API - Cero dependencias externas)
// =============================================================================

function getAudioContext() {
  if (!audioToneCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) audioToneCtx = new AudioCtx();
  }
  if (audioToneCtx && audioToneCtx.state === 'suspended') {
    audioToneCtx.resume().catch(e => console.warn(e));
  }
  return audioToneCtx;
}

function playIncomingTone() {
  stopCallTones();
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    function ring() {
      if (!audioToneCtx || audioToneCtx.state === 'closed') return;
      const t = audioToneCtx.currentTime;
      const osc1 = audioToneCtx.createOscillator();
      const gain1 = audioToneCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(440, t);
      gain1.gain.setValueAtTime(0.08, t);
      gain1.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc1.connect(gain1);
      gain1.connect(audioToneCtx.destination);
      osc1.start(t);
      osc1.stop(t + 0.35);

      const osc2 = audioToneCtx.createOscillator();
      const gain2 = audioToneCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(554.37, t + 0.18);
      gain2.gain.setValueAtTime(0.1, t + 0.18);
      gain2.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc2.connect(gain2);
      gain2.connect(audioToneCtx.destination);
      osc2.start(t + 0.18);
      osc2.stop(t + 0.55);
    }

    ring();
    toneInterval = setInterval(ring, 2400);
  } catch (e) {
    console.warn("Audio incoming tone warning:", e);
  }
}

function playOutgoingTone() {
  stopCallTones();
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    function dial() {
      if (!audioToneCtx || audioToneCtx.state === 'closed') return;
      const t = audioToneCtx.currentTime;
      const osc = audioToneCtx.createOscillator();
      const gain = audioToneCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(425, t);
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      osc.connect(gain);
      gain.connect(audioToneCtx.destination);
      osc.start(t);
      osc.stop(t + 1.2);
    }

    dial();
    toneInterval = setInterval(dial, 3000);
  } catch (e) {
    console.warn("Audio outgoing tone warning:", e);
  }
}

function playMessagePop() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.08);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  } catch (e) {}
}

function stopCallTones() {
  if (toneInterval) {
    clearInterval(toneInterval);
    toneInterval = null;
  }
}

// =============================================================================
// GESTIÓN DE VIDEOLLAMADA Y MODALES
// =============================================================================

function initiateCall() {
  // Asegurar desbloqueo de audio con el clic de usuario
  unmuteRemoteAudio();

  showOutgoingModal();
  updateConnectionStatus("Llamando...", "active");

  acquireLocalMedia().catch(e => console.warn(e));

  signaling.send({ type: 'call-request', target: currentTargetPeerId });
}

function handleIncomingCallRequest(sender, senderDevice) {
  currentTargetPeerId = sender || currentTargetPeerId;
  showIncomingModal(sender, senderDevice);
  updateConnectionStatus("Llamada entrante...", "active");
}

async function acceptIncomingCall() {
  // Asegurar desbloqueo de audio con el clic de usuario
  unmuteRemoteAudio();

  closeCallModal();
  updateConnectionStatus("Conectando...", "active");
  openVideoOverlay();

  await acquireLocalMedia();
  ensureLocalTracksAdded();
  signaling.send({ type: 'call-accepted', target: currentTargetPeerId });
}

function rejectIncomingCall() {
  closeCallModal();
  signaling.send({ type: 'call-rejected', target: currentTargetPeerId });
  updateConnectionStatus("Llamada rechazada", "standby");
}

function cancelOutgoingCall() {
  closeCallModal();
  signaling.send({ type: 'call-cancelled', target: currentTargetPeerId });
  updateConnectionStatus("Llamada cancelada", "standby");
}

function showIncomingModal(sender, senderDevice) {
  playIncomingTone();
  const modal = document.getElementById('call-modal');
  const title = document.getElementById('call-modal-title');
  const subtitle = document.getElementById('call-modal-subtitle');
  const incoming = document.getElementById('incoming-actions');
  const outgoing = document.getElementById('outgoing-actions');

  if (title) title.innerText = "Llamada entrante";
  if (subtitle) {
    subtitle.innerText = sender ? `De ${sender}` : "Videollamada WebRTC P2P";
  }
  if (incoming) incoming.style.display = 'flex';
  if (outgoing) outgoing.style.display = 'none';
  if (modal) modal.style.display = 'flex';
}

function showOutgoingModal() {
  playOutgoingTone();
  const modal = document.getElementById('call-modal');
  const title = document.getElementById('call-modal-title');
  const subtitle = document.getElementById('call-modal-subtitle');
  const incoming = document.getElementById('incoming-actions');
  const outgoing = document.getElementById('outgoing-actions');

  if (title) title.innerText = "Llamando...";
  if (subtitle) {
    if (currentTargetPeerId) {
      subtitle.innerText = `Llamando a ${currentTargetPeerId}...`;
    } else if (currentRoomPeers < 2) {
      subtitle.innerText = "Esperando que tu compañero se conecte a la sala...";
    } else {
      subtitle.innerText = "Esperando que atiendan...";
    }
  }
  if (incoming) incoming.style.display = 'none';
  if (outgoing) outgoing.style.display = 'flex';
  if (modal) modal.style.display = 'flex';
}

function closeCallModal() {
  stopCallTones();
  const modal = document.getElementById('call-modal');
  if (modal) modal.style.display = 'none';
}

function openVideoOverlay() {
  isVideoCallActive = true;
  const overlay = document.getElementById('video-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.remove('minimized');
  }
  const restoreBtn = document.getElementById('btn-restore-video');
  if (restoreBtn) restoreBtn.style.display = 'none';
}

function closeVideoOverlay() {
  isVideoCallActive = false;
  const overlay = document.getElementById('video-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.classList.remove('minimized');
  }
  const restoreBtn = document.getElementById('btn-restore-video');
  if (restoreBtn) restoreBtn.style.display = 'none';
}

function toggleMinimizeVideo() {
  const overlay = document.getElementById('video-overlay');
  const restoreBtn = document.getElementById('btn-restore-video');
  if (!overlay) return;

  if (overlay.classList.contains('minimized')) {
    overlay.classList.remove('minimized');
    if (restoreBtn) restoreBtn.style.display = 'none';
  } else {
    overlay.classList.add('minimized');
    if (restoreBtn) restoreBtn.style.display = 'flex';
  }
}

// =============================================================================
// PROCESAMIENTO DE MENSAJES DE SEÑALIZACIÓN
// =============================================================================
signaling.onmessage = async (data) => {
  try {
    const { desc, candidate, type, peerId, totalPeers, peers, text, time, sender, senderDevice } = data;

    // 1. Mensaje de bienvenida del servidor
    if (type === 'welcome') {
      myPeerId = peerId;
      const myNameEl = document.getElementById('my-peer-name');
      if (myNameEl) myNameEl.innerText = `${peerId}`;
      console.log(`[Signaling] Identificado como: ${peerId}`);
      return;
    }

    // 2. Estado de la sala (usuarios conectados y lista de pares)
    if (type === 'room-status') {
      currentRoomPeers = totalPeers || 1;
      updateContactsList(peers, currentRoomPeers);
      return;
    }

    // 3. Mensaje de chat recibido del par
    if (type === 'chat-message') {
      appendChatMessage(text, time || formatCurrentTime(), false);
      updateLastMessagePreview(text, time || formatCurrentTime());
      playMessagePop();

      if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar-panel');
        if (sidebar && !sidebar.classList.contains('hidden-mobile')) {
          const badge = document.getElementById('unread-badge');
          if (badge) badge.style.display = 'inline-block';
        }
      }
      return;
    }

    // 4. Solicitud de llamada entrante
    if (type === 'call-request') {
      currentTargetPeerId = sender || currentTargetPeerId;
      handleIncomingCallRequest(sender, senderDevice);
      return;
    }

    // 5. El par aceptó la llamada
    if (type === 'call-accepted') {
      if (sender) currentTargetPeerId = sender;
      console.log(`[Signaling] El par ${currentTargetPeerId || ''} aceptó la llamada. Generando Oferta SDP...`);
      closeCallModal();
      openVideoOverlay();
      updateConnectionStatus("Conectando...", "active");

      await acquireLocalMedia();
      const peer = getPeerConnection();
      ensureLocalTracksAdded();

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      signaling.send({ desc: peer.localDescription, target: currentTargetPeerId });
      return;
    }

    // 6. Rechazo o cancelación de llamada
    if (type === 'call-rejected') {
      resetCallState();
      updateConnectionStatus("Llamada rechazada", "standby");
      appendSystemMessage(`Llamada rechazada por ${sender || 'el compañero'}.`);
      return;
    }

    if (type === 'call-cancelled' || type === 'call-ended') {
      resetCallState();
      updateConnectionStatus("Llamada finalizada", "standby");
      appendSystemMessage("Llamada finalizada.");
      return;
    }

    if (type === 'peer-disconnected') {
      updateConnectionStatus("Par desconectado", "standby");
      resetCallState();
      appendSystemMessage(`${data.peerId || 'El compañero'} se ha desconectado.`);
      return;
    }

    // 7. Negociación SDP
    if (desc) {
      const peer = getPeerConnection();

      if (desc.type === 'offer') {
        if (sender) currentTargetPeerId = sender;
        console.log(`[WebRTC] Oferta SDP recibida de ${currentTargetPeerId || 'par'}. Generando Respuesta...`);
        await acquireLocalMedia();
        ensureLocalTracksAdded();

        await peer.setRemoteDescription(desc);
        await drainIceQueue();

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        signaling.send({ desc: peer.localDescription, target: currentTargetPeerId });
        console.log("[WebRTC] Respuesta SDP enviada.");

      } else if (desc.type === 'answer') {
        console.log("[WebRTC] Respuesta SDP recibida.");
        await peer.setRemoteDescription(desc);
        await drainIceQueue();
      }

    // 8. Candidato ICE
    } else if (candidate) {
      const peer = getPeerConnection();
      if (peer.remoteDescription && peer.remoteDescription.type) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.warn(e));
      } else {
        iceCandidatesQueue.push(candidate);
      }
    }
  } catch (err) {
    console.error("[WebRTC] Error en señalización:", err);
  }
};

async function drainIceQueue() {
  const peer = getPeerConnection();
  while (iceCandidatesQueue.length > 0) {
    const candidate = iceCandidatesQueue.shift();
    try {
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn("[WebRTC] Error aplicando candidato ICE:", e);
    }
  }
}

// =============================================================================
// FUNCIONES DE CONTROL DE LA APLICACIÓN
// =============================================================================

async function showVideoConference() {
  localVideoComponent = document.getElementById('local-video');
  remoteVideoComponent = document.getElementById('remote-video');

  // 1. Conexión inmediata al canal WebSocket para chat y señalización
  try {
    const isHttp = window.location.protocol.startsWith('http');
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = isHttp ? window.location.host : 'localhost:3000';
    signaling.connect(`${wsProtocol}//${wsHost}`);
  } catch (errWs) {
    console.error("[Signaling] Error iniciando WebSocket:", errWs);
    updateConnectionStatus("Error al conectar", "error");
  }

  // 2. Pre-cargar periféricos de forma no bloqueante
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      await acquireLocalMedia();
    } else {
      showNoCameraPlaceholder("Sin cámara detectada");
    }
  } catch (errMedia) {
    console.warn("[WebRTC] Periféricos en espera (se solicitarán al llamar):", errMedia);
    showNoCameraPlaceholder("Sin periféricos");
  }
}

function hangUp() {
  resetCallState();
  signaling.send({ type: 'call-ended', target: currentTargetPeerId });
  updateConnectionStatus("Llamada finalizada", "standby");
  appendSystemMessage("Llamada finalizada.");
}

function resetCallState() {
  stopCallTones();
  hideUnmuteBanner();
  closeCallModal();
  closeVideoOverlay();

  if (pc) {
    try {
      pc.close();
    } catch (e) {}
    pc = null;
  }

  iceCandidatesQueue = [];
  remoteMediaStream = null;

  if (remoteVideoComponent) {
    remoteVideoComponent.srcObject = null;
  }

  const remoteAudio = document.getElementById('remote-audio');
  if (remoteAudio) {
    remoteAudio.srcObject = null;
  }

  const placeholder = document.getElementById('remote-placeholder');
  if (placeholder) placeholder.style.display = 'flex';
}

function toggleAudio() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    const btn = document.getElementById('btn-audio');
    if (btn) btn.classList.toggle('is-off', !audioTrack.enabled);
  }
}

function toggleVideo() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    const btn = document.getElementById('btn-video');
    if (btn) btn.classList.toggle('is-off', !videoTrack.enabled);
  }
}

function toggleFullScreen() {
  const elem = document.getElementById('video-chat-container');
  if (!document.fullscreenElement) {
    elem.requestFullscreen().catch(err => console.error(err));
  } else {
    document.exitFullscreen();
  }
}

function updateConnectionStatus(message, state) {
  const text = document.getElementById('status-text');
  const dot = document.getElementById('status-dot');
  if (text) text.innerText = message;
  if (dot) {
    dot.className = 'status-dot';
    if (state === 'active') dot.classList.add('active');
    if (state === 'error') dot.classList.add('error');
  }
}

// Inicialización automática al cargar el DOM
window.addEventListener('DOMContentLoaded', showVideoConference);
