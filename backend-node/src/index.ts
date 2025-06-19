import express from "express";
import fs from "fs";
import https from "https";
import { Server, Socket } from "socket.io";
import * as config from "./config.js";
import { logEvent, logState, logMethod, logTest } from "./logging.js";
import * as mediasoup from "mediasoup";
import { IConsumer, IPeers, IProducer, IRooms, ITransport } from "./types.js";
import {
  Consumer,
  Producer,
  Transport,
  WebRtcTransport,
  Worker,
} from "mediasoup/node/lib/types.js";

const str = (o: any) => JSON.stringify(o);

var worker: Worker = undefined!;
var rooms: IRooms = {};
var peers: IPeers = {};
var transports: ITransport[] = [];
var producers: IProducer[] = [];
var consumers: IConsumer[] = [];

const start = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 50000,
    rtcMaxPort: 59999,
    ...config.workerSettings,
  });
  worker.on("died", (error) => {
    console.error("worker.on 'died'", error);
    setTimeout(() => process.exit(1), 2000);
  });

  const expressApp = express();
  const httpsServer = https.createServer(
    {
      key: fs.readFileSync(config.http.tls.key, "utf-8"),
      cert: fs.readFileSync(config.http.tls.cert, "utf-8"),
    },
    expressApp
  );
  httpsServer.listen(config.http.port, config.domain, () => {
    console.log("listening on port: " + config.http.port);
  });
  const io = new Server(httpsServer, {
    cors: {
      origin: [`https://${config.domain}:${config.http.port}`],
    },
  });

  //const intervalId = setInterval(() => {
  //  logState("====\n====\n====");
  //  logState(`- transports`);
  //  for (const t of transports) {
  //    logState(`socket ${t.socketId} transport ${t.transport.id}`);
  //  }
  //  logState(`- producers`);
  //  for (const p of producers) {p
  //    logState(`socket ${p.socketId} producer ${p.producer.id}`);
  //  }
  //  logState(`- consumers`);
  //  for (const c of consumers) {
  //    logState(`socket ${c.socketId} consumer ${c.consumer.id}`);
  //  }
  //}, 5000);

  const connections = io.of("/mediasoup");

  connections.on("connection", onConnection);
};

const onConnection = async (socket: Socket) => {
  logEvent("socket.on 'connection'", socket.id);

  logEvent("socket.emit 'connection-success'", socket.id);
  socket.emit("connection-success", {
    socketId: socket.id,
  });

  const removeItems = (items: any[], socketId: string, type: any) => {
    items.forEach((item) => {
      if (item.socketId === socketId) {
        logMethod("removeItems: closing a", type);
        item[type].close();
      }
    });
    items = items.filter((item) => item.socketId !== socketId);
    return items;
  };

  socket.on("disconnect", () => {
    logEvent("socket.on 'disconnect'", socket.id);
    consumers = removeItems(consumers, socket.id, "consumer");
    producers = removeItems(producers, socket.id, "producer");
    transports = removeItems(transports, socket.id, "transport");
    if (!peers[socket.id]) {
      console.log("error: a peer for socket", socket.id, "is undefined");
      return;
    }
    const { roomName } = peers[socket.id];
    delete peers[socket.id];
    rooms[roomName].peers = rooms[roomName].peers.filter(
      (socketId) => socketId !== socket.id
    );
    if (rooms[roomName].peers.length === 0) {
      delete rooms[roomName];
    }
  });

  socket.on("joinRoom", async (data, callback) => {
    logEvent("socket.on 'joinRoom'", socket.id);
    logEvent("data", str(data));
    const { roomName } = data;
    if (rooms[roomName] === undefined) {
      rooms[roomName] = {
        router: null!, // `await` race condition here
        peers: [], // but it prevent by registering sockets here
      };
      rooms[roomName].router = await worker.createRouter(config.routerOptions);
    }
    const room = rooms[roomName];
    if (room.peers.includes(socket.id)) {
      return;
    }
    room.peers.push(socket.id);
    logMethod("rooms ", rooms);
    logMethod("rooms[roomName] ", rooms[roomName]);
    logMethod("router.id", room.router.id, " | room.peers.length", room.peers.length);
    peers[socket.id] = {
      socket,
      roomName,
      transports: [],
      producers: [],
      consumers: [],
      peerDetails: {
        name: "",
        isAdmin: false,
      },
    };
    const rtpCapabilities = room.router.rtpCapabilities;
    callback({ rtpCapabilities });
  });

  //socket.on('createRoom', async (callback) => {
  //  if (router === undefined) {
  //    //worker.createRouter(options);
  //    //options = { mediaCodecs, appData };
  //    router = await worker.createRouter({ mediaCodecs });
  //    logEvent(`Router ID: ${router.id}`);
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
  //   logEvent('rtp Capabilities', rtpCapabilities);
  //   // call the client's callback
  //   callback({ rtpCapabilities });
  // })

  socket.on("createWebRtcTransport", async (data, callback) => {
    logEvent("socket.on 'createWebRtcTransport'", socket.id);
    logEvent("data", str(data));
    const { consumer } = data;
    const roomName = peers[socket.id].roomName;
    const router = rooms[roomName].router;
    const myPromise: Promise<WebRtcTransport> = new Promise(
      async (resolve, reject) => {
        try {
          let transport = await router.createWebRtcTransport(
            config.webRtcTransportOptions
          );
          logMethod("createWebRtcTransport() | transport.id", transport.id);
          transport.on("dtlsstatechange", (dtlsState) => {
            logEvent("socket.on 'createWebRtcTransport' > transport.on 'dtlsstatechange'", socket.id);
            logEvent("dtlsState", dtlsState, "| transport.id", transport.id);

            if (dtlsState === "closed") {
              transport.close();
            }
          });
          transport.on("@close", () => {
            logEvent("transport.on 'close' | transport.id", transport.id);
          });
          resolve(transport);
        } catch (error: any) {
          console.error(error);
          //callback({ params: { error: error } });
          reject(error);
        }
      }
    );
    myPromise
      .then((transport: WebRtcTransport) => {
        callback({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
        addTransport(transport, roomName, consumer);
      })
      .catch((error) => {
        console.error(error);
      });
  });

  const addTransport = (transport: Transport, roomName: string, consumer: any) => {
    transports.push({ socketId: socket.id, transport, roomName, consumer });
    peers[socket.id].transports.push(transport.id);
  };

  const addProducer = (producer: Producer, roomName: string) => {
    producers.push({ socketId: socket.id, producer, roomName });
    peers[socket.id].producers.push(producer.id);
  };

  const addConsumer = (consumer: Consumer, roomName: string) => {
    consumers.push({ socketId: socket.id, consumer, roomName });
    peers[socket.id].consumers.push(consumer.id);
  };

  socket.on("getProducers", (callback) => {
    logEvent("socket.on 'getProducers'", socket.id);
    // return all producer transports
    const { roomName } = peers[socket.id];
    let producerIdList: string[] = [];
    producers.forEach((p) => {
      if (p.socketId !== socket.id && p.roomName === roomName) {
        producerIdList.push(p.producer.id);
      }
    });
    callback(producerIdList);
  });

  const informConsumers = (
    roomName: string,
    socketId: string,
    producerId: string
  ) => {
    logMethod("informConsumers() | producerId", producerId, "joined", roomName, " | ", socketId);
    producers.forEach((p) => {
      if (p.socketId !== socketId && p.roomName === roomName) {
        logMethod("will inform", socketId, "of", p.socketId, "'s stream");
        const producerSocket = peers[p.socketId].socket;
        producerSocket.emit("new-producer", { producerId });
      } else {
        logMethod("won't inform", socketId, "of it's own stream on", p.socketId);
      }
    });
  };

  const findUnconsumedTransportBySocketId = (
    socketId: string
  ): Transport | undefined => {
    return transports.find((t) => !t.consumer && t.socketId === socketId)
      ?.transport;
  };

  socket.on("transport-connect", (data) => {
    logEvent("socket.on 'transport-connect'", socket.id);
    logEvent("data", str(data));
    const { dtlsParameters } = data;
    const transport = findUnconsumedTransportBySocketId(socket.id);
    if (transport === undefined) {
      console.log("error: the transport for socket", socket.id, "is undefined");
      return;
    }
    logEvent("socket", socket.id, "> transport.on 'transport-connect' > transport.connect", transport.id);
    logEvent("peers[", socket.id, "].transports is ", peers[socket.id].transports);
    logEvent("peers[", socket.id, "].consumers is ", peers[socket.id].consumers);
    logEvent("peers[", socket.id, "].producers is ", peers[socket.id].producers);
    transport.connect({ dtlsParameters });
  });

  socket.on("transport-produce", async (data, callback) => {
    logEvent("socket.on 'transport-produce'", socket.id);
    logEvent("data", str(data));
    const { kind, rtpParameters, appData } = data;
    const transport = findUnconsumedTransportBySocketId(socket.id);
    if (transport === undefined) {
      console.log("error: the transport for socket", socket.id, "is undefined");
      return;
    }
    const producer = await transport.produce({ kind, rtpParameters });
    const { roomName } = peers[socket.id];
    addProducer(producer, roomName);
    informConsumers(roomName, socket.id, producer.id);
    producer.on("transportclose", () => {
      logEvent("socket.on 'transport-produce' > producer.on 'transportclose'", socket.id);
      producer.close();
    });
    callback({
      id: producer.id,
      producersExist: producers.length > 0,
    });
  });

  const findConsumedTransportById = (transportId: string): Transport | undefined => {
    return transports.find((t) => t.consumer && t.transport.id === transportId)
      ?.transport;
  };

  socket.on("transport-recv-connect", async (data) => {
    logEvent("socket.on 'transport-recv-connect'", socket.id);
    logEvent("data", str(data));
    const { dtlsParameters, serverConsumerTransportId } = data;
    const consumerTransport = findConsumedTransportById(
      serverConsumerTransportId
    );
    if (consumerTransport === undefined) {
      console.log("error: the consumerTransport for serverConsumerTransportId", serverConsumerTransportId, "is undefined");
      return;
    }
    logEvent("socket", socket.id, "> transport.on 'transport-recv-connect' > consumerTransport.connect", consumerTransport.id);
    await consumerTransport.connect({ dtlsParameters });
  });

  socket.on("consume", async (data, callback) => {
    logEvent("socket.on 'consume'", socket.id);
    logEvent("data", str(data));
    const { rtpCapabilities, remoteProducerId, serverConsumerTransportId } =
      data;
    try {
      const { roomName } = peers[socket.id];
      const router = rooms[roomName].router;
      let consumerTransport = findConsumedTransportById(
        serverConsumerTransportId
      );
      if (consumerTransport === undefined) {
        console.log("error: the consumerTransport for serverConsumerTransportId", serverConsumerTransportId, "is undefined");
        return;
      }
      if (
        router.canConsume({
          producerId: remoteProducerId,
          rtpCapabilities,
        })
      ) {
        const consumer = await consumerTransport.consume({
          producerId: remoteProducerId,
          rtpCapabilities,
          paused: true,
        });
        consumer.on("transportclose", () => {
          logEvent("socket.on 'consume' > consumer.on 'transportclose'", socket.id);
        });
        consumer.on("producerclose", () => {
          logEvent("socket.on 'consume' > consumer.on 'producerclose'", socket.id);
          logEvent("socket.on 'consume' > consumer.emit 'producer-closed'", socket.id);
          socket.emit("producer-closed", { remoteProducerId });
          consumerTransport.close();
          transports = transports.filter(
            (t) => t.transport.id !== consumerTransport.id
          );
          consumer.close();
          consumers = consumers.filter((c) => c.consumer.id !== consumer.id);
        });
        addConsumer(consumer, roomName);
        callback({
          id: consumer.id,
          producerId: remoteProducerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          serverConsumerId: consumer.id,
        });
      }
    } catch (error: any) {
      console.error(error.message);
      callback({ error: error });
    }
  });
  socket.on("consumer-resume", async (data) => {
    logEvent("socket.on 'consumer-resume'", socket.id);
    logEvent("data", str(data));
    const { serverConsumerId } = data;
    const consumer = consumers.find((c) => c.consumer.id === serverConsumerId);
    if (consumer === undefined) {
      console.log("error: the consumer for serverConsumerId", serverConsumerId, "is undefined");
      return;
    }
    await consumer.consumer.resume();
  });
};

start();
