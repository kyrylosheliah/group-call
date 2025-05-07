import { createSignal, onCleanup, onMount } from "solid-js";

import io, { Socket } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import { Device } from "mediasoup-client";
import { AppData, Consumer, DtlsParameters, MediaKind, Producer, ProducerOptions, RtpCapabilities, RtpParameters, Transport, TransportOptions } from "mediasoup-client/types";
import { log1stage, log2stage } from "~/utils/logging";

interface IConsumerTransport {
  consumerTransport: Transport<AppData>;
  serverConsumerTransportId: string;
  producerId: string;
  consumer: Consumer<AppData>;
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

export const joinGroupCall = (params: {
  roomName: string;
}) => {
  let socket: Socket = undefined!;

  let device: Device;
  let rtpCapabilities: RtpCapabilities;
  let producerTransport: Transport<AppData>;
  const [consumerTransports, setConsumerTransports] = createSignal<Array<IConsumerTransport>>([]);
  const [localMediaStream, setLocalMediaStream] = createSignal<MediaStream>(undefined!);
  let audioProducer: Producer<AppData>;
  let videoProducer: Producer<AppData>;

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
  
  onMount(() => {
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
      log1stage("socket.on 'success' :", data);
      getLocalStream();
    });

    socket.on('new-producer', (data: {
      producerId: string
    }) => {
      log1stage("socket.on 'new-producer' :", data);
      signalNewConsumerTransport(data.producerId);
    });

    socket.on('producer-closed', (data: {
      remoteProducerId: string
    }) => {
      log1stage("socket.on 'producer-closed' :", data);
      closeConsumerTransport(data.remoteProducerId);
    });
  });

  onCleanup(() => {
    if (socket !== undefined) {
      try { socket.disconnect(); }
      catch(error) {}
    }
  });

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
    log1stage(`streamSuccess() :`, stream);
    //localVideoRef!.srcObject = stream;
    setLocalMediaStream(stream);
    audioParams.track = stream.getAudioTracks()[0];
    videoParams.track = stream.getVideoTracks()[0];
    joinRoom();
  };

  const joinRoom = () => {
    socket.emit('joinRoom', { roomName: params.roomName }, (data: {
      rtpCapabilities: RtpCapabilities;
    }) => {
      log1stage("socket.emit 'joinRoom' =>", data);
      rtpCapabilities = data.rtpCapabilities;
      createDevice();
    });
  };

  const createDevice = async () => {
    try {
      device = new mediasoupClient.Device();
      await device.load({
        routerRtpCapabilities: rtpCapabilities,
      });
      log1stage("createDevice() +", device);
      // once the device loads, create transport
      createSendTransport();
    } catch (error: any) {
      console.log(error);
      if (error.name === 'UnsupportedError') {
        console.warn('browser not supported');
      }
    }
  }

  const createSendTransport = () => {
    socket.emit('createWebRtcTransport', { consumer: false }, (
      data: TransportOptions
    ) => {
      log1stage("socket.emit 'createWebRtcTransport' =>", data);

      // TODO: check TransportOptions alternative return type documentation
      //if (data.params.error) {
      //  console.log("[!error] socket.emit 'createWebRtcTransport' ... data.params.error");
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
        log1stage("producerTransport.on 'connect' :", data);
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
        log1stage("producerTransport.on 'produce' :", data);
        try {
          // thell the server to create a Producer with the following
          // parameters and produce and expect back a server side producer id
          socket.emit(
            'transport-produce',
            {
              kind: data.kind,
              rtpParameters: data.rtpParameters,
              appData: data.appData,
            },
            (data: ITransportProduceResponse) => {
              log1stage("socket.emit 'transport-produce' =>", data);
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
    log1stage("connectSendTransport() :", audioParams);
    log1stage("connectSendTransport() :", videoParams);

    //trigger the 'connect' and 'produce' events
    audioProducer = await producerTransport.produce(audioParams);
    videoProducer = await producerTransport.produce(videoParams);

    log1stage("connectSendTransport() +", audioProducer, videoProducer);

    audioProducer.on('trackended', () => {
      log1stage("audioProducer.on 'trackended'");
    });
    audioProducer.on('transportclose', () => {
      log1stage("audioProducer.on 'transportclose'");
    });

    videoProducer.on('trackended', () => {
      log1stage("videoProducer.on 'trackended'");
    });
    videoProducer.on('transportclose', () => {
      log1stage("videoProducer.on 'transportclose'");
    });
  };

  const getProducers = () => {
    socket.emit('getProducers', (producerIds: Array<string>) => {
      log1stage("consumerTransport.emit 'getProducers' =>", producerIds);
      producerIds.forEach(signalNewConsumerTransport);
    });
  };

  const signalNewConsumerTransport = async (remoteProducerId: string) => {
    log1stage("signalNewConsumerTransport() :", remoteProducerId);
    // race condition here
    //if (consumerTransports().some((e) => e.producerId === remoteProducerId)) return;
    // the following is preferred (atomic id tracking)
    if (consumingTransports.includes(remoteProducerId)) return;
    consumingTransports.push(remoteProducerId);

    socket.emit('createWebRtcTransport', { consumer: true }, (
      data: TransportOptions,
    ) => {
      log1stage("socket.emit 'createWebRtcTransport' =>", data);

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
        log1stage("consumerTransport.on 'connect' :", data);
        try {
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
    consumerTransport: Transport<AppData>,
    remoteProducerId: string,
    serverConsumerTransportId: string,
  ) => {
    log1stage("connectRecvTransport() :", consumerTransport, remoteProducerId, serverConsumerTransportId);
    socket.emit(
      'consume',
      { 
        rtpCapabilities: device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async (data: ISocketConsumeResponse) => {
        log1stage("socket.emit 'consume' :", data);

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

        // the server consumer started with media paused so we need to inform
        // the server to resume
        socket.emit('consumer-resume', { serverConsumerId: data.serverConsumerId });
      },
    );
  };

  const closeConsumerTransport = (remoteProducerId: string) => {
    // server notification is received when a producer is closed
    // close the client-side consumer and an associated transport
    log2stage(`self producer id ${producerTransport.id}`);
    log2stage(`looking to delete producer id ${remoteProducerId}`);
    const producerToClose = consumerTransports().find(
      ct => ct.producerId === remoteProducerId
    );
    if (producerToClose !== undefined) {
      producerToClose.consumerTransport.close();
      producerToClose.consumer.close();
    }
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
  };
};
