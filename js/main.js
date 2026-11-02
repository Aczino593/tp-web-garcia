/**
 * =============================================================================
 * TRABAJO PRÁCTICO WEBRTC - E.E.T. Nº 3139 “GRAL. MARTÍN M. DE GÜEMES”
 * Archivo: js/main.js
 * Descripción: Implementación robusta de la API WebRTC para videollamadas P2P
 * =============================================================================
 */

// Elementos HTML de video e interfaz
var localVideoComponent;
var remoteVideoComponent;
var localStream = null;

// Cola para almacenar candidatos ICE remotos recibidos antes de fijar la descripción remota
let iceCandidatesQueue = [];

// Configuración de restricciones multimedia
const mediaConstraints = {
  audio: true,
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: "user" // En celulares, prioriza la cámara frontal
  }
};

// Servidores STUN públicos provistos por Google para NAT Traversal
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Variable para la instancia RTCPeerConnection (se inicializa y recrea dinámicamente)
let pc = null;

/**
 * Obtiene o inicializa la conexión RTCPeerConnection activa.
 * Si la conexión previa fue cerrada, crea una nueva limpia para evitar el error 'closed'.
 */
function getPeerConnection() {
  if (pc && pc.signalingState !== 'closed') {
    return pc;
  }

  console.log("[WebRTC] Creando nueva instancia de RTCPeerConnection...");
  pc = new RTCPeerConnection(iceServers);

  // 1. Envío de candidatos ICE locales
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      console.log("[WebRTC] Candidato ICE local generado. Enviando...");
      signaling.send({ candidate });
    }
  };

  // 2. Recepción de pistas de audio y video remotas
  pc.ontrack = (event) => {
    console.log("[WebRTC] Pista remota recibida.");
    if (remoteVideoComponent.srcObject) return;
    remoteVideoComponent.srcObject = event.streams[0];

    const placeholder = document.getElementById('remote-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    updateConnectionStatus("En videollamada", "active");
  };

  return pc;
}

// =============================================================================
// GESTIÓN DE PERIFÉRICOS Y PISTAS MULTIMEDIA LOCALES
// Soporte adaptativo para PC de escritorio (sin cámara web) y celulares
// =============================================================================

/**
 * Obtiene los dispositivos locales con fallback:
 * 1. Intenta Cámara y Micrófono.
 * 2. Si la PC de escritorio no tiene cámara web, obtiene solo el Micrófono.
 */
async function acquireLocalMedia() {
  if (localStream) return localStream;

  // Intento 1: Cámara y Micrófono
  try {
    localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    console.log("[WebRTC] Cámara y micrófono capturados.");
    if (localVideoComponent) localVideoComponent.srcObject = localStream;
    hideNoCameraPlaceholder();
    return localStream;
  } catch (errVideo) {
    console.warn("[WebRTC] Sin cámara física. Intentando solo micrófono...", errVideo);
  }

  // Intento 2: Solo Micrófono (ideal para PCs de escritorio)
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log("[WebRTC] Micrófono capturado (Modo solo audio).");
    showNoCameraPlaceholder("Micrófono activo (PC sin cámara)");
    return localStream;
  } catch (errAudio) {
    console.warn("[WebRTC] Sin micrófono o permiso denegado:", errAudio);
  }

  showNoCameraPlaceholder("Sin cámara ni micrófono");
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
 * Agrega las pistas multimedia locales al RTCPeerConnection activo.
 * Si la PC no tiene cámara, agrega un transceiver 'recvonly' para recibir el video del par.
 */
function ensureLocalTracksAdded() {
  const peer = getPeerConnection();

  if (localStream) {
    const senders = peer.getSenders();
    localStream.getTracks().forEach((track) => {
      const alreadyAdded = senders.some(s => s.track && s.track.id === track.id);
      if (!alreadyAdded) {
        peer.addTrack(track, localStream);
        console.log(`[WebRTC] Pista local agregada: ${track.kind}`);
      }
    });
  }

  // Si no tenemos cámara para enviar, nos preparamos para RECIBIR video del par
  const hasVideoSender = peer.getSenders().some(s => s.track && s.track.kind === 'video');
  const hasVideoTransceiver = peer.getTransceivers().some(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'video');
  if (!hasVideoSender && !hasVideoTransceiver) {
    try {
      peer.addTransceiver('video', { direction: 'recvonly' });
      console.log("[WebRTC] Transceiver video configurado en modo recvonly.");
    } catch (e) {
      console.warn("[WebRTC] Transceiver error:", e);
    }
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
      updateConnectionStatus("Servidor conectado", "active");
      console.log("[Signaling] Conectado exitosamente.");
    };

    this.ws.onclose = () => {
      updateConnectionStatus("Servidor desconectado", "error");
      console.log("[Signaling] Conexión cerrada.");
    };

    this.ws.onerror = (err) => {
      console.error("[Signaling] Error WebSocket:", err);
      updateConnectionStatus("Error de conexión", "error");
    };

    this.ws.onmessage = async (message) => {
      try {
        const data = JSON.parse(message.data);
        if (this.onmessage) {
          await this.onmessage(data);
        }
      } catch (err) {
        console.error("[Signaling] Error al procesar JSON:", err);
      }
    };
  },

  send: function(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn("[Signaling] Servidor no disponible:", data);
    }
  },

  onmessage: null
};

// =============================================================================
// PROCESAMIENTO DE MENSAJES DE SEÑALIZACIÓN
// =============================================================================
signaling.onmessage = async (data) => {
  try {
    const { desc, candidate, type, peerId } = data;

    // 1. Bienvenida o desconexión
    if (type === 'welcome') {
      console.log(`[Signaling] Asignado como: ${peerId}`);
      updateConnectionStatus(`Conectado (${peerId})`, "active");
      return;
    }

    if (type === 'peer-disconnected') {
      console.log(`[Signaling] El par ${peerId} se desconectó.`);
      updateConnectionStatus("Par desconectado", "standby");

      if (remoteVideoComponent) remoteVideoComponent.srcObject = null;
      const placeholder = document.getElementById('remote-placeholder');
      if (placeholder) placeholder.style.display = 'flex';

      // Resetear la conexión para que quede lista para una próxima llamada
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
        console.log("[WebRTC] Oferta SDP recibida. Procesando...");
        updateConnectionStatus("Conectando...", "active");

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
    console.error("[WebRTC] Error al procesar señalización:", err);
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
      console.warn("[WebRTC] Error aplicando candidato en cola:", e);
    }
  }
}

// =============================================================================
// FUNCIONES DE CONTROL DE LA APLICACIÓN
// =============================================================================

/**
 * Inicializa la cámara o micrófono y conecta con el servidor de señalización
 */
async function showVideoConference() {
  localVideoComponent = document.getElementById('local-video');
  remoteVideoComponent = document.getElementById('remote-video');

  try {
    await acquireLocalMedia();
    ensureLocalTracksAdded();

    if (localStream && localStream.getVideoTracks().length > 0) {
      updateConnectionStatus("Cámara lista", "standby");
    } else if (localStream && localStream.getAudioTracks().length > 0) {
      updateConnectionStatus("Micrófono listo (Sin cámara)", "standby");
    } else {
      updateConnectionStatus("Modo receptor", "standby");
    }

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
 * Inicia la llamada creando la oferta SDP
 */
async function start() {
  try {
    updateConnectionStatus("Llamando...", "active");

    await acquireLocalMedia();
    const peer = getPeerConnection();
    ensureLocalTracksAdded();

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    signaling.send({ desc: peer.localDescription });
    console.log("[WebRTC] Llamada iniciada. Oferta enviada.");
  } catch (err) {
    console.error("[WebRTC] Error al iniciar la llamada:", err);
    updateConnectionStatus("Error al llamar", "error");
  }
}

/**
 * Finaliza la videollamada y resetea la conexión para permitir llamadas futuras
 */
function hangUp() {
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
