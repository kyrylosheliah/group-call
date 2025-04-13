const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mediasoup = require('mediasoup');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

app.use('/uploads', express.static(uploadsDir));

let peers = new Map();
let router;

(async () => {
    const worker = await mediasoup.createWorker();
    router = await worker.createRouter({
        mediaCodecs: [
            { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
            { kind: "video", mimeType: "video/VP8", clockRate: 90000 },
        ],
    });
})();

wss.on('connection', (socket) => {
    socket.id = Math.random().toString(36).substring(2, 9);
    peers.set(socket.id, { socket });

    socket.on('message', async (msg) => {
        const data = JSON.parse(msg);
        switch(data.type) {
            case 'join':
                peers.get(socket.id).name = data.name;
                broadcast({ type: 'user-joined', id: socket.id, name: data.name });
                break;

            case 'signal':
                forwardTo(data.to, { type: 'signal', from: socket.id, signal: data.signal});
                break;

            case 'chat':
                broadcast({ type: 'chat', from: socket.id, message: data.message });
                break;

            case 'file':
                const buffer = Buffer.from(data.fileData, 'base64');
                const filename = `uploads/${Date.now()}-${data.fileName}`;
                fs.writeFileSync(path.join(__dirname, filename), buffer);
                broadcast({
                    type: 'file',
                    from: socket.id,
                    fileName: data.fileName,
                    fileUrl: `/uploads/${path.basename(filename)}`,
                });
                break;
        }
    });

    socket.on('close', () => {
        peers.delete(socket.id);
        broadcast({ type: 'user-left', id: socket.id });
    });
});

function broadcast(message) {
    for (const peer of peers.values()) {
        peer.socket.send(JSON.stringify(message));
    }
}

function forwardTo(id, message) {
    const peer = peers.get(id);
    if (!peer) return;
    peer.socket.send(JSON.stringify(message));
}

server.listen(PORT, () => {
    console.log(`WebRTC Server running on http://localhost:${PORT}`);
});
