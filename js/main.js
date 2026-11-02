/**
 * =============================================================================
 * TRABAJO PRÁCTICO WEBRTC - E.E.T. Nº 3139 “GRAL. MARTÍN M. DE GÜEMES”
 * Archivo: js/main.js
 * Descripción: Implementación de la API WebRTC para videollamadas punto a punto
 * =============================================================================
 */

// Elementos HTML de video
var localVideoComponent;
var remoteVideoComponent;
var localStream = null;

// Configuración de restricciones multimedia (audio y video)
const mediaConstraints = {
  audio: true,
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 }
  }
};

// Servidores STUN públicos y gratuitos provistos por Google
// Permiten descubrir la IP pública y puerto para atravesar NAT y cortafuegos
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Instancia de RTCPeerConnection: administra la conexión entre los dos dispositivos pares
const pc = new RTCPeerConnection(iceServers);

// =============================================================================
// CANAL DE SEÑALIZACIÓN (Signaling Channel)
// Módulo para el intercambio de mensajes SDP (oferta/respuesta) y candidatos ICE
// =============================================================================
const signaling = {
  ws: null,

  // Inicializa la conexión WebSocket con el servidor de señalización
  connect: function(url) {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      updateConnectionStatus("Servidor de señalización conectado", "active");
      console.log("[Signaling] Conectado exitosamente al servidor WebSocket.");
    };

    this.ws.onclose = () => {
      updateConnectionStatus("Servidor de señalización desconectado", "error");
      console.log("[Signaling] Conexión cerrada.");
    };

    this.ws.onerror = (err) => {
      console.error("[Signaling] Error en la conexión WebSocket:", err);
      updateConnectionStatus("Error de conexión al servidor", "error");
    };

    // Escucha y deserializa los mensajes recibidos del par remoto
    this.ws.onmessage = async (message) => {
      try {
        const data = JSON.parse(message.data);
        if (this.onmessage) {
          await this.onmessage(data);
        }
      } catch (err) {
        console.error("[Signaling] Error al procesar mensaje JSON entrante:", err);
      }
    };
  },

  // Envía un payload JSON a través del servidor hacia el otro par
  send: function(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn("[Signaling] Servidor no disponible. No se pudo enviar:", data);
    }
  },

  onmessage: null
};

// =============================================================================
// EVENTOS DE RTCPeerConnection
// =============================================================================

// 1. Detección y envío de candidatos ICE locales
// Se dispara cuando el navegador descubre una nueva vía de conexión de red
pc.onicecandidate = ({ candidate }) => {
  if (candidate) {
    console.log("[WebRTC] Candidato ICE local generado. Enviando al par remoto...");
    signaling.send({ candidate });
  }
};

// 2. Negociación requerida (onnegotiationneeded)
// Se dispara automáticamente al agregar pistas locales de medios (audio/video)
pc.onnegotiationneeded = async () => {
  try {
    console.log("[WebRTC] Iniciando negociación: Creando oferta SDP...");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    console.log("[WebRTC] Oferta local guardada. Enviando al par remoto...");
    signaling.send({ desc: pc.localDescription });
  } catch (err) {
    console.error("[WebRTC] Error durante la creación de la oferta SDP:", err);
  }
};

// 3. Recepción de flujo multimedia remoto (ontrack)
// Se dispara cuando el par remoto empieza a transmitir audio o video
pc.ontrack = (event) => {
  console.log("[WebRTC] Flujo multimedia remoto recibido del par.");
  if (remoteVideoComponent.srcObject) return;
  remoteVideoComponent.srcObject = event.streams[0];

  // Ocultar pantalla de espera
  const placeholder = document.getElementById('remote-placeholder');
  if (placeholder) placeholder.style.display = 'none';

  updateConnectionStatus("Llamada en curso (P2P Establecido)", "active");
};

// =============================================================================
// PROCESAMIENTO DE MENSAJES RECIBIDOS VÍA SEÑALIZACIÓN
// =============================================================================
signaling.onmessage = async ({ desc, candidate }) => {
  try {
    if (desc) {
      // Caso 1: Se recibe una Oferta SDP del par
      if (desc.type === 'offer') {
        console.log("[WebRTC] Oferta SDP recibida. Estableciendo como descripción remota...");
        await pc.setRemoteDescription(desc);

        // Si aún no hemos capturado la cámara local, la capturamos
        if (!localStream) {
          localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
          localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
          localVideoComponent.srcObject = localStream;
        }

        console.log("[WebRTC] Creando respuesta SDP (Answer)...");
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signaling.send({ desc: pc.localDescription });

      // Caso 2: Se recibe la Respuesta SDP a una oferta previa
      } else if (desc.type === 'answer') {
        console.log("[WebRTC] Respuesta SDP recibida. Estableciendo como descripción remota...");
        await pc.setRemoteDescription(desc);
      } else {
        console.warn("[WebRTC] Tipo de SDP no reconocido:", desc.type);
      }

    // Caso 3: Se recibe un Candidato ICE del par remoto
    } else if (candidate) {
      console.log("[WebRTC] Candidato ICE remoto recibido. Agregando al RTCPeerConnection...");
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (err) {
    console.error("[WebRTC] Error al procesar señalización entrante:", err);
  }
};

// =============================================================================
// FUNCIONES DE CONTROL DE LA APLICACIÓN
// =============================================================================

/**
 * Inicializa la cámara web local y se conecta al servidor de señalización
 */
async function showVideoConference() {
  localVideoComponent = document.getElementById('local-video');
  remoteVideoComponent = document.getElementById('remote-video');

  try {
    localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    localVideoComponent.srcObject = localStream;
    updateConnectionStatus("Cámara preparada. Listo para conectar.", "standby");

    // Conexión por WebSocket al servidor local (puerto estándar 3000)
    const host = window.location.hostname || "localhost";
    signaling.connect(`ws://${host}:3000`);
  } catch (err) {
    console.error("[WebRTC] Error al acceder a la cámara o micrófono:", err);
    updateConnectionStatus("Permiso de medios denegado", "error");
  }
}

/**
 * Inicia la videollamada agregando las pistas multimedia locales
 */
async function start() {
  try {
    updateConnectionStatus("Iniciando llamada y negociando conexión...", "active");

    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      localVideoComponent.srcObject = localStream;
    }

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  } catch (err) {
    console.error("[WebRTC] Error al iniciar la llamada:", err);
  }
}

/**
 * Finaliza la videollamada, cierra la conexión WebRTC y apaga la cámara
 */
function hangUp() {
  pc.close();
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  localVideoComponent.srcObject = null;
  remoteVideoComponent.srcObject = null;

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
    btn.classList.toggle('is-off', !audioTrack.enabled);
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
    btn.classList.toggle('is-off', !videoTrack.enabled);
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
 * Actualiza el indicador visual y texto del estado de la conexión
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
