# Trabajo Práctico: Videollamada WebRTC P2P

**Institución:** E.E.T. Nº 3139 “Gral. Martín M. de Güemes”  
**Materia / Especialidad:** Redes y Comunicación / Computación  
**Proyecto:** `tp-web-garcia`  

---

## Descripción del Proyecto

Aplicación web desarrollada con la API nativa de **WebRTC** (*Web Real-Time Communication*) para establecer una videollamada interactiva punto a punto (Peer-to-Peer) entre pares a través del navegador.

El proyecto cuenta con una interfaz moderna y profesional (modo oscuro, íconos vectoriales SVG limpios, diseño *Picture-in-Picture* y panel flotante de controles).

---

## Estructura del Repositorio

```text
tp-web-garcia/
├── css/
│   └── styles.css          # Estilos visuales, layout y diseño responsive
├── js/
│   └── main.js             # Lógica WebRTC, negociación SDP, candidatos ICE y eventos
├── index.html              # Estructura semántica principal y contenedor de video
├── .gitignore              # Filtro de archivos no rastreados por Git
└── README.md               # Documentación general del trabajo práctico
```

---

## Puntos Técnicos Implementados

1. **Captura Multimedia (`getUserMedia`)**:
   - Conexión y captura en alta definición de cámara y micrófono local (`audio: true`, `video: true`).
2. **Servidores STUN (`iceServers`)**:
   - Configuración de servidores públicos de Google (`stun:stun.l.google.com:19302`) para atravesar cortafuegos y NAT.
3. **Control del ciclo de vida con `RTCPeerConnection`**:
   - Negociación de sesiones SDP con `createOffer()`, `setLocalDescription()` y `createAnswer()`.
   - Intercambio de candidatos de red en tiempo real mediante `onicecandidate`.
   - Asignación dinámica de pistas multimedia remotas con `ontrack`.
4. **Controles de Usuario**:
   - Silenciar / reactivar micrófono en caliente.
   - Encender / apagar cámara web en vivo.
   - Modo de pantalla completa.
   - Indicador dinámico de estado de red.

---

## Cómo Ejecutar el Proyecto

1. Clona este repositorio o abre la carpeta en tu entorno local:
   ```bash
   git clone https://github.com/Aczino593/tp-web-garcia.git
   cd tp-web-garcia
   ```
2. Abre el archivo `index.html` en un navegador compatible con WebRTC (Google Chrome, Microsoft Edge, Mozilla Firefox o Brave).
3. Concede los permisos solicitados para acceder a la cámara y al micrófono.
