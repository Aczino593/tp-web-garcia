/**
 * =============================================================================
 * TRABAJO PRÁCTICO WEBRTC - E.E.T. Nº 3139 “GRAL. MARTÍN M. DE GÜEMES”
 * Archivo: server.js
 * Descripción: Servidor HTTP y Servidor de Señalización (Signaling Server) con WebSockets
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
// =============================================================================
const server = http.createServer((req, res) => {
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
        res.end(`500 Error interno: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// =============================================================================
// 2. SERVIDOR DE SEÑALIZACIÓN WEBSOCKET
// =============================================================================
const wss = new WebSocketServer({ server });

let peerCounter = 0;

// Heartbeat cada 25 segundos para mantener vivas las conexiones en celulares
const pingInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.ping();
    }
  });
}, 25000);

server.on('close', () => {
  clearInterval(pingInterval);
});

// Notifica a todos los clientes la cantidad actual de usuarios conectados y sus dispositivos
function broadcastRoomStatus() {
  const peers = [];
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.peerId) {
      peers.push({
        peerId: client.peerId,
        deviceType: client.deviceType || 'Dispositivo'
      });
    }
  });

  const payload = JSON.stringify({
    type: 'room-status',
    totalPeers: wss.clients.size,
    peers: peers
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws, req) => {
  peerCounter++;
  const userAgent = req.headers['user-agent'] || '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const deviceType = isMobile ? 'Celular' : 'PC';
  const peerId = `Par-${peerCounter} (${deviceType})`;
  ws.peerId = peerId;
  ws.deviceType = deviceType;

  const clientIp = req.socket.remoteAddress;
  console.log(`\n[Signaling] [+] Nuevo par conectado: ${peerId} (IP: ${clientIp})`);
  console.log(`[Signaling] Total de pares activos en sala: ${wss.clients.size}`);

  // Mensaje individual de bienvenida
  ws.send(JSON.stringify({
    type: 'welcome',
    peerId: peerId,
    deviceType: deviceType,
    totalPeers: wss.clients.size
  }));

  // Notificar a todos el estado de la sala
  broadcastRoomStatus();

  // Retransmisión de mensajes de señalización
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      message.sender = ws.peerId;
      message.senderDevice = ws.deviceType;

      if (message.desc) {
        console.log(`[Signaling] [SDP ${message.desc.type.toUpperCase()}] Retransmitiendo desde ${ws.peerId} hacia ${message.target || 'todos'}.`);
      } else if (message.candidate) {
        console.log(`[Signaling] [Candidato ICE] Retransmitiendo desde ${ws.peerId}.`);
      } else if (message.type) {
        console.log(`[Signaling] [Evento: ${message.type}] Retransmitiendo desde ${ws.peerId} hacia ${message.target || 'todos'}.`);
      }

      // Reenviar al par destino específico o a todos los demás pares
      let forwardedCount = 0;
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          if (!message.target || client.peerId === message.target) {
            client.send(JSON.stringify(message));
            forwardedCount++;
          }
        }
      });

      if (forwardedCount === 0) {
        console.log(`[Signaling] [Aviso] No hay otro par conectado aún para recibir el mensaje.`);
      }
    } catch (error) {
      console.error(`[Signaling] Error procesando mensaje de ${ws.peerId}:`, error);
    }
  });

  // Evento al desconectarse un par
  ws.on('close', () => {
    console.log(`\n[Signaling] [-] Par desconectado: ${ws.peerId}`);
    console.log(`[Signaling] Total de pares restantes: ${wss.clients.size}`);

    // Notificar a los pares restantes
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'peer-disconnected',
          peerId: ws.peerId
        }));
      }
    });

    broadcastRoomStatus();
  });

  ws.on('error', (err) => {
    console.error(`[Signaling] Error en conexión de ${ws.peerId}:`, err);
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
  console.log('=================================================================\n');
});
