import express from 'express';
import fs from 'fs';
import https from 'https';
import { Server } from 'socket.io';
import os from 'os';
import mediasoup from 'mediasoup';
import config from './config.js';
import { whitelistLogTags } from './logging.js';

//const logging = whitelistLogTags(["stage1", "stage2"]);
const logging = whitelistLogTags(["stage2"]);
const log1stage = logging.createTaggedLogger("stage1");
const log2stage = logging.createTaggedLogger("stage2");

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

const intervalId = setInterval(() => {
  log2stage("====\n====\n====");
  log2stage(`- transports`);
  for (const t of transports) {
    log2stage(`socket ${t.socketId} transport ${t.transport.id}`);
  }
  log2stage(`- producers`);
  for (const p of producers) {p
    log2stage(`socket ${p.socketId} producer ${p.producer.id}`);
  }
  log2stage(`- consumers`);
  for (const c of consumers) {
    log2stage(`socket ${c.socketId} consumer ${c.consumer.id}`);
  }
}, 5000);

const connections = io.of('/mediasoup');

const str = (o) => JSON.stringify(o);

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 50000,
    rtcMaxPort: 59999,
    ...config.mediasoup.workerSettings,
  });
  log1stage(`createWorker() | pid ${worker.pid}`);
  worker.on('died', (error) => {
    console.error("worker.on 'died'", error);
    setTimeout(() => process.exit(1), 2000);
  });
  return worker;
};

worker = createWorker();

connections.on('connection', async (socket) => {
  log1stage(`${socket.id} connections.on 'connection'`);

  socket.emit('connection-success', {
    socketId: socket.id,
  });

  const removeItems = (items, socketId, type) => {
    items.forEach(item => {
      if (item.socketId === socketId) {
        log2stage(`closing ${str(item)}`);
        item[type].close();
      }
    });
    items = items.filter(item => item.socketId !== socketId);
    return items;
  };

  socket.on('disconnect', () => {
    log1stage(`${socket.id} socket.on 'disconnect'`);
    log2stage(`${socket.id} removing consumers ...`);
    consumers = removeItems(consumers, socket.id, 'consumer');
    log2stage(`${socket.id} removing producers ...`);
    producers = removeItems(producers, socket.id, 'producer');
    log2stage(`${socket.id} removing transports ...`);
    transports = removeItems(transports, socket.id, 'transport');
    if (!peers[socket.id]) {
      log1stage(`${socket.id} socket.on 'disconnect' ... peers[socket.id] is undefined`);
      return;
    }
    const { roomName } = peers[socket.id];
    delete peers[socket.id];
    rooms[roomName].peers = rooms[roomName].peers.filter(
      socketId => socketId !== socket.id,
    );
    if (rooms[roomName].peers.length === 0) {
      delete rooms[roomName];
    }
  });

  socket.on('joinRoom', async (data, callback) => {
    log1stage(`${socket.id} socket.on 'joinRoom' | ${str(data)}`);
    const { roomName } = data;
    const router = await createRoom(roomName, socket.id);
    peers[socket.id] = {
      socket,
      roomName,
      //transports: [],
      //producers: [],
      //consumers: [],
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
        router: await worker.createRouter(config.mediasoup.routerOptions),
        peers: [],
      };
    }
    const room = rooms[roomName];
    const router = room.router;
    const peers = room.peers;
    log1stage(`createRoom() | roomName ${roomName} | router.id ${router.id} | peers.length ${peers.length}`);
    room.peers.push(socketId);
    return router;
  };

  //socket.on('createRoom', async (callback) => {
  //  if (router === undefined) {
  //    //worker.createRouter(options);
  //    //options = { mediaCodecs, appData };
  //    router = await worker.createRouter({ mediaCodecs });
  //    log1stage(`Router ID: ${router.id}`);
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
  //   log1stage('rtp Capabilities', rtpCapabilities);
  //   // call the client's callback
  //   callback({ rtpCapabilities });
  // })

  socket.on('createWebRtcTransport', async (data, callback) => {
    log1stage(`${socket.id} socket.on 'createWebRtcTransport' | ${str(data)}`);
    const { consumer } = data;
    const roomName = peers[socket.id].roomName;
    const router = rooms[roomName].router;
    createWebRtcTransport(router).then((transport) => {
      callback({params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      }});
      addTransport(transport, roomName, consumer);
    }).catch((error) => {
      console.error(error);
    });
  });

  const addTransport = (transport, roomName, consumer) => {
    transports.push({ socketId: socket.id, transport, roomName, consumer });
    //peers[socket.id].transports.push(transport.id);
  };

  const addProducer = (producer, roomName) => {
    producers.push({ socketId: socket.id, producer, roomName });
    //peers[socket.id].producers.push(producer.id);
  };

  const addConsumer = (consumer, roomName) => {
    consumers.push({ socketId: socket.id, consumer, roomName });
    //peers[socket.id].consumers.push(consumer.id);
  };

  socket.on('getProducers', (callback) => {
    // TODO: Error: connect() already called [method:webRtcTransport.connect]
    log1stage(`${socket.id} socket.on 'getProducers'`);
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

  const informConsumers = (roomName, socketId, producerId) => {
    log1stage(`[${socketId}] informConsumers() | producerId ${producerId} joined ${roomName}`);
    console.log(`===`);
    producers.forEach(p => {
      if (p.socketId !== socketId && p.roomName === roomName) {
        log2stage(`[+] ${p.socketId} ${socketId}`);
        const producerSocket = peers[p.socketId].socket;
        producerSocket.emit('new-producer', { producerId });
      } else {
        log2stage(`[ ] ${p.socketId} ${socketId}`);
      }
    });
  };

  const getTransport = (socketId) => {
    return transports.find(
      t => t.socketId === socketId && !t.consumer
    ).transport;
  }

  socket.on('transport-connect', (data) => {
    log1stage(`${socket.id} socket.on 'transport-connect' | ${str(data)}`);
    const { dtlsParameters } = data;
    getTransport(socket.id).connect({ dtlsParameters });
  });

  socket.on('transport-produce', async (data, callback) => {
    log1stage(`${socket.id} socket.on 'transport-produce' | ${str(data)}`);
    const { kind, rtpParameters, appData } = data;
    const producer = await getTransport(socket.id).produce({ kind, rtpParameters });
    const { roomName } = peers[socket.id];
    addProducer(producer, roomName);
    informConsumers(roomName, socket.id, producer.id);
    producer.on('transportclose', () => {
      log1stage(`${socket.id} producer.on 'transportclose'`);
      producer.close();
    });
    // send the producer's id back to the client
    callback({
      id: producer.id,
      producersExist: producers.length > 0
    });
  });

  socket.on('transport-recv-connect', async (data) => {
    log1stage(`${socket.id} socket.on 'transport-recv-connect' | ${str(data)}`);
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
    log1stage(`${socket.id} socket.on 'consume' | ${str(data)}`);
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
          log1stage(`${socket.id} consumer.on 'transportclose'`);
          log1stage('transport close from consumer');
        })
        consumer.on('producerclose', () => {
          log1stage(`${socket.id} consumer.on 'producerclose'`);
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
      console.error(error.message);
      callback({ params: { error: error } });
    }
  });
  socket.on('consumer-resume', async (data) => {
    log1stage(`${socket.id} socket.on 'consumer-resume' | ${str(data)}`);
    const { serverConsumerId } = data;
    const { consumer } = consumers.find(c => c.consumer.id === serverConsumerId);
    await consumer.resume();
  });
});

const createWebRtcTransport = async (router) => {
  return new Promise(async (resolve, reject) => {
    try {
      let transport = await router.createWebRtcTransport(
        //webRtcTransport_options
        config.mediasoup.webRtcTransportOptions
      );
      log1stage(`createWebRtcTransport() | transport.id ${transport.id}`);
      transport.on('dtlsstatechange', (dtlsState) => {
        log1stage(`transport.on 'dtlsstatechange' | dtlsState ${dtlsState} | transport.id ${transport.id}`);
        if (dtlsState === 'closed') {
          transport.close();
        }
      });
      transport.on('close', () => {
        log1stage(`transport.on 'close' | transport.id ${transport.id}`);
      });
      resolve(transport);
    } catch (error) {
      console.error(error);
      //callback({ params: { error: error } });
      reject(error);
    }
  });
};