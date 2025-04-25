const express = require('express');
// const http = require('http');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { Server } = require('socket.io');
// //const WebSocket = require('ws');
const mediasoup = require('mediasoup');
// const setupSignaling = require('./signaling');

// const app = express();
// const server = http.createServer(app);
// const io = new Server(server, {
//   cors: {
//     origin: '*',
// }});

// setupSignaling(io);

// server.listen(3000, () => {
//   console.log('Signaling server running on http:localhost:3000');
// });

const app = express();

const options = {
  key: fs.readFileSync('../.ssl/key.pem', 'utf-8'),
  cert: fs.readFileSync('../.ssl/cert.pem', 'utf-8'),
};

const PORT = 3000;
const httpsServer = https.createServer(options, app);
httpsServer.listen(PORT, () => {
  console.log('listening on port: ' + PORT);
});

const io = new Server(httpsServer, {
  cors: {
    origin: '*',
}});

const peers = io.of('/mediasoup');

//peers.on('connection', (socket) => {
//  console.log('connection, id: ', socket.id);
//  socket.emit('connection-success', { socketId: socket.id});
//});

let worker;
let router;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
  console.log(`worker pid ${worker.pid}`);
  worker.on('died', error => {
    // something serious happened
    console.error('mediasoup worker has died');
    // exit in 2 sec
    setTimeout(() => process.exit(1), 2000);
  });
  return worker;
}

worker = createWorker()

// an array of RtpCapabilities
const mediaCodecs = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
];

peers.on('connection', async (socket) => {
  console.log(socket.id);
  socket.emit('connection-success', {
    socketId: socket.id
  });

  socket.on('disconnect', () => {
    // cleanup
    console.log('peer disconnected');
  });

  //worker.createRouter(options);
  //options = { mediaCodecs, appData };
  router = await worker.createRouter({ mediaCodecs });

  socket.on('getRtpCapabilities', (callback) => {
    // client emits a request for RtpCapabilities
    const rtpCapabilities = router.rtpCapabilities;
    console.log('rtp Capabilities', rtpCapabilities);
    // call the client's callback
    callback({ rtpCapabilities });
  })

  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    console.log(`Is this a sender request? ${sender}`);
    // differentiate between producer and consumer transports
    // if sender is true, it indicates a producer
    if (sender) {
      producerTransport = await createWebRtcTransport(callback);
    } else {
      consumerTransport = await createWebRtcTransport(callback);
    }
  });

  socket.on('transport-connect', async ({ dtlsParameters }) => {
    // client emits transport-connect
    console.log('DTLS PARAMS... ', { dtlsParameters });
    await producerTransport.connect({ dtlsParameters });
  });

  socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
    // client emits transport-produce
    // call produce based on the parameters from the client
    producer = await producerTransport.produce({ kind, rtpParameters });
    console.log('Producer ID: ', producer.id, producer.kind);
    producer.on('transportclose', () => {
      console.log('transport for this producer closed');
      producer.close();
    });
    // send back producer id to the client
    callback({ id: producer.id });
  });

  socket.on('transport-recv-connect', async ({ dtlsParameters }) => {
    console.log(`DTLS PARAMS: ${dtlsParameters}`);
    await consumerTransport.connect({ dtlsParameters });
  });

  socket.on('consume', async ({rtpCapabilities }, callback) => {
    try {
      if (router.canConsume({
        producerId: producer.id,
        rtpCapabilities,
      })) {
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        });
        consumer.on('transportclose', () => {
          console.log('transport close from consumer');
        })
        consumer.on('producerclose', () => {
          console.log('producer of consumer closed');
        });
        const params = {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        };
        callback({ params });
      }
    } catch (error) {
      console.log(error.message);
      callback({ params: { error: error } });
    }
  });
  socket.on('consumer-resume', async () => {
    console.log('consumer resume');
    await consumer.resume();
  });
});

const createWebRtcTransport = async (callback) => {
  try {
    const webRtcTransport_options = {
      listenIps: [
        // TODO: replace with valid ip
        { ip: '0.0.0.0', announcedIp: '127.0.0.1' }, // docker
        //{ ip: '127.0.0.1' },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };
    let transport = await router.createWebRtcTransport(webRtcTransport_options);
    console.log(`transport id: ${transport.id}`);
    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        transport.close();
      }
    });
    transport.on('close', () => {
      console.log('transport closed');
    });
    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      }
    });
    return transport;
  } catch (error) {
    console.log(error);
    callback({ params: { error: error } });
  }
}