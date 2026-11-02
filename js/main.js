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

// Datos de usuario y sala
let myPeerId = "Yo";
let isVideoCallActive = false;

// Configuración de restricciones multimedia
const mediaConstraints = {
  audio: true,
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: "user" // Prioriza cámara frontal en celulares
  }
};

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

  // 1. Detección y envío de candidatos ICE locales
  pc.onicecandidate = ({ candidate }) => {
    if (candidate && candidate.candidate) {
      signaling.send({ candidate });
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

  // 3. Recepción de pistas de audio y video remotas
  pc.ontrack = (event) => {
    console.log("[WebRTC] Pista remota recibida:", event.track.kind);

    if (!remoteMediaStream) {
      remoteMediaStream = new MediaStream();
    }

    const existing = remoteMediaStream.getTracks().find(t => t.kind === event.track.kind);
    if (existing) {
      remoteMediaStream.removeTrack(existing);
    }
    remoteMediaStream.addTrack(event.track);

    setupRemoteVideoElement(remoteMediaStream);

    const placeholder = document.getElementById('remote-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    closeCallModal();
    openVideoOverlay();
    updateConnectionStatus("En videollamada", "active");
  };

  return pc;
}

/**
 * Configura la reproducción remota manejando de forma segura las restricciones de autoplay
 */
function setupRemoteVideoElement(stream) {
  if (!remoteVideoComponent) return;

  remoteVideoComponent.srcObject = stream;
  remoteVideoComponent.playsInline = true;
  remoteVideoComponent.setAttribute('playsinline', '');
  remoteVideoComponent.setAttribute('webkit-playsinline', '');

  remoteVideoComponent.muted = false;
  remoteVideoComponent.play().then(() => {
    console.log("[WebRTC] Reproducción remota activa con sonido.");
    hideUnmuteBanner();
  }).catch((err) => {
    console.warn("[WebRTC] Autoplay con audio restringido. Silenciando para mostrar video...", err);
    remoteVideoComponent.muted = true;
    remoteVideoComponent.play().then(() => {
      console.log("[WebRTC] Video remoto visible. Mostrando botón de audio.");
      showUnmuteBanner();
      document.addEventListener('click', unmuteRemoteAudio, { once: true });
    }).catch(e => console.error("[WebRTC] Error fatal:", e));
  });
}

function unmuteRemoteAudio() {
  if (remoteVideoComponent) {
    remoteVideoComponent.muted = false;
    remoteVideoComponent.play().catch(e => console.warn(e));
  }
  hideUnmuteBanner();
  console.log("[WebRTC] Audio remoto activado.");
}

function showUnmuteBanner() {
  const banner = document.getElementById('unmute-banner');
  if (banner) banner.style.display = 'flex';
}

function hideUnmuteBanner() {
  const banner = document.getElementById('unmute-banner');
  if (banner) banner.style.display = 'none';
}

// =============================================================================
// GESTIÓN DE PERIFÉRICOS CON VIDEO SINTÉTICO ACTIVO
// =============================================================================

function createFallbackVideoTrack() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  let angle = 0;

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
    ctx.fillText('PC (Solo Micrófono)', 320, 350);
  }

  draw();
  if (fallbackCanvasInterval) clearInterval(fallbackCanvasInterval);
  fallbackCanvasInterval = setInterval(draw, 100);

  const stream = canvas.captureStream(10);
  return stream.getVideoTracks()[0];
}

async function acquireLocalMedia() {
  if (localStream) return localStream;

  // Intento 1: Cámara web física y Micrófono
  try {
    localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    console.log("[WebRTC] Cámara web y micrófono obtenidos con éxito.");
    if (localVideoComponent) {
      localVideoComponent.srcObject = localStream;
      localVideoComponent.muted = true;
      localVideoComponent.playsInline = true;
      localVideoComponent.play().catch(e => console.warn(e));
    }
    hideNoCameraPlaceholder();
    return localStream;
  } catch (errVideo) {
    console.warn("[WebRTC] Sin cámara física. Activando micrófono y video sintético...", errVideo);
  }

  // Intento 2: Micrófono real + Video sintético (PC de escritorio)
  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const fallbackVideo = createFallbackVideoTrack();
    audioStream.addTrack(fallbackVideo);

    localStream = audioStream;
    console.log("[WebRTC] Micrófono y pista de video adaptativa listos.");

    if (localVideoComponent) {
      localVideoComponent.srcObject = localStream;
      localVideoComponent.muted = true;
      localVideoComponent.playsInline = true;
      localVideoComponent.play().catch(e => console.warn(e));
    }

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
// MOTOR DE CHAT EN TIEMPO REAL ESTILO WHATSAPP
// =============================================================================

function formatCurrentTime() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Enviar mensaje de chat
 */
function handleSendMessage(event) {
  if (event) event.preventDefault();

  const input = document.getElementById('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  const timeStr = formatCurrentTime();

  // 1. Agregar burbuja a mi pantalla (verde, a la derecha)
  appendChatMessage(text, timeStr, true);

  // 2. Enviar por WebSocket al otro par
  signaling.send({
    type: 'chat-message',
    text: text,
    sender: myPeerId,
    time: timeStr
  });

  // 3. Actualizar vista previa lateral
  updateLastMessagePreview("Tú: " + text, timeStr);
  playMessagePop();

  input.value = "";
  input.focus();
}

/**
 * Agrega una burbuja de mensaje al contenedor
 */
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
    // Doble tilde azul de WhatsApp
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

  // Scroll automático hacia abajo
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
      // Primer tono (440 Hz)
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

      // Segundo tono (554 Hz)
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
  showOutgoingModal();
  updateConnectionStatus("Llamando...", "active");

  const subtitle = document.getElementById('call-modal-subtitle');
  if (currentRoomPeers < 2) {
    if (subtitle) subtitle.innerText = "Esperando que tu compañero se conecte a la sala...";
  } else {
    if (subtitle) subtitle.innerText = "Esperando que atiendan...";
  }

  // Pre-cargar periféricos locales de forma asíncrona
  acquireLocalMedia().catch(e => console.warn(e));

  signaling.send({ type: 'call-request' });
}

function handleIncomingCallRequest() {
  showIncomingModal();
  updateConnectionStatus("Llamada entrante...", "active");
}

async function acceptIncomingCall() {
  closeCallModal();
  updateConnectionStatus("Conectando...", "active");
  openVideoOverlay();

  await acquireLocalMedia();
  ensureLocalTracksAdded();
  signaling.send({ type: 'call-accepted' });
}

function rejectIncomingCall() {
  closeCallModal();
  signaling.send({ type: 'call-rejected' });
  updateConnectionStatus("Llamada rechazada", "standby");
}

function cancelOutgoingCall() {
  closeCallModal();
  signaling.send({ type: 'call-cancelled' });
  updateConnectionStatus("Llamada cancelada", "standby");
}

function showIncomingModal() {
  playIncomingTone();
  const modal = document.getElementById('call-modal');
  const title = document.getElementById('call-modal-title');
  const subtitle = document.getElementById('call-modal-subtitle');
  const incoming = document.getElementById('incoming-actions');
  const outgoing = document.getElementById('outgoing-actions');

  if (title) title.innerText = "Llamada entrante";
  if (subtitle) subtitle.innerText = "Videollamada WebRTC P2P";
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

/**
 * Minimiza la videollamada a una ventanita flotante para poder ver el chat mientras hablas
 */
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
    const { desc, candidate, type, peerId, totalPeers, text, time } = data;

    // 1. Mensaje de bienvenida del servidor
    if (type === 'welcome') {
      myPeerId = peerId;
      const myNameEl = document.getElementById('my-peer-name');
      if (myNameEl) myNameEl.innerText = `${peerId}`;
      console.log(`[Signaling] Identificado como: ${peerId}`);
      return;
    }

    // 2. Estado de la sala (usuarios conectados)
    if (type === 'room-status') {
      currentRoomPeers = totalPeers || 1;
      const isOnline = currentRoomPeers >= 2;
      const onlineDot = document.getElementById('peer-online-dot');
      const headerStatus = document.getElementById('chat-header-status');
      const contactTitle = document.getElementById('peer-contact-title');

      if (isOnline) {
        if (onlineDot) onlineDot.classList.remove('offline');
        if (headerStatus) {
          headerStatus.innerText = "En línea";
          headerStatus.classList.add('online');
        }
        if (contactTitle) contactTitle.innerText = "Compañero (En línea)";
        updateLastMessagePreview("En línea - Toca para chatear o llamar");
      } else {
        if (onlineDot) onlineDot.classList.add('offline');
        if (headerStatus) {
          headerStatus.innerText = "Esperando que se una...";
          headerStatus.classList.remove('online');
        }
        if (contactTitle) contactTitle.innerText = "Compañero";
        updateLastMessagePreview("Esperando conexión...");
      }
      return;
    }

    // 3. Mensaje de chat recibido del par
    if (type === 'chat-message') {
      appendChatMessage(text, time || formatCurrentTime(), false);
      updateLastMessagePreview(text, time || formatCurrentTime());
      playMessagePop();

      // Si está en móvil y en la pantalla de lista, mostrar badge
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
      handleIncomingCallRequest();
      return;
    }

    // 5. El par aceptó la llamada
    if (type === 'call-accepted') {
      console.log("[Signaling] El par aceptó la llamada. Generando Oferta SDP...");
      closeCallModal();
      openVideoOverlay();
      updateConnectionStatus("Conectando...", "active");

      await acquireLocalMedia();
      const peer = getPeerConnection();
      ensureLocalTracksAdded();

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      signaling.send({ desc: peer.localDescription });
      return;
    }

    // 6. Rechazo o cancelación de llamada
    if (type === 'call-rejected') {
      resetCallState();
      updateConnectionStatus("Llamada rechazada", "standby");
      appendSystemMessage("Llamada rechazada por el compañero.");
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
      appendSystemMessage("El compañero se ha desconectado.");
      return;
    }

    // 7. Negociación SDP
    if (desc) {
      const peer = getPeerConnection();

      if (desc.type === 'offer') {
        console.log("[WebRTC] Oferta SDP recibida. Generando Respuesta...");
        await acquireLocalMedia();
        ensureLocalTracksAdded();

        await peer.setRemoteDescription(desc);
        await drainIceQueue();

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        signaling.send({ desc: peer.localDescription });
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
  signaling.send({ type: 'call-ended' });
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
