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

const io = new Server(httpsServer, {
  cors: {
    origin: [
      "https://localhost",
      `https://${config.domain}`,
    ],
  },
});

const connections = io.of('/mediasoup');

connections.on('connection', (socket) => {
  console.log('connection, id: ', socket.id);
  socket.emit('connection-success', { socketId: socket.id});
});

let worker;
let rooms = {};
let peers = {};
let transports = [];
let producers = [];
let consumers = [];

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
  console.log(`worker pid ${worker.pid}`);
  worker.on('died', (error) => {
    // something serious happened
    console.error('mediasoup worker has died', error);
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

connections.on('connection', async socket => {
  console.log(socket.id);
  socket.emit('connection-success', {
    socketId: socket.id,
  });

  const removeItems = (items, socketId, type) => {
    items.forEach(item => {
      if (item.socketId === socket.id) {
        item[type].close();
      }
    });
    items = items.filter(item => item.socketId !== socket.id);
    return items;
  }

  socket.on('disconnect', () => {
    // cleanup
    console.log('peer disconnected');
    consumers = removeItems(consumers, socket.id, 'consumer');
    producers = removeItems(producers, socket.id, 'producer');
    transports = removeItems(transports, socket.id, 'transport');
    const { roomName } = peers[socket.id];
    delete peers[socket.id];
    rooms[roomName].peers = rooms[roomName].peers.filter(
      socketId => socketId !== socket.id,
    );
  });


  socket.on('joinRoom', async ({ roomName }, callback) => {
    const router1 = await createRoom(roomName, socket.id);
    peers[socket.id] = {
      socket,
      roomName,
      transports: [],
      producers: [],
      consumers: [],
      peerDetails: {
        name: '',
        isAdmin: false,
      },
    };
    const rtpCapabilities = router1.rtpCapabilities;
    callback({ rtpCapabilities });
  });

  const createRoom = async (roomName, socketId) => {
    let router1;
    let peers = [];
    if (rooms[roomName]) {
      router1 = rooms[roomName].router;
      peers = rooms[roomName].peers || [];
    } else {
      router1 = await worker.createRouter({ mediaCodecs, });
    }
    console.log(`Router Id: ${router1.id} `, peers.length);
    rooms[roomName] = {
      routers: router1,
      peers: [...peers, socketId],
    };
    return router1;
  };

  //socket.on('createRoom', async (callback) => {
  //  if (router === undefined) {
  //    //worker.createRouter(options);
  //    //options = { mediaCodecs, appData };
  //    router = await worker.createRouter({ mediaCodecs });
  //    console.log(`Router ID: ${router.id}`);
  //  }
  //  getRtpCapabilities(callback);
  //});

  //const getRtpCapabilities = (callback) => {
  //  const rtpCapabilities = router.rtpCapabilities;
  //  callback({ rtpCapabilities });
  //};

  //worker.createRouter(options);
  //options = { mediaCodecs, appData };
  //router = await worker.createRouter({ mediaCodecs });

  // socket.on('getRtpCapabilities', (callback) => {
  //   // client emits a request for RtpCapabilities
  //   const rtpCapabilities = router.rtpCapabilities;
  //   console.log('rtp Capabilities', rtpCapabilities);
  //   // call the client's callback
  //   callback({ rtpCapabilities });
  // })

  socket.on('createWebRtcTransport', async ({ consumer }, callback) => {
    const roomName = peers[socket.id].roomName;
    const router = rooms[roomName].router;
    createWebRtcTransport(router).then(
      (transport) => {
        callback({params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        }});
        addTransport(transport, roomName, consumer);
      },
      (error) => {
        console.log(error);
      }
    );
  });

  const addTransport = (transport, roomName, consumer) => {
    transports.push({ socketId: socket.id, transport, roomName, consumer });
    peers[socket.id].transports.push(transport.id);
  };

  const addProducer = (producer, roomName) => {
    producers.push({ socketId: socket.id, producer, roomName });
    peers[socket.id].producers.push(producer.id);
  };

  const addConsumer = (consumer, roomName) => {
    consumers.push({ socketId: socket.id, consumer, roomName });
    peers[socket.id].consumers.push(consumer.id);
  };

  socket.on('getProducers', (callback) => {
    // return all producer transports
    const { roomName } = peers[socket.id];
    let producerList = [];
    producers.forEach(p => {
      if (p.socketId !== socket.id && p.roomName === roomName) {
        producerList.push(p.producer.id);
      }
    });
    callback(producerList);
  });

  const informConsumers = (roomName, socketId, id) => {
    console.log(`joined: id ${id} ${roomName} ${socketId}`);
    producers.forEach(p => {
      if (p.socketId !== socketId && p.roomName === roomName) {
        const producerSocket = peers[p.socketId].socket;
        producerSocket.emit('new-producer', { producerId: id });
      }
    });
  };

  const getTransport = (socketId) => {
    const [producerTransport] = transports.filter(t =>
      t.socketId === socketId && !t.consumer
    );
    return producerTransport.transport;
  }

  socket.on('transport-connect', ({ dtlsParameters }) => {
    console.log('DTLS PARAMS... ', { dtlsParameters });
    getTransport(socket.id).connect({ dtlsParameters });
  });

  socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
    // client emits transport-produce
    // call produce based on the parameters from the client
    const producer = await getTransport(socket.id).produce({ kind, rtpParameters });
    const { roomName } = peers[socket.id];
    addProducer(producer, roomName);
    informConsumers(roomName, socket.id, producer.id);
    console.log('Producer ID: ', producer.id, producer.kind);
    producer.on('transportclose', () => {
      console.log('transport for this producer closed');
      producer.close();
    });
    // send the producer's id back to the client
    callback({
      id: producer.id,
      producersExist: producers.length > 1
    });
  });

  socket.on('transport-recv-connect', async ({
    dtlsParameters,
    serverConsumerTransportId,
  }) => {
    console.log(`DTLS PARAMS: ${dtlsParameters}`);
    const consumerTransport = transports.find(
      t => t.consumer && t.transport.id === serverConsumerTransportId
    ).transport;
    await consumerTransport.connect({ dtlsParameters });
  });

  socket.on('consume', async (
    { rtpCapabilities, remoteProducerId, serverConsumerTransportId },
    callback,
  ) => {
    try {
      const { roomName } = peers[socket.id];
      const router = rooms[roomName].router;
      let consumerTransport = transports.find(
        t => t.consumer && t.transport.id == serverConsumerTransportId
      ).transport;
      if (router.canConsume({
        producerId: remoteProducerId,
        rtpCapabilities,
      })) {
        const consumer = await consumerTransport.consume({
          producerId: remoteProducerId,
          rtpCapabilities,
          paused: true,
        });
        consumer.on('transportclose', () => {
          console.log('transport close from consumer');
        })
        consumer.on('producerclose', () => {
          console.log('producer of consumer closed');
          socket.emit('producer-closed', { remoteProducerId });
          consumerTransport.close([]);
          transports = transports.filter(t => t.transport.id !== consumerTransport.id);
          consumer.close();
          consumers = consumers.filter(c => c.consumer.id !== consumer.id);
        });
        addConsumer(consumer, roomName);
        const params = {
          id: consumer.id,
          producerId: remoteProducerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          serverConsumerId: consumer.id,
        };
        callback({ params });
      }
    } catch (error) {
      console.log(error.message);
      callback({ params: { error: error } });
    }
  });
  socket.on('consumer-resume', async ({ serverConsumerId }) => {
    console.log('consumer resume');
    const { consumer } = consumers.find(c => c.consumer.id === serverConsumerId);
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

const createWebRtcTransport = async (router) => {
  return new Promise(async (resolve, reject) => {
    try {
      const webRtcTransport_options = {
        listenInfos: [
          //{ ip: '0.0.0.0', announcedAddress: "127.0.0.1" }, // docker
          { ip: '127.0.0.1', announcedAddress: null },
          ...getIpAddresses(),
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: false,
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
      resolve(transport);
    } catch (error) {
      //console.log(error);
      //callback({ params: { error: error } });
      reject(error);
    }
  });
}