/**
 * =============================================================================
 * TRABAJO PRÁCTICO WEBRTC - E.E.T. Nº 3139 “GRAL. MARTÍN M. DE GÜEMES”
 * Archivo: js/main.js
 * Descripción: Implementación completa estilo WhatsApp para videollamadas P2P
 * =============================================================================
 */

// Elementos HTML de video e interfaz
var localVideoComponent;
var remoteVideoComponent;
var localStream = null;

// Cola para almacenar candidatos ICE remotos recibidos antes de fijar la descripción remota
let iceCandidatesQueue = [];

// Estado de la llamada
let isCallInitiator = false;

// Configuración de restricciones multimedia
const mediaConstraints = {
  audio: true,
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: "user" // Prioriza cámara frontal en celulares
  }
};

// Servidores STUN públicos provistos por Google para NAT Traversal
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Instancia dinámica de RTCPeerConnection
let pc = null;

/**
 * Crea o recupera la instancia activa de RTCPeerConnection.
 * Si fue cerrada previamente, genera una nueva limpia.
 */
function getPeerConnection() {
  if (pc && pc.signalingState !== 'closed') {
    return pc;
  }

  console.log("[WebRTC] Creando nueva instancia RTCPeerConnection...");
  pc = new RTCPeerConnection(iceServers);

  // 1. Detección y envío de candidatos ICE locales
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      signaling.send({ candidate });
    }
  };

  // 2. Recepción de flujo multimedia remoto
  pc.ontrack = (event) => {
    console.log("[WebRTC] Pista remota recibida:", event.track.kind);
    const stream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
    setupVideoElement(remoteVideoComponent, stream, false);

    const placeholder = document.getElementById('remote-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    closeCallModal();
    updateConnectionStatus("En videollamada", "active");
  };

  return pc;
}

/**
 * Configura y reproduce un elemento de video de forma segura para navegadores móviles y desktop
 */
function setupVideoElement(videoEl, stream, isMuted) {
  if (!videoEl) return;
  videoEl.srcObject = stream;
  videoEl.muted = isMuted;
  videoEl.playsInline = true;
  videoEl.setAttribute('playsinline', '');
  videoEl.setAttribute('webkit-playsinline', '');
  videoEl.play().catch(e => console.warn("[WebRTC] Error al reproducir video:", e));
}

// =============================================================================
// GESTIÓN DE PERIFÉRICOS CON VIDEO SINTÉTICO PARA PC SIN WEBCAM
// =============================================================================

/**
 * Genera un video sintético ligero (Canvas) para computadoras que no tienen cámara física.
 * Esto asegura que la PC siempre envíe una pista de video y que el celular la reciba sin errores.
 */
function createFallbackVideoTrack() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(320, 200, 75, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#3b82f6';
  ctx.beginPath();
  ctx.arc(320, 180, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(320, 275, 52, Math.PI, 0, false);
  ctx.fill();

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 20px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PC (Solo Micrófono)', 320, 350);

  const stream = canvas.captureStream(5);
  return stream.getVideoTracks()[0];
}

/**
 * Obtiene los dispositivos locales con fallback:
 * - Si tiene cámara (celular o notebook): usa cámara real y micrófono.
 * - Si no tiene cámara (PC de escritorio): usa micrófono real + pista de video sintética.
 */
async function acquireLocalMedia() {
  if (localStream) return localStream;

  // Intento 1: Cámara física y Micrófono
  try {
    localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    console.log("[WebRTC] Cámara web y micrófono obtenidos con éxito.");
    setupVideoElement(localVideoComponent, localStream, true);
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
    setupVideoElement(localVideoComponent, localStream, true);
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
        console.log(`[WebRTC] Pista añadida al Peer: ${track.kind}`);
      }
    });
  }
}

// =============================================================================
// CANAL DE SEÑALIZACIÓN WEBSOCKET
// =============================================================================
const signaling = {
  ws: null,

  connect: function(url) {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      updateConnectionStatus("Conectado", "active");
      console.log("[Signaling] WebSocket conectado.");
    };

    this.ws.onclose = () => {
      updateConnectionStatus("Desconectado", "error");
      console.log("[Signaling] WebSocket cerrado.");
    };

    this.ws.onerror = (err) => {
      console.error("[Signaling] Error WebSocket:", err);
      updateConnectionStatus("Error servidor", "error");
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

  send: function(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn("[Signaling] Canal cerrado. No enviado:", data);
    }
  },

  onmessage: null
};

// =============================================================================
// GESTIÓN DEL FLUJO DE LLAMADA TIPO WHATSAPP
// =============================================================================

/**
 * El usuario presiona el botón principal "Llamar":
 * Muestra pantalla de llamada saliente y avisa al par mediante señalización.
 */
function initiateCall() {
  isCallInitiator = true;
  showOutgoingModal();
  signaling.send({ type: 'call-request' });
  updateConnectionStatus("Llamando...", "active");
}

/**
 * Se recibe una solicitud de llamada del par: Muestra modal de llamada entrante
 */
function handleIncomingCallRequest() {
  isCallInitiator = false;
  showIncomingModal();
  updateConnectionStatus("Llamada entrante...", "active");
}

/**
 * El usuario atiende la llamada entrante:
 * Cierra modal, avisa que aceptó y queda a la espera de la Oferta SDP
 */
async function acceptIncomingCall() {
  closeCallModal();
  updateConnectionStatus("Conectando...", "active");
  await acquireLocalMedia();
  ensureLocalTracksAdded();
  signaling.send({ type: 'call-accepted' });
}

/**
 * El usuario rechaza la llamada entrante
 */
function rejectIncomingCall() {
  closeCallModal();
  signaling.send({ type: 'call-rejected' });
  updateConnectionStatus("Llamada rechazada", "standby");
}

/**
 * El que llamó cancela la llamada antes de que atiendan
 */
function cancelOutgoingCall() {
  closeCallModal();
  signaling.send({ type: 'call-cancelled' });
  updateConnectionStatus("Llamada cancelada", "standby");
}

// Modales de llamada
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
  if (subtitle) subtitle.innerText = "Esperando que atiendan...";
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

    // 1. Mensajes del protocolo de llamada estilo WhatsApp
    if (type === 'call-request') {
      handleIncomingCallRequest();
      return;
    }

    if (type === 'call-accepted') {
      console.log("[Signaling] El par aceptó la llamada. Iniciando negociación SDP...");
      closeCallModal();
      updateConnectionStatus("Conectando...", "active");

      // El llamador inicia la oferta SDP
      await acquireLocalMedia();
      const peer = getPeerConnection();
      ensureLocalTracksAdded();

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      signaling.send({ desc: peer.localDescription });
      return;
    }

    if (type === 'call-rejected') {
      closeCallModal();
      updateConnectionStatus("Llamada rechazada", "standby");
      return;
    }

    if (type === 'call-cancelled') {
      closeCallModal();
      updateConnectionStatus("Llamada cancelada", "standby");
      return;
    }

    if (type === 'peer-disconnected') {
      closeCallModal();
      updateConnectionStatus("Par desconectado", "standby");
      if (remoteVideoComponent) remoteVideoComponent.srcObject = null;
      const placeholder = document.getElementById('remote-placeholder');
      if (placeholder) placeholder.style.display = 'flex';
      if (pc) {
        pc.close();
        pc = null;
      }
      return;
    }

    // 2. Recepción de SDP (Oferta o Respuesta)
    if (desc) {
      const peer = getPeerConnection();

      if (desc.type === 'offer') {
        console.log("[WebRTC] Oferta SDP recibida. Procesando respuesta...");
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

    // 3. Recepción de Candidato ICE
    } else if (candidate) {
      const peer = getPeerConnection();
      if (peer.remoteDescription && peer.remoteDescription.type) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        iceCandidatesQueue.push(candidate);
      }
    }
  } catch (err) {
    console.error("[WebRTC] Error en señalización:", err);
  }
};

/**
 * Aplica los candidatos ICE acumulados en la cola tras fijar la descripción remota
 */
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

/**
 * Inicializa la cámara o micrófono al cargar la página y conecta con el servidor
 */
async function showVideoConference() {
  localVideoComponent = document.getElementById('local-video');
  remoteVideoComponent = document.getElementById('remote-video');

  try {
    await acquireLocalMedia();

    // Conexión dinámica por WebSocket
    const isHttp = window.location.protocol.startsWith('http');
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = isHttp ? window.location.host : 'localhost:3000';
    signaling.connect(`${wsProtocol}//${wsHost}`);
  } catch (err) {
    console.error("[WebRTC] Error durante la inicialización:", err);
    updateConnectionStatus("Error al iniciar", "error");
  }
}

/**
 * Cortar o finalizar la llamada activa
 */
function hangUp() {
  closeCallModal();

  if (pc) {
    pc.close();
    pc = null;
  }

  if (remoteVideoComponent) {
    remoteVideoComponent.srcObject = null;
  }

  const placeholder = document.getElementById('remote-placeholder');
  if (placeholder) placeholder.style.display = 'flex';

  updateConnectionStatus("Llamada finalizada", "standby");
}

/**
 * Alterna el silencio del micrófono
 */
function toggleAudio() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    const btn = document.getElementById('btn-audio');
    if (btn) btn.classList.toggle('is-off', !audioTrack.enabled);
  }
}

/**
 * Alterna la activación/pausa de la cámara de video
 */
function toggleVideo() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    const btn = document.getElementById('btn-video');
    if (btn) btn.classList.toggle('is-off', !videoTrack.enabled);
  }
}

/**
 * Alterna el modo pantalla completa del contenedor principal
 */
function toggleFullScreen() {
  const elem = document.getElementById('video-chat-container');
  if (!document.fullscreenElement) {
    elem.requestFullscreen().catch(err => console.error(err));
  } else {
    document.exitFullscreen();
  }
}

/**
 * Actualiza la insignia de estado en la barra superior
 */
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

// Inicialización automática al cargar el documento
window.addEventListener('DOMContentLoaded', showVideoConference);
