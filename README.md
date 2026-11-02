# Trabajo Práctico: Videollamada WebRTC P2P

**Institución:** E.E.T. Nº 3139 “Gral. Martín M. de Güemes”  
**Materia / Especialidad:** Redes y Comunicación / Computación  
**Proyecto:** `tp-web-garcia`  

---

## 1. Descripción del Proyecto

Aplicación web desarrollada con la API nativa de **WebRTC** (*Web Real-Time Communication*) y un servidor de señalización propio construido sobre **Node.js y WebSockets**. 

El sistema permite establecer videollamadas interactivas de par a par (Peer-to-Peer) entre dos navegadores web sin intermediación de servidores de streaming para el audio/video, garantizando baja latencia y alta privacidad.

---

## 2. Estructura del Repositorio

```text
tp-web-garcia/
├── .gitignore              # Filtro de archivos no rastreados (node_modules, logs, etc.)
├── package.json            # Metadatos del proyecto y dependencias de Node.js (ws)
├── server.js               # Servidor HTTP y Servidor de Señalización WebSocket (Punto 2)
├── index.html              # Interfaz de usuario con elementos <video autoplay> (Punto 1)
├── README.md               # Documentación integral del trabajo práctico
├── css/
│   └── styles.css          # Estilos profesionales (Dark Mode, responsive, controles)
└── js/
    └── main.js             # Lógica cliente WebRTC, STUN, negociación SDP e ICE (Punto 1)
```

---

## 3. Documentación Técnica

### Punto 1: Cliente WebRTC (`index.html`, `css/styles.css`, `js/main.js`)
* **Elementos de Video**:
  * `<video id="local-video" autoplay="autoplay" muted>`: Presenta la cámara web local en modo miniatura flotante (*Picture-in-Picture*).
  * `<video id="remote-video" autoplay="autoplay">`: Muestra la transmisión del par remoto en pantalla completa.
* **Acceso a Periféricos**: `navigator.mediaDevices.getUserMedia({ audio: true, video: true })`.
* **Servidores STUN**: Servidor público de Google (`stun:stun.l.google.com:19302`) para el descubrimiento de IPs públicas y puertos (NAT Traversal).
* **Ciclo de Vida WebRTC**:
  * `onicecandidate`: Detección y envío de candidatos de red al par remoto a través del servidor de señalización.
  * `onnegotiationneeded`: Generación de oferta SDP (`createOffer()`) al detectar nuevos flujos multimedia.
  * `ontrack`: Inyección automática de las pistas remotas entrantes en el reproductor de video.
* **Controles Interactivos**:
  * Silenciar / reactivar micrófono (`toggleAudio()`).
  * Pausar / encender cámara (`toggleVideo()`).
  * Modo de pantalla completa (`toggleFullScreen()`).
  * Insignia con luz de estado dinámica según la conexión.

---

### Punto 2: Servidor de Señalización (`server.js`)

#### ¿Por qué es necesario el Servidor de Señalización?
Aunque WebRTC es un protocolo punto a punto (P2P), dos computadoras en Internet no pueden conectarse de la nada si no conocen previamente:
1. **Datos de sesión multimedia (SDP)**: Códecs soportados, resolución y tasa de bits.
2. **Candidatos ICE**: Direcciones IP (locales y públicas) y puertos disponibles para atravesar routers y cortafuegos.

El estándar WebRTC **no impone un protocolo de señalización**, dejando la elección libre a los desarrolladores.

#### Tecnología Seleccionada y Justificación:
Se implementó con **Node.js** utilizando la librería estándar **`ws`** (WebSockets) y el módulo nativo **`http`**:
* **Baja latencia**: Los WebSockets mantienen una conexión TCP persistente y full-duplex, a diferencia del *polling* HTTP convencional que genera sobrecarga y retrasos.
* **Servidor Todo-en-Uno**: El mismo script `server.js` sirve tanto la interfaz web (HTTP en el puerto 3000) como el canal de señalización (WebSocket en el puerto 3000), facilitando el despliegue sin dependencias complejas.
* **Ligereza y Escalabilidad**: `ws` es una de las implementaciones de WebSockets más rápidas y con menor consumo de memoria en el ecosistema JavaScript.

#### Funcionamiento del Flujo de Señalización:
1. **Conexión Inicial**: Los clientes abren una conexión WebSocket con el servidor al cargar la página. El servidor les asigna un identificador (ej. `Par-1`, `Par-2`).
2. **Oferta (Offer)**: El Par 1 genera una oferta SDP local (`pc.createOffer()`) y la envía al servidor WebSocket.
3. **Retransmisión (Broadcasting)**: El servidor reenvía la oferta exclusivamente al Par 2.
4. **Respuesta (Answer)**: El Par 2 procesa la oferta con `setRemoteDescription`, genera su respuesta (`createAnswer()`) y la envía al servidor, quien la redirige al Par 1.
5. **Intercambio ICE**: Simultáneamente, ambos clientes descubren sus candidatos de red vía STUN y los envían al servidor para que el otro los incorpore con `addIceCandidate`.
6. **Conexión P2P**: Completada la señalización, los navegadores establecen el canal directo de audio/video y la señalización queda libre.

---

## 4. Guía de Ejecución y Pruebas

### Prerrequisitos
* Tener instalado [Node.js](https://nodejs.org/) (versión 18 o superior).

### Pasos para Ejecutar
1. Abre una terminal en la carpeta del proyecto:
   ```bash
   cd C:\Users\Aczi\Documents\tp-web-garcia
   ```
2. Instala las dependencias (si aún no lo hiciste):
   ```bash
   npm install
   ```
3. Inicia el servidor:
   ```bash
   npm start
   ```
4. Abre dos pestañas o ventanas distintas del navegador en:
   ```text
   http://localhost:3000
   ```
5. En la primera pestaña, haz clic en **"Iniciar llamada"**.
6. Acepta los permisos de cámara y micrófono en ambas pestañas.
7. ¡La conexión P2P se establecerá y ambos videos se reproducirán en tiempo real!
