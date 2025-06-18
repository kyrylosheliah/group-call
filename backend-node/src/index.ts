import express from "express";
import fs from "fs";
import https from "https";
import { Server, Socket } from "socket.io";
import * as config from "./config.js";
import { log1stage, log2stage, log3stage } from "./logging.js";
import * as mediasoup from "mediasoup";
import { IConsumer, IPeers, IProducer, IRooms, ITransport } from "./types.js";
import {
  Consumer,
  Producer,
  Router,
  Transport,
  WebRtcTransport,
  Worker,
} from "mediasoup/node/lib/types.js";

const str = (o: any) => JSON.stringify(o);

class GroupCallServer {
  worker: Worker = undefined!;
  rooms: IRooms = {};
  peers: IPeers = {};
  transports: ITransport[] = [];
  producers: IProducer[] = [];
  consumers: IConsumer[] = [];

  constructor() {
    //config.webRtcTransportOptions.listenInfos!.push(...this.getIpAddresses());
    //console.log(config.webRtcTransportOptions.listenInfos);
  }

  async start() {
    this.worker = await mediasoup.createWorker({
      rtcMinPort: 50000,
      rtcMaxPort: 59999,
      ...config.workerSettings,
    });
    log1stage(`createWorker() | pid ${this.worker.pid}`);
    this.worker.on("died", (error) => {
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
        origin: [`https://${config.domain}`],
      },
    });

    //const intervalId = setInterval(() => {
    //  log2stage("====\n====\n====");
    //  log2stage(`- this.transports`);
    //  for (const t of this.transports) {
    //    log2stage(`socket ${t.socketId} transport ${t.transport.id}`);
    //  }
    //  log2stage(`- producers`);
    //  for (const p of producers) {p
    //    log2stage(`socket ${p.socketId} producer ${p.producer.id}`);
    //  }
    //  log2stage(`- consumers`);
    //  for (const c of consumers) {
    //    log2stage(`socket ${c.socketId} consumer ${c.consumer.id}`);
    //  }
    //}, 5000);

    const connections = io.of("/mediasoup");

    connections.on("connection", this.onConnection);
  }

  async onConnection(socket: Socket) {
    log1stage(`${socket.id} connections.on 'connection'`);

    socket.emit("connection-success", {
      socketId: socket.id,
    });

    const removeItems = (items: any[], socketId: string, type: any) => {
      items.forEach((item) => {
        if (item.socketId === socketId) {
          log2stage(`closing ${str(item)}`);
          item[type].close();
        }
      });
      items = items.filter((item) => item.socketId !== socketId);
      return items;
    };

    socket.on("disconnect", () => {
      log1stage(`${socket.id} socket.on 'disconnect'`);
      log2stage(`${socket.id} removing consumers ...`);
      this.consumers = removeItems(this.consumers, socket.id, "consumer");
      log2stage(`${socket.id} removing producers ...`);
      this.producers = removeItems(this.producers, socket.id, "producer");
      log2stage(`${socket.id} removing this.transports ...`);
      this.transports = removeItems(this.transports, socket.id, "transport");
      if (!this.peers[socket.id]) {
        log1stage(
          `${socket.id} socket.on 'disconnect' ... this.peers[socket.id] is undefined`
        );
        return;
      }
      const { roomName } = this.peers[socket.id];
      delete this.peers[socket.id];
      this.rooms[roomName].peers = this.rooms[roomName].peers.filter(
        (socketId) => socketId !== socket.id
      );
      if (this.rooms[roomName].peers.length === 0) {
        delete this.rooms[roomName];
      }
    });

    socket.on("joinRoom", async (data, callback) => {
      log1stage(`${socket.id} socket.on 'joinRoom' | ${str(data)}`);
      const { roomName } = data;
      const router = await createRoom(roomName, socket.id);
      this.peers[socket.id] = {
        socket,
        roomName,
        //transports: [],
        //producers: [],
        //consumers: [],
        peerDetails: {
          name: "",
          isAdmin: false,
        },
      };
      const rtpCapabilities = router.rtpCapabilities;
      callback({ rtpCapabilities });
    });

    const createRoom = async (roomName: string | number, socketId: string) => {
      if (!this.rooms[roomName]) {
        this.rooms[roomName] = {
          router: await this.worker.createRouter(config.routerOptions),
          peers: [],
        };
      }
      const room = this.rooms[roomName];
      const router = room.router;
      const peers = room.peers;
      log1stage(
        `createRoom() | roomName ${roomName} | router.id ${router.id} | this.peers.length ${peers.length}`
      );
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

    socket.on("createWebRtcTransport", async (data, callback) => {
      log1stage(
        `${socket.id} socket.on 'createWebRtcTransport' | ${str(data)}`
      );
      const { consumer } = data;
      const roomName = this.peers[socket.id].roomName;
      const router = this.rooms[roomName].router;
      this.createWebRtcTransport(router)
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

    const addTransport = (
      transport: Transport,
      roomName: string,
      consumer: any
    ) => {
      this.transports.push({ socketId: socket.id, transport, roomName, consumer });
      //peers[socket.id].transports.push(transport.id);
    };

    const addProducer = (producer: Producer, roomName: string) => {
      this.producers.push({ socketId: socket.id, producer, roomName });
      //peers[socket.id].producers.push(producer.id);
    };

    const addConsumer = (consumer: Consumer, roomName: string) => {
      this.consumers.push({ socketId: socket.id, consumer, roomName });
      //peers[socket.id].consumers.push(consumer.id);
    };

    socket.on("getProducers", (callback) => {
      // TODO: Error: connect() already called [method:webRtcTransport.connect]
      // recreate by:
      // - restart the server for the first time while the client is up
      // - let the client prompt you to focus window
      // - restart the server the second time
      log1stage(`${socket.id} socket.on 'getProducers'`);
      // return all producer this.transports
      const { roomName } = this.peers[socket.id];
      let producerIdList: string[] = [];
      this.producers.forEach((p) => {
        if (p.socketId !== socket.id && p.roomName === roomName) {
          producerIdList.push(p.producer.id);
        }
      });
      callback(producerIdList);
    });

    const informConsumers = (roomName: string, socketId: string, producerId: string) => {
      log1stage(
        `[${socketId}] informConsumers() | producerId ${producerId} joined ${roomName}`
      );
      log2stage(`===`);
      this.producers.forEach((p) => {
        if (p.socketId !== socketId && p.roomName === roomName) {
          log2stage(`[+] ${p.socketId} ${socketId}`);
          const producerSocket = this.peers[p.socketId].socket;
          producerSocket.emit("new-producer", { producerId });
        } else {
          log2stage(`[ ] ${p.socketId} ${socketId}`);
        }
      });
    };

    const findUnconsumedTransportBySocketId = (socketId: string): Transport | undefined => {
      return this.transports.find(
        (t) => t.socketId === socketId && !t.consumer
      )?.transport;
    };

    socket.on("transport-connect", (data) => {
      log1stage(`${socket.id} socket.on 'transport-connect' | ${str(data)}`);
      const { dtlsParameters } = data;
      const transport = findUnconsumedTransportBySocketId(socket.id);
      if (!transport) {
        log3stage(`error 'transport-connect': the transport for socket {socket.id} is undefined`);
        return;
      }
      transport.connect({ dtlsParameters });
    });

    socket.on("transport-produce", async (data, callback) => {
      log1stage(`${socket.id} socket.on 'transport-produce' | ${str(data)}`);
      const { kind, rtpParameters, appData } = data;
      const transport = findUnconsumedTransportBySocketId(socket.id);
      if (!transport) {
        log3stage(`error 'transport-produce': the transport for socket {socket.id} is undefined`);
        return;
      }
      const producer = await transport.produce({ kind, rtpParameters });
      const { roomName } = this.peers[socket.id];
      addProducer(producer, roomName);
      informConsumers(roomName, socket.id, producer.id);
      producer.on("transportclose", () => {
        log1stage(`${socket.id} producer.on 'transportclose'`);
        producer.close();
      });
      // send the producer's id back to the client
      callback({
        id: producer.id,
        producersExist: this.producers.length > 0,
      });
    });

    const findConsumedTransportById = (transportId: string): Transport | undefined => {
      return this.transports.find(
        (t) => t.transport.id === transportId && t.consumer
      )?.transport;
    };

    socket.on("transport-recv-connect", async (data) => {
      log1stage(
        `${socket.id} socket.on 'transport-recv-connect' | ${str(data)}`
      );
      const { dtlsParameters, serverConsumerTransportId } = data;
      const consumerTransport = findConsumedTransportById(serverConsumerTransportId);
      // TypeError: Cannot read properties of undefined (reading 'transport')
      if (!consumerTransport) {
        log3stage(`error 'transport-recv-connect': the transport for socket {socket.id} is undefined`);
        return;
      }
      await consumerTransport.connect({ dtlsParameters });
    });

    socket.on("consume", async (data, callback) => {
      log1stage(`${socket.id} socket.on 'consume' | ${str(data)}`);
      const { rtpCapabilities, remoteProducerId, serverConsumerTransportId } =
        data;
      try {
        const { roomName } = this.peers[socket.id];
        const router = this.rooms[roomName].router;
        let consumerTransport = findConsumedTransportById(serverConsumerTransportId);
        if (!consumerTransport) {
          log3stage(`error 'consume': the consumerTransport for serverConsumerTransportId {serverConsumerTransportId} is undefined`);
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
            log1stage(`${socket.id} consumer.on 'transportclose'`);
            log1stage("transport close from consumer");
          });
          consumer.on("producerclose", () => {
            log1stage(`${socket.id} consumer.on 'producerclose'`);
            socket.emit("producer-closed", { remoteProducerId });
            consumerTransport.close();
            this.transports = this.transports.filter(
              (t) => t.transport.id !== consumerTransport.id
            );
            consumer.close();
            this.consumers = this.consumers.filter((c) => c.consumer.id !== consumer.id);
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
      log1stage(`${socket.id} socket.on 'consumer-resume' | ${str(data)}`);
      const { serverConsumerId } = data;
      const consumer = this.consumers.find(
        (c) => c.consumer.id === serverConsumerId
      );
      if (!consumer) {
        log3stage(`error 'consumer-resume': the consumer for serverConsumerId {serverConsumerId} is undefined`);
        return;
      }
      await consumer.consumer.resume();
    });
  }

  async createWebRtcTransport(router: Router): Promise<WebRtcTransport> {
    return new Promise(async (resolve, reject) => {
      try {
        let transport = await router.createWebRtcTransport(
          config.webRtcTransportOptions
        );
        log1stage(`createWebRtcTransport() | transport.id ${transport.id}`);
        transport.on("dtlsstatechange", (dtlsState) => {
          log1stage(
            `transport.on 'dtlsstatechange' | dtlsState ${dtlsState} | transport.id ${transport.id}`
          );
          if (dtlsState === "closed") {
            transport.close();
          }
        });
        transport.on("@close", () => {
          log1stage(`transport.on 'close' | transport.id ${transport.id}`);
        });
        resolve(transport);
      } catch (error) {
        console.error(error);
        //callback({ params: { error: error } });
        reject(error);
      }
    });
  }
}

new GroupCallServer().start();
