/**
 * =============================================================================
 * TRABAJO PRÁCTICO WEBRTC - E.E.T. Nº 3139 “GRAL. MARTÍN M. DE GÜEMES”
 * Archivo: js/main.js
 * Descripción: Implementación robusta y adaptativa de la API WebRTC para videollamadas P2P
 * =============================================================================
 */

// Elementos HTML de video e interfaz
var localVideoComponent;
var remoteVideoComponent;
var localStream = null;

// Cola para almacenar candidatos ICE remotos recibidos antes de fijar la descripción remota
let iceCandidatesQueue = [];

// Configuración de restricciones multimedia (audio y video en alta definición)
const mediaConstraints = {
  audio: true,
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: "user" // En celulares, prioriza la cámara frontal
  }
};

// Servidores STUN públicos y gratuitos provistos por Google para NAT Traversal
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Instancia principal de RTCPeerConnection
const pc = new RTCPeerConnection(iceServers);

// =============================================================================
// GESTIÓN DE PISTAS MULTIMEDIA LOCALES
// =============================================================================

/**
 * Asegura que las pistas de audio y video de la cámara local se hayan agregado al RTCPeerConnection.
 * Esto garantiza que tanto las Ofertas como las Respuestas incluyan los flujos de medios.
 */
function ensureLocalTracksAdded() {
  if (!localStream) return;
  const senders = pc.getSenders();
  localStream.getTracks().forEach((track) => {
    const alreadyAdded = senders.some(s => s.track && s.track.id === track.id);
    if (!alreadyAdded) {
      pc.addTrack(track, localStream);
      console.log(`[WebRTC] Pista local añadida al PeerConnection: ${track.kind}`);
    }
  });
}

// =============================================================================
// CANAL DE SEÑALIZACIÓN (Signaling Channel con WebSockets)
// =============================================================================
const signaling = {
  ws: null,

  connect: function(url) {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      updateConnectionStatus("Servidor conectado", "active");
      console.log("[Signaling] Conectado exitosamente al servidor WebSocket.");
    };

    this.ws.onclose = () => {
      updateConnectionStatus("Servidor desconectado", "error");
      updateHelperBanner("Servidor desconectado. Revisa la terminal.");
      console.log("[Signaling] Conexión cerrada.");
    };

    this.ws.onerror = (err) => {
      console.error("[Signaling] Error en la conexión WebSocket:", err);
      updateConnectionStatus("Error de conexión", "error");
    };

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
pc.onicecandidate = ({ candidate }) => {
  if (candidate) {
    console.log("[WebRTC] Candidato ICE local generado. Enviando al par remoto...");
    signaling.send({ candidate });
  }
};

// 2. Negociación requerida (onnegotiationneeded)
pc.onnegotiationneeded = async () => {
  try {
    console.log("[WebRTC] Negociación requerida: Creando oferta SDP...");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log("[WebRTC] Oferta local guardada. Enviando al par remoto...");
    signaling.send({ desc: pc.localDescription });
  } catch (err) {
    console.error("[WebRTC] Error durante la creación de la oferta SDP:", err);
  }
};

// 3. Recepción de flujo multimedia remoto (ontrack)
pc.ontrack = (event) => {
  console.log("[WebRTC] Flujo multimedia remoto recibido del par.");
  if (remoteVideoComponent.srcObject) return;
  remoteVideoComponent.srcObject = event.streams[0];

  // Ocultar pantalla de espera
  const placeholder = document.getElementById('remote-placeholder');
  if (placeholder) placeholder.style.display = 'none';

  updateConnectionStatus("En videollamada P2P", "active");
  updateHelperBanner("Videollamada activa en tiempo real");
};

// =============================================================================
// PROCESAMIENTO DE MENSAJES RECIBIDOS VÍA SEÑALIZACIÓN
// =============================================================================
signaling.onmessage = async (data) => {
  try {
    const { desc, candidate, type, peerId, totalPeers } = data;

    // 1. Mensaje de bienvenida del servidor
    if (type === 'welcome') {
      console.log(`[Signaling] Asignado como: ${peerId}. Total en sala: ${totalPeers}`);
      updateConnectionStatus(`Conectado (${peerId})`, "active");
      if (totalPeers < 2) {
        updateHelperBanner("Paso 1: Comparte este enlace con tu compañera");
        updatePlaceholderText("Esperando que tu compañera abra el enlace...");
      }
      return;
    }

    // 2. Actualización del estado de la sala (número de personas conectadas)
    if (type === 'room-status') {
      console.log(`[Signaling] Pares activos en sala: ${totalPeers}`);
      const btnStart = document.getElementById('btn-start-call');

      if (totalPeers >= 2) {
        updateHelperBanner("Tu compañera está conectada. Presiona 'Llamar'");
        updatePlaceholderText("Compañera en sala. Presiona 'Llamar' para conectar.");
        if (btnStart) btnStart.classList.add('pulse-ready');
      } else {
        updateHelperBanner("Paso 1: Comparte este enlace con tu compañera");
        updatePlaceholderText("Esperando que tu compañera abra el enlace...");
        if (btnStart) btnStart.classList.remove('pulse-ready');
      }
      return;
    }

    // 3. Notificación de desconexión del par remoto
    if (type === 'peer-disconnected') {
      console.log(`[Signaling] El par remoto ${peerId} se ha desconectado.`);
      updateConnectionStatus("Par desconectado", "standby");
      updateHelperBanner("Tu compañera se ha desconectado");

      if (remoteVideoComponent) remoteVideoComponent.srcObject = null;
      const placeholder = document.getElementById('remote-placeholder');
      if (placeholder) placeholder.style.display = 'flex';
      updatePlaceholderText("Llamada finalizada por el par.");
      return;
    }

    // 4. Recepción de Descriptores de Sesión (SDP)
    if (desc) {
      // Caso A: Se recibe una Oferta SDP del par
      if (desc.type === 'offer') {
        console.log("[WebRTC] Oferta SDP recibida. Preparando respuesta...");
        updateHelperBanner("Conectando con tu compañera...");

        // Nos aseguramos de tener la cámara local lista y de haber agregado las pistas
        if (!localStream) {
          localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
          localVideoComponent.srcObject = localStream;
        }
        ensureLocalTracksAdded();

        // Aplicamos la oferta remota
        await pc.setRemoteDescription(desc);

        // Vaciamos los candidatos ICE que hayan llegado antes del SDP
        await drainIceQueue();

        // Generamos la respuesta SDP (Answer) y la enviamos
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log("[WebRTC] Respuesta SDP generada y enviada al par.");
        signaling.send({ desc: pc.localDescription });

      // Caso B: Se recibe la Respuesta SDP a nuestra oferta previa
      } else if (desc.type === 'answer') {
        console.log("[WebRTC] Respuesta SDP recibida. Estableciendo como descripción remota...");
        await pc.setRemoteDescription(desc);

        // Vaciamos los candidatos ICE acumulados
        await drainIceQueue();
      } else {
        console.warn("[WebRTC] Tipo de SDP no reconocido:", desc.type);
      }

    // 5. Recepción de Candidato ICE del par remoto
    } else if (candidate) {
      if (pc.remoteDescription && pc.remoteDescription.type) {
        console.log("[WebRTC] Candidato ICE aplicado directamente.");
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        console.log("[WebRTC] Candidato ICE guardado en cola (esperando remoteDescription)...");
        iceCandidatesQueue.push(candidate);
      }
    }
  } catch (err) {
    console.error("[WebRTC] Error al procesar señalización entrante:", err);
  }
};

/**
 * Aplica los candidatos ICE acumulados en la cola tras fijar la descripción remota
 */
async function drainIceQueue() {
  while (iceCandidatesQueue.length > 0) {
    const candidate = iceCandidatesQueue.shift();
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      console.log("[WebRTC] Candidato ICE en cola aplicado exitosamente.");
    } catch (e) {
      console.warn("[WebRTC] Error aplicando candidato ICE en cola:", e);
    }
  }
}

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
    ensureLocalTracksAdded();
    updateConnectionStatus("Cámara lista", "standby");

    // Conexión dinámica por WebSocket al servidor
    const isHttp = window.location.protocol.startsWith('http');
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = isHttp ? window.location.host : 'localhost:3000';
    signaling.connect(`${wsProtocol}//${wsHost}`);
  } catch (err) {
    console.error("[WebRTC] Error al acceder a la cámara o micrófono:", err);
    updateConnectionStatus("Permiso denegado", "error");
    updateHelperBanner("Permiso de cámara/micrófono denegado en el navegador");
  }
}

/**
 * Inicia la videollamada generando y enviando la oferta SDP al par remoto
 */
async function start() {
  try {
    updateConnectionStatus("Llamando...", "active");
    updateHelperBanner("Llamando a tu compañera...");

    const btnStart = document.getElementById('btn-start-call');
    if (btnStart) btnStart.classList.remove('pulse-ready');

    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      localVideoComponent.srcObject = localStream;
    }

    ensureLocalTracksAdded();

    // Creación manual de oferta para inicio inmediato garantizado
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signaling.send({ desc: pc.localDescription });
    console.log("[WebRTC] Llamada iniciada. Oferta SDP enviada.");
  } catch (err) {
    console.error("[WebRTC] Error al iniciar la llamada:", err);
    updateHelperBanner("Error al llamar: " + err.message);
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
  updateHelperBanner("Llamada finalizada. Recarga la página para volver a iniciar.");
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
 * Copia el enlace actual al portapapeles para compartirlo fácilmente
 */
function copyMeetingLink() {
  const url = window.location.href;
  const label = document.getElementById('btn-copy-label');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showCopiedSuccess(label);
    }).catch(() => fallbackCopy(url, label));
  } else {
    fallbackCopy(url, label);
  }
}

function fallbackCopy(text, label) {
  const input = document.createElement('input');
  input.value = text;
  document.body.appendChild(input);
  input.select();
  try {
    document.execCommand('copy');
    showCopiedSuccess(label);
  } catch (err) {
    console.error("Error al copiar enlace:", err);
  }
  document.body.removeChild(input);
}

function showCopiedSuccess(label) {
  if (!label) return;
  const original = label.innerText;
  label.innerText = "¡Enlace copiado!";
  setTimeout(() => {
    label.innerText = original;
  }, 2500);
}

/**
 * Actualiza el texto de la barra de guía superior
 */
function updateHelperBanner(text) {
  const bannerText = document.getElementById('helper-text');
  if (bannerText) bannerText.innerText = text;
}

/**
 * Actualiza el texto del placeholder remoto
 */
function updatePlaceholderText(text) {
  const el = document.getElementById('placeholder-text');
  if (el) el.innerText = text;
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
