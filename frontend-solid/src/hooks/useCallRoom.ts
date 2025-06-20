import { Accessor, createSignal, onMount, Setter } from "solid-js";
import io, { Socket } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import { Device } from "mediasoup-client";
import { AppData, Consumer, DtlsParameters, MediaKind, Producer, ProducerOptions, RtpCapabilities, RtpParameters, Transport, TransportOptions } from "mediasoup-client/types";
import { logEvent, logMethod } from "~/utils/logging";

interface IConsumerTransport {
  consumerTransport: Transport;
  serverConsumerTransportId: string;
  producerId: string;
  consumer: Consumer;
}

interface IAudioParams {
  track: MediaStreamTrack;
}

interface IVideoParams {
  params: ProducerOptions;  
  track: MediaStreamTrack;
}

interface ITransportProduceResponse {
  id: number;
  producersExist: boolean;
}

interface ISocketConsumeResponse {
  id: string,
  producerId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
  serverConsumerId: string;
  error: any;
}

export interface IUseCallRoomReturn {
  localMediaStream: Accessor<MediaStream>;
  consumerTransports: Accessor<IConsumerTransport[]>;
  logState: () => void;
  roomName: Accessor<string>;
  setRoomName: Setter<string>;
  userName: Accessor<string>;
  setUserName: Setter<string>;
  saveUserName: () => void;
  join: () => void;
  leave: () => void;
}

export const useCallRoom = (): IUseCallRoomReturn => {
  let socket: Socket = undefined!;

  let device: Device;
  let rtpCapabilities: RtpCapabilities;
  let producerTransport: Transport;
  const [consumerTransports, setConsumerTransports] = createSignal<Array<IConsumerTransport>>([]);
  const [localMediaStream, setLocalMediaStream] = createSignal<MediaStream>(undefined!);
  let audioProducer: Producer;
  let videoProducer: Producer;
  const [roomName, setRoomName] = createSignal<string>("");

  const [userName, setUserName] = createSignal<string>("");
  const saveUserName = () => {
    const name = userName().trim();
    if (name) {
      localStorage.setItem("userName", name);
      setUserName(name);
    } else {
      alert("The user name is empty. Please, enter your display name.");
    }
  };
  onMount(() => {
    const savedUserName = localStorage.getItem("userName");
    if (savedUserName !== null) setUserName(savedUserName);
  });

  let consumingTransports: Array<string> = [];

  let audioParams: IAudioParams = {
    track: undefined!,
  };
  let videoParams: IVideoParams = {
    track: undefined!,
    params: {
      encodings: [
        { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
        { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
        { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
      ],
      codecOptions: {
        videoGoogleStartBitrate: 1000,
      },
    },
  };

  // use with `onCleanup` if hooking from inside of a context
  const leave = () => {
    if (socket === undefined) return;
    if (!socket.disconnected) {
      try {
        socket.disconnect();
      } catch (error) {}
    }
  };

  //onCleanup(leave);
  //createEffect(on(params.roomName, leave));

  // use with `onMount` if hooking from inside of a context
  const join = () => {
    socket = io(`https://${window.location.hostname}:3000/mediasoup`, {
      transports: ['websocket'],
    });

    socket.on('disconnect', () => {
      console.error("disconnect");
      //device = undefined!;
      //producerTransport = undefined!;
      setConsumerTransports([]);
      //audioProducer = undefined!;
      //videoProducer = undefined!;
    });

    socket.on('connection-success', (data: {
      socketId: number,
      existsProducer: boolean,
    }) => {
      logEvent("socket.on 'connection-success'");
      logEvent("data", data);
      getLocalStream();
    });

    socket.on('new-producer', (data: {
      producerId: string
    }) => {
      logEvent("socket.on 'new-producer'");
      logEvent("data", data);
      signalNewConsumerTransport(data.producerId);
    });

    socket.on('producer-closed', (data: {
      remoteProducerId: string
    }) => {
      logEvent("socket.on 'producer-closed' :");
      logEvent("data", data);
      closeConsumerTransport(data.remoteProducerId);
    });
  };

  const getLocalStream = () => {
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: { width: { min: 640, max: 1920 }, height: { min: 400, max: 1080 }, },
      })
      .then(streamSuccess)
      .catch((error: any) => {
        console.error(error.message);
      });
  };

  const streamSuccess = async (stream: MediaStream) => {
    logMethod("streamSuccess()");
    logMethod("stream", stream);
    setLocalMediaStream(stream);
    audioParams.track = stream.getAudioTracks()[0];
    videoParams.track = stream.getVideoTracks()[0];
    joinRoom();
  };

  const joinRoom = () => {
    logEvent("socket.emit 'joinRoom'");
    socket.emit('joinRoom', { roomName: roomName() }, (data: {
      rtpCapabilities: RtpCapabilities;
    }) => {
      logEvent("socket.emit 'joinRoom' > callback");
      logEvent("data", data);
      rtpCapabilities = data.rtpCapabilities;
      createDevice();
    });
  };

  const createDevice = async () => {
    logMethod("createDevice()");
    try {
      device = new mediasoupClient.Device();
      await device.load({
        routerRtpCapabilities: rtpCapabilities,
      });
      logMethod("device", device);
      // once the device loads, create transport
      createSendTransport();
    } catch (error: any) {
      console.error(error);
      if (error.name === 'UnsupportedError') {
        console.error('browser not supported');
      }
    }
  }

  const createSendTransport = () => {
    logEvent("socket.emit 'createWebRtcTransport'");
    socket.emit('createWebRtcTransport', { consumer: false }, (
      data: TransportOptions
    ) => {
      logEvent("socket.emit 'createWebRtcTransport' > callback");
      logEvent("data", data);

      // TODO: check TransportOptions alternative return type documentation
      //if (data.params.error) {
      //  console.error("error: socket.emit 'createWebRtcTransport' ... data.params.error");
      //  return;
      //}

      // create a new WebRTC Transport based on the server's producer transport params
      producerTransport = device.createSendTransport(data);

      // when a first call to transport.produce() is made
      producerTransport.on('connect', async (
        data: { dtlsParameters: DtlsParameters },
        callback: Function,
        errback: Function,
      ) => {
        logEvent("producerTransport.on 'connect'");
        logEvent("data", data);
        try {
          // signal local DTLS prameters to the server side transport
          socket.emit('transport-connect', { dtlsParameters: data.dtlsParameters });
          // tell the transport that parameters were transmitted
          callback();
        } catch (error: any) {
          errback(error);
        }
      });

      producerTransport.on('produce', async (
        data:  {
          kind: MediaKind;
          rtpParameters: RtpParameters;
          appData: AppData;
        },
        callback: Function,
        errback: Function,
      ) => {
        logEvent("producerTransport.on 'produce'");
        logEvent("data", data);
        try {
          // thell the server to create a Producer with the following
          // parameters and produce and expect back a server side producer id
          logEvent("producerTransport.on 'produce' > socket.emit 'transport-produce'");
          socket.emit(
            'transport-produce',
            {
              kind: data.kind,
              rtpParameters: data.rtpParameters,
              appData: data.appData,
            },
            (data: ITransportProduceResponse) => {
              logEvent("producerTransport.on 'produce' > socket.emit 'transport-produce' > callback");
              logEvent("data", data);
              callback({ id: data.id });
              if (data.producersExist) {
                getProducers();
              }
            },
          );
        } catch (error: any) {
          errback(error);
        }
      });

      connectSendTransport();
    });
  };

  const connectSendTransport = async () => {
    logMethod("connectSendTransport()");
    logMethod("audioParams", audioParams);
    logMethod("videoParams", videoParams);

    // triggers the 'connect' and 'produce' events
    audioProducer = await producerTransport.produce(audioParams);
    videoProducer = await producerTransport.produce(videoParams);

    logMethod("audioProducer", audioProducer);
    logMethod("videoProducer", videoProducer);

    audioProducer.on('trackended', () => {
      logEvent("audioProducer.on 'trackended'");
    });
    audioProducer.on('transportclose', () => {
      logEvent("audioProducer.on 'transportclose'");
    });

    videoProducer.on('trackended', () => {
      logEvent("videoProducer.on 'trackended'");
    });
    videoProducer.on('transportclose', () => {
      logEvent("videoProducer.on 'transportclose'");
    });
  };

  const getProducers = () => {
    logEvent("socket.emit 'getProducers'");
    socket.emit('getProducers', (producerIds: Array<string>) => {
      logEvent("socket.emit 'getProducers' > callback")
      logEvent("data", producerIds);
      producerIds.forEach(signalNewConsumerTransport);
    });
  };

  const signalNewConsumerTransport = async (remoteProducerId: string) => {
    logMethod("signalNewConsumerTransport()");
    logMethod("data", remoteProducerId);

    // race condition
    if (consumingTransports.includes(remoteProducerId)) return;
    // race id tracking
    consumingTransports.push(remoteProducerId);
    //// the following won't be true until further communication
    //if (consumerTransports().some((e) => e.producerId === remoteProducerId)) return;

    logEvent("socket.emit 'createWebRtcTransport'");
    socket.emit('createWebRtcTransport', { consumer: true }, (
      data: TransportOptions,
    ) => {
      logEvent("socket.emit 'createWebRtcTransport' > callback");
      logEvent("data", data);

      // server sends back params needed to create Send Transport on client side
      //if (data.error) {
      //  console.log(data.params.error);
      //  return;
      //}

      // WebRTC Transport to receive media based on server's consumer transport params
      let consumerTransport;
      try {
        consumerTransport = device.createRecvTransport(data);
      } catch (error: any) {
        console.log(error);
        return;
      }

      // an event raised when the first call to transport.produce() is made
      consumerTransport.on('connect', async (
        data2: { dtlsParameters: DtlsParameters },
        callback: Function,
        errback: Function,
      ) => {
        logEvent("consumerTransport.on 'connect'");
        logEvent("data", data);
        try {
          logEvent("consumerTransport.on 'connect' > socket.emit 'transport-recv-connect'");
          // signal local DTLS parameters to the server side transport
          socket.emit('transport-recv-connect', {
            dtlsParameters: data2.dtlsParameters,
            serverConsumerTransportId: data.id,
          });
          // tell the transport that parameters were transmitted
          callback();
        } catch (error) {
          errback(error);
        }
      });

      connectRecvTransport(consumerTransport, remoteProducerId, data.id);
    });
  }

  const connectRecvTransport = async (
    consumerTransport: Transport,
    remoteProducerId: string,
    serverConsumerTransportId: string,
  ) => {
    logMethod("connectRecvTransport()");
    logMethod("consumerTransport", consumerTransport);
    logMethod("remoteProducerId", remoteProducerId);
    logMethod("serverConsumerTransportId", serverConsumerTransportId);
    logEvent("socket.emit 'consume'");
    socket.emit(
      'consume',
      { 
        rtpCapabilities: device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async (data: ISocketConsumeResponse) => {
        logEvent("socket.emit 'consume' > callback");
        logEvent("data", data);

        if (data.error) {
          console.log('Cannot consume');
          return;
        }

        const consumer = await consumerTransport.consume(data);

        setConsumerTransports(cts => [
          ...cts,
          {
            consumerTransport,
            serverConsumerTransportId: data.id,
            producerId: remoteProducerId,
            consumer,
          },
        ]);

        logEvent("socket.emit 'consume' > callback > socket.emit 'consumer-resume'");
        // the server consumer started with media paused so we need to inform
        // the server to resume
        socket.emit('consumer-resume', { serverConsumerId: data.serverConsumerId });
      },
    );
  };

  const closeConsumerTransport = (remoteProducerId: string) => {
    // a server notification is received when a producer is closed
    // close the client-side consumer and an associated transport
    logMethod(`self producer id ${producerTransport.id}`);
    logMethod(`looking to delete producer id ${remoteProducerId}`);
    const producerToClose = consumerTransports().find(
      ct => ct.producerId === remoteProducerId
    );
    if (producerToClose === undefined) {
      console.error("producerToClose is undefined");
      return;
    }
    producerToClose.consumerTransport.close();
    producerToClose.consumer.close();
    // remove consumer transport from the list
    setConsumerTransports(cts =>
      cts.filter(ct => ct.producerId !== remoteProducerId)
    );
  };

  const logState = () => {
    console.log("socket.id", socket.id);
    console.log("device", device);
    console.log("rtpCapabilities", rtpCapabilities);
    console.log("producerTransport", producerTransport);
    console.log("consumerTransports()", consumerTransports());
    console.log("audioProducer", audioProducer);
    console.log("videoProducer", videoProducer);
  };

  return {
    localMediaStream,
    consumerTransports,
    logState,
    roomName,
    setRoomName,
    userName,
    setUserName,
    saveUserName,
    join,
    leave,
  };
};
