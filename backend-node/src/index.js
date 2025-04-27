import express from 'express';
import fs from 'fs';
import https from 'https';
import { Server } from 'socket.io';
import os from 'os';
import mediasoup from 'mediasoup';

import config from './config.js';

const expressApp = express();

const httpsServer = https.createServer(
  {
    key: fs.readFileSync(config.http.tls.key, 'utf-8'),
    cert: fs.readFileSync(config.http.tls.cert, 'utf-8'),
  },
  expressApp,
);
httpsServer.listen(config.http.port, config.domain, () => {
  console.log('listening on port: ' + config.http.port);
});

// function getIpAddresses() {
//   var addresses = [];
//   var interfaces = os.networkInterfaces();
//   for (var iname in interfaces) {
//     var iface = interfaces[iname];
//     for (var i = 0; i < iface.length; i++) {
//       var alias = iface[i];
//       if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
//         console.log(alias.address);
//         addresses.push({ ip: alias.address, announcedAddress: null });
//         //return alias.address;
//       }
//     }
//   }
//   return addresses;
//}

const io = new Server(httpsServer, {
  cors: {
    origin: [
      "https://localhost",
      `https://${config.domain}`,
    ],
  },
});

const peers = io.of('/mediasoup');

peers.on('connection', (socket) => {
  console.log('connection, id: ', socket.id);
  socket.emit('connection-success', { socketId: socket.id});
});

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

function getIpAddresses() {
  var addresses = [];
  var interfaces = os.networkInterfaces();
  for (var iname in interfaces) {
    var iface = interfaces[iname];
    for (var i = 0; i < iface.length; i++) {
      var alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        console.log(alias.address);
        addresses.push({ ip: alias.address, announcedAddress: null });
        //return alias.address;
      }
    }
  }
  return addresses;
}

const createWebRtcTransport = async (callback) => {
  try {
    const webRtcTransport_options = {
      listenInfos: [
        //{ ip: '0.0.0.0', announcedAddress: "127.0.0.1" }, // docker
        { ip: '127.0.0.1', announcedAddress: null },
        ...getIpAddresses(),
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