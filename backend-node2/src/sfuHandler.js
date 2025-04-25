const mediasoup = require('mediasoup');
const { v4: uuid } = require('uuid');

const mediaCodecs = [
  { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
  { kind: "video", mimeType: "video/VP8", clockRate: 90000, parameters: { } },
];

const workers = [];
let currentWorker = 0;

async function createWorker() {
  const worker = await mediasoup.createWorker();
  worker.on('died', () => {
    console.log('mediasoup worker died, exit the process');
    process.exit(1);
  });
  return worker;
};

async function getWorker() {
  if (workers.length === 0) {
    workers.push(await createWorker());
  }
  return workers[currentWorker];
};

const rooms = new Map();

async function createSFURoom(roomId) {
  if (room.has(roomId)) {
    return room.get(roomId);
  }
  const worker = await getWorker();
  const router = await worker.createRouter({ mediaCodecs });
  const peers = new Map();
  const room = { router, peers };
  rooms.set(roomId, room);
  return room;
};

export async function handleSFUConnection(socket, io) {
  socket.on('sfu-create-room', async ({ roomId }) => {
    const room = await createSFURoom(roomId);
    socket.emit('sfu-router-rtp-capabilities', room.router.rtpCapabilities);
  });
  socket.on('sfu-create-transport', async ({ roomId, direction }) => {
    const room = rooms.get(roomId);
    const transport = await room.router.createWebRtcTransport({
      listenIps: [ { ip: '0.0.0.0', announcedIp: null }, ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
    transport.on('dtlsstatechange', (state) => {
      if (state === 'closed') {
        transport.close();
      }
    });
    const id = uuid();
    room.peers.set(socket.id, {
      ...(room.peers.get(socket.id) || {}),
      [direction]: transport,
    });
    socket.emit('sfu-transport-created', {
      id: transport.id,
      transportOptions: {
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    });
    // DTLS
    socket.on('sfu-connect-transport', async ({ transportId, dtlsParameters }) => {
      await transport.connect({ dtlsParameters });
      socket.emit('sfu-transport-connected', { transportId });
    });
    // Produce
    socket.on('sfu-produce', async ({ transportId, kind, rtpParameters }) => {
      const producer = await transport.produce({ kind, rtpParameters });
      room.peers.get(socket.id).producer = producer;
      socket.emit('sfu-produced', { id: producer.id });
    });
    // Consume
    socket.on('sfu-consume', async ({ rtpCapabilities }) => {
      const otherPeers = [...room.peers.entries()].filter(([id]) => id !== socket.id);
      const consumerData = [];
      for (const [peerId, peer] of otherPeers) {
        if (!peer.producer) continue;
        if (!room.router.canConsume({ producerId: peer.producer.id, rtpCapabilities }))
          continue;
        const recvTransport = room.peers.get(socket.id).recv;
        const consumer = await recvTransport.consume({
          producerId: peer.producer.id,
          rtpCapabilities,
          paused: false,
        });
        consumerData.push({
          id: consumer.id,
          producerId: peer.producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
        socket.emit('sfu-consumed', { consumers: consumerData });
      }
    })
  });
}