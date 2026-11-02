/**
 * =============================================================================
 * TRABAJO PRÁCTICO WEBRTC - E.E.T. Nº 3139 “GRAL. MARTÍN M. DE GÜEMES”
 * Archivo: server.js
 * Descripción: Servidor HTTP y Servidor de Señalización (Signaling Server) con WebSockets
 * =============================================================================
 *
 * ¿QUÉ ES EL SERVIDOR DE SEÑALIZACIÓN EN WEBRTC?
 * ------------------------------------------------
 * WebRTC permite la comunicación directa punto a punto (Peer-to-Peer o P2P)
 * entre dos navegadores para transmitir audio y video en tiempo real sin que el
 * flujo de medios pase por el servidor.
 *
 * Sin embargo, antes de que los dos dispositivos puedan conectarse directamente,
 * necesitan "conocerse" e intercambiar metadatos esenciales:
 * 1. Formato de medios y códecs soportados (ofertas y respuestas SDP).
 * 2. Direcciones IP públicas/privadas y puertos accesibles (candidatos ICE).
 *
 * Dado que el estándar WebRTC NO define un protocolo específico para este
 * intercambio previo, se utiliza un "Servidor de Señalización" como intermediario.
 * En esta implementación utilizamos Node.js con WebSockets (ws), permitiendo
 * comunicación bidireccional y de bajísima latencia para retransmitir estos
 * mensajes entre pares.
 * =============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

// Puerto de ejecución del servidor
const PORT = process.env.PORT || 3000;

// Tipos MIME soportados para servir archivos estáticos
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// =============================================================================
// 1. SERVIDOR HTTP PARA ARCHIVOS ESTÁTICOS
// Permite abrir http://localhost:3000 directamente en el navegador
// =============================================================================
const server = http.createServer((req, res) => {
  // Normalizar ruta solicitada
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const filePath = path.join(__dirname, reqPath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Recurso no encontrado');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`500 Error interno del servidor: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// =============================================================================
// 2. SERVIDOR DE SEÑALIZACIÓN WEBSOCKET (Signaling Server)
// Se monta sobre el mismo servidor HTTP para compartir puerto
// =============================================================================
const wss = new WebSocketServer({ server });

let peerCounter = 0;

wss.on('connection', (ws, req) => {
  peerCounter++;
  const peerId = `Par-${peerCounter}`;
  ws.peerId = peerId;

  const clientIp = req.socket.remoteAddress;
  console.log(`\n[Signaling] [+] Nuevo par conectado: ${peerId} (IP: ${clientIp})`);
  console.log(`[Signaling] Total de pares activos en sala: ${wss.clients.size}`);

  // Notificar al cliente conectado su identificador asignado
  ws.send(JSON.stringify({
    type: 'welcome',
    peerId: peerId,
    totalPeers: wss.clients.size
  }));

  // Manejo de mensajes de señalización entrantes
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      // Identificar el tipo de mensaje para registro y depuración
      if (message.desc) {
        console.log(`[Signaling] [SDP ${message.desc.type.toUpperCase()}] Retransmitiendo desde ${ws.peerId} hacia el otro par.`);
      } else if (message.candidate) {
        console.log(`[Signaling] [Candidato ICE] Retransmitiendo desde ${ws.peerId}.`);
      } else {
        console.log(`[Signaling] [Mensaje] Tipo desconocido de ${ws.peerId}:`, message);
      }

      // RETRANSMISIÓN (Broadcasting):
      // Reenviamos el mensaje a todos los demás pares conectados (excluyendo al emisor)
      let forwardedCount = 0;
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(message));
          forwardedCount++;
        }
      });

      if (forwardedCount === 0) {
        console.log(`[Signaling] [Aviso] No hay otro par conectado aún. Esperando que se conecte el segundo usuario...`);
      }
    } catch (error) {
      console.error(`[Signaling] Error al procesar mensaje de ${ws.peerId}:`, error);
    }
  });

  // Evento al desconectarse un par
  ws.on('close', () => {
    console.log(`\n[Signaling] [-] Par desconectado: ${ws.peerId}`);
    console.log(`[Signaling] Total de pares restantes: ${wss.clients.size}`);

    // Notificar a los pares restantes que su contraparte se desconectó
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'peer-disconnected',
          peerId: ws.peerId
        }));
      }
    });
  });

  // Manejo de errores de conexión
  ws.on('error', (err) => {
    console.error(`[Signaling] Error en la conexión de ${ws.peerId}:`, err);
  });
});

// =============================================================================
// 3. INICIO DEL SERVIDOR
// =============================================================================
server.listen(PORT, () => {
  console.log('=================================================================');
  console.log('   E.E.T. Nº 3139 - SERVIDOR DE SEÑALIZACIÓN WEBRTC INICIADO    ');
  console.log('=================================================================');
  console.log(` -> Servidor HTTP web disponible en:   http://localhost:${PORT}`);
  console.log(` -> Servidor WebSocket de señalización: ws://localhost:${PORT}`);
  console.log(' -> Para probar la videollamada:');
  console.log('    1. Abre http://localhost:3000 en una pestaña del navegador.');
  console.log('    2. Abre http://localhost:3000 en otra pestaña o ventana.');
  console.log('    3. Presiona "Iniciar llamada" en una de las pestañas.');
  console.log('=================================================================\n');
});
