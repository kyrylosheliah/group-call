import express from 'express';
import fs from 'fs';
import https from 'https';
import { Server } from 'socket.io';
import os from 'os';
import mediasoup from 'mediasoup';

import config from './config.js';
const getIpAddresses = () => {
  var addresses = [];
  var interfaces = os.networkInterfaces();
  for (const iname in interfaces) {
    var iface = interfaces[iname];
    for (const network of iface) {
      if (
        network.family === 'IPv4'
        && network.address !== '127.0.0.1'
        && !network.internal
      ) {
        console.log(network.address);
        for (const protocol in ["tcp", "udp"]) {
          addresses.push({
            protocol: protocol,
            ip: network.address,
            announcedAddress: null,
            portRange: {
              min: 40000,
              max: 49999,
            },
          });
        }
      }
    }
  }
  return addresses;
};
config.mediasoup.webRtcTransportOptions.listenInfos.push(
  ...getIpAddresses()
);

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

let worker;
let rooms = {};
let peers = {};
let transports = [];
let producers = [];
let consumers = [];

const connections = io.of('/mediasoup');

const str = (o) => JSON.stringify(o);

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 50000,
    rtcMaxPort: 59999,
  });
  console.log(`createWorker() | pid ${worker.pid}`);
  worker.on('died', (error) => {
    console.error("worker.on 'died'", error);
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

connections.on('connection', async (socket) => {
  console.log(`[${socket.id}] connections.on 'connection'`);
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
    console.log(`[${socket.id}] socket.on 'disconnect'`);
    consumers = removeItems(consumers, socket.id, 'consumer');
    producers = removeItems(producers, socket.id, 'producer');
    transports = removeItems(transports, socket.id, 'transport');
    if (!peers[socket.id]) {
      console.log(`[${socket.id}] socket.on 'disconnect' ... peers[socket.id] is undefined`);
      return;
    }
    const { roomName } = peers[socket.id];
    delete peers[socket.id];
    rooms[roomName].peers = rooms[roomName].peers.filter(
      socketId => socketId !== socket.id,
    );
  });

  socket.on('joinRoom', async (data, callback) => {
    console.log(`[${socket.id}] socket.on 'joinRoom' | ${str(data)}`);
    const { roomName } = data;
    const router = await createRoom(roomName, socket.id);
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
    const rtpCapabilities = router.rtpCapabilities;
    callback({ rtpCapabilities });
  });

  const createRoom = async (roomName, socketId) => {
    if (!rooms[roomName]) {
      rooms[roomName] = {
        router: await worker.createRouter({ mediaCodecs }),
        peers: [],
      };
    }
    const room = rooms[roomName];
    const router = room.router;
    const peers = room.peers;
    console.log(`createRoom() | roomName ${roomName} | router.id ${router.id} | peers.length ${peers.length}`);
    room.peers.push(socketId);
    return router;
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

  socket.on('createWebRtcTransport', async (data, callback) => {
    console.log(`[${socket.id}] socket.on 'createWebRtcTransport' | ${str(data)}`);
    const { consumer } = data;
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
    console.log(`[${socket.id}] socket.on 'getProducers'`);
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
    console.log(`[${socketId}] informConsumers() | id ${id} joined ${roomName}`);
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

  socket.on('transport-connect', (data) => {
    console.log(`[${socket.id}] socket.on 'transport-connect' | ${str(data)}`);
    const { dtlsParameters } = data;
    getTransport(socket.id).connect({ dtlsParameters });
  });

  socket.on('transport-produce', async (data, callback) => {
    console.log(`[${socket.id}] socket.on 'transport-produce' | ${str(data)}`);
    const { kind, rtpParameters, appData } = data;
    const producer = await getTransport(socket.id).produce({ kind, rtpParameters });
    const { roomName } = peers[socket.id];
    addProducer(producer, roomName);
    informConsumers(roomName, socket.id, producer.id);
    producer.on('transportclose', () => {
      console.log(`[${socket.id}] producer.on 'transportclose'`);
      console.log('transport for this producer closed');
      producer.close();
    });
    // send the producer's id back to the client
    callback({
      id: producer.id,
      producersExist: producers.length > 0
    });
  });

  socket.on('transport-recv-connect', async (data) => {
    console.log(`[${socket.id}] socket.on 'transport-recv-connect' | ${str(data)}`);
    const {
      dtlsParameters,
      serverConsumerTransportId,
    } = data;
    const consumerTransport = transports.find(
      t => t.consumer && t.transport.id === serverConsumerTransportId
    ).transport; // TypeError: Cannot read properties of undefined (reading 'transport')
    await consumerTransport.connect({ dtlsParameters });
  });

  socket.on('consume', async (data, callback) => {
    console.log(`[${socket.id}] socket.on 'consume' | ${str(data)}`);
    const {
      rtpCapabilities,
      remoteProducerId,
      serverConsumerTransportId,
    } = data;
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
          console.log(`[${socket.id}] consumer.on 'transportclose'`);
          console.log('transport close from consumer');
        })
        consumer.on('producerclose', () => {
          console.log(`[${socket.id}] consumer.on 'producerclose'`);
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
  socket.on('consumer-resume', async (data) => {
    console.log(`[${socket.id}] socket.on 'consumer-resume' | ${str(data)}`);
    const { serverConsumerId } = data;
    const { consumer } = consumers.find(c => c.consumer.id === serverConsumerId);
    await consumer.resume();
  });
});


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

const createWebRtcTransport = async (router) => {
  return new Promise(async (resolve, reject) => {
    try {
      let transport = await router.createWebRtcTransport(webRtcTransport_options);
      console.log(`createWebRtcTransport() | transport.id ${transport.id}`);
      transport.on('dtlsstatechange', (dtlsState) => {
        console.log(`transport.on 'dtlsstatechange' | dtlsState ${dtlsState} | transport.id ${transport.id}`);
        if (dtlsState === 'closed') {
          transport.close();
        }
      });
      transport.on('close', () => {
        console.log(`transport.on 'close' | transport.id ${transport.id}`);
      });
      resolve(transport);
    } catch (error) {
      //console.log(error);
      //callback({ params: { error: error } });
      reject(error);
    }
  });
}