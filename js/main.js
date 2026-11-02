/**
 * =============================================================================
 * TRABAJO PRÁCTICO WEBRTC - E.E.T. Nº 3139 “GRAL. MARTÍN M. DE GÜEMES”
 * Archivo: js/main.js
 * Descripción: Implementación completa para videollamada P2P con soporte móvil y desktop
 * =============================================================================
 */

// Elementos HTML de video e interfaz
var localVideoComponent;
var remoteVideoComponent;
var localStream = null;
var remoteMediaStream = null;

// Cola para almacenar candidatos ICE recibidos antes de fijar la descripción remota
let iceCandidatesQueue = [];

// Temporizador para el video sintético de la PC
let fallbackCanvasInterval = null;

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

  // 1. Envío de candidatos ICE locales
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
      updateConnectionStatus("Fallo de conexión P2P", "error");
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

    // Agregar la pista al stream persistente (sin sobreescribir las anteriores)
    const existing = remoteMediaStream.getTracks().find(t => t.kind === event.track.kind);
    if (existing) {
      remoteMediaStream.removeTrack(existing);
    }
    remoteMediaStream.addTrack(event.track);

    // Asignar al elemento de video y forzar reproducción
    setupRemoteVideoElement(remoteMediaStream);

    const placeholder = document.getElementById('remote-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    closeCallModal();
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

  // Intento 1: Reproducir con sonido habilitado
  remoteVideoComponent.muted = false;
  remoteVideoComponent.play().then(() => {
    console.log("[WebRTC] Reproducción remota activa con sonido.");
    hideUnmuteBanner();
  }).catch((err) => {
    console.warn("[WebRTC] Autoplay con audio restringido por el navegador. Reproduciendo video silenciado...", err);
    // Intento 2: Si el navegador bloqueó el audio, silenciar temporalmente para QUE EL VIDEO SE MUESTRE
    remoteVideoComponent.muted = true;
    remoteVideoComponent.play().then(() => {
      console.log("[WebRTC] Video remoto visible. Mostrando aviso para activar sonido.");
      showUnmuteBanner();
      // Cualquier clic en la pantalla activará el sonido automáticamente
      document.addEventListener('click', unmuteRemoteAudio, { once: true });
    }).catch(e => console.error("[WebRTC] Error fatal al reproducir video:", e));
  });
}

/**
 * Desbloquea el sonido del video remoto cuando el usuario interactúa
 */
function unmuteRemoteAudio() {
  if (remoteVideoComponent) {
    remoteVideoComponent.muted = false;
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

// =============================================================================
// GESTIÓN DE PERIFÉRICOS CON VIDEO SINTÉTICO ACTIVO
// =============================================================================

/**
 * Genera un video sintético ligero con animación continua (10 fps).
 * Al generar fotogramas activos constantemente, el códec WebRTC siempre
 * transmite video en vivo hacia el celular sin congelarse.
 */
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

    // Anillo exterior animado
    const pulse = Math.sin(angle) * 8;
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(320, 195, 76 + pulse, 0, Math.PI * 2);
    ctx.stroke();

    // Fondo avatar
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(320, 195, 70, 0, Math.PI * 2);
    ctx.fill();

    // Ícono micrófono
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(320, 175, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(320, 265, 48, Math.PI, 0, false);
    ctx.fill();

    // Texto descriptivo
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

/**
 * Obtiene los dispositivos locales:
 * - Con cámara (celular): cámara real frontal + micrófono.
 * - Sin cámara (PC de escritorio): micrófono real + video sintético animado.
 */
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

  // Intento 2: Micrófono real + Video sintético
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

/**
 * Agrega todas las pistas locales (audio y video) al PeerConnection
 */
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
// CANAL DE SEÑALIZACIÓN WEBSOCKET CON AUTORRECONEXIÓN Y KEEPALIVE
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
      updateConnectionStatus("Conectado", "active");
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
// GESTIÓN DEL FLUJO DE LLAMADA TIPO WHATSAPP
// =============================================================================

function initiateCall() {
  showOutgoingModal();
  signaling.send({ type: 'call-request' });
  updateConnectionStatus("Llamando...", "active");
}

function handleIncomingCallRequest() {
  showIncomingModal();
  updateConnectionStatus("Llamada entrante...", "active");
}

async function acceptIncomingCall() {
  closeCallModal();
  updateConnectionStatus("Conectando...", "active");
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
  const modal = document.getElementById('call-modal');
  const title = document.getElementById('call-modal-title');
  const subtitle = document.getElementById('call-modal-subtitle');
  const incoming = document.getElementById('incoming-actions');
  const outgoing = document.getElementById('outgoing-actions');

  if (title) title.innerText = "Llamando...";
  if (subtitle) subtitle.innerText = "Esperando respuesta...";
  if (incoming) incoming.style.display = 'none';
  if (outgoing) outgoing.style.display = 'flex';
  if (modal) modal.style.display = 'flex';
}

function closeCallModal() {
  const modal = document.getElementById('call-modal');
  if (modal) modal.style.display = 'none';
}

// =============================================================================
// PROCESAMIENTO DE MENSAJES DE SEÑALIZACIÓN
// =============================================================================
signaling.onmessage = async (data) => {
  try {
    const { desc, candidate, type, peerId } = data;

    if (type === 'call-request') {
      handleIncomingCallRequest();
      return;
    }

    if (type === 'call-accepted') {
      console.log("[Signaling] El par aceptó la llamada. Generando Oferta SDP...");
      closeCallModal();
      updateConnectionStatus("Negociando...", "active");

      await acquireLocalMedia();
      const peer = getPeerConnection();
      ensureLocalTracksAdded();

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      signaling.send({ desc: peer.localDescription });
      return;
    }

    if (type === 'call-rejected') {
      resetCallState();
      updateConnectionStatus("Llamada rechazada", "standby");
      return;
    }

    if (type === 'call-cancelled' || type === 'call-ended') {
      resetCallState();
      updateConnectionStatus("Llamada finalizada", "standby");
      return;
    }

    if (type === 'peer-disconnected') {
      updateConnectionStatus("Par desconectado", "standby");
      resetCallState();
      return;
    }

    // Recepción de SDP
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

    // Recepción de Candidato ICE
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

  try {
    await acquireLocalMedia();

    const isHttp = window.location.protocol.startsWith('http');
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = isHttp ? window.location.host : 'localhost:3000';
    signaling.connect(`${wsProtocol}//${wsHost}`);
  } catch (err) {
    console.error("[WebRTC] Error de inicio:", err);
    updateConnectionStatus("Error al iniciar", "error");
  }
}

function hangUp() {
  resetCallState();
  signaling.send({ type: 'call-ended' });
  updateConnectionStatus("Llamada finalizada", "standby");
}

function resetCallState() {
  hideUnmuteBanner();
  closeCallModal();

  if (pc) {
    try {
      pc.close();
    } catch (e) {}
    pc = null;
  }

  // Limpiar cola de candidatos ICE acumulados para la próxima llamada
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

// Inicialización automática
window.addEventListener('DOMContentLoaded', showVideoConference);
