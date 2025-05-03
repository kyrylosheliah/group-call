import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

import io, { Socket } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import { Device } from "mediasoup-client";
import { ProducerOptions } from "mediasoup-client/types";

const GroupCall = (params: {
  roomName: string;
}) => {
  let localVideoRef: HTMLVideoElement | undefined;
  let socket: Socket = undefined!;

  let device: Device;
  let rtpCapabilities: any;
  let producerTransport: mediasoupClient.types.Transport<mediasoupClient.types.AppData>;
  let [consumerTransports, setConsumerTransports] = createSignal<any[]>([]);
  let audioProducer: any;
  let videoProducer: any;
  //let consumer: any;

  let audioParams: any = {};
  let videoParams: { params: ProducerOptions, track: MediaStreamTrack } = {
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
    track: undefined!,
  };
  let consumingTransports: any[] = [];
  
  onMount(() => {
    socket = io(`https://${window.location.hostname}:3000/mediasoup`, {
      transports: ['websocket'],
    });

    socket.on('connection-success', (data: {
      socketId: any,
      existsProducer: any,
    }) => {
      console.log("socket.on 'success' :", data);
      getLocalStream();
    });

    socket.on('new-producer', (data: {
      producerId: any
    }) => {
      console.log("socket.on 'new-producer' :", data);
      signalNewConsumerTransport(data.producerId);
    });

    socket.on('producer-closed', (data: {
      remoteProducerId: any
    }) => {
      console.log("socket.on 'producer-closed' :", data);
      // server notification is received when a producer is closed
      // close the client-sze consumer and associated transport
      const producerToClose = consumerTransports().find(
        ct => ct.producerId === data.remoteProducerId
      );
      producerToClose.consumerTranport.close();
      producerToClose.consumer.close();
      // remove consumer transport from the list
      setConsumerTransports(cts =>
        cts.filter(ct => ct.producerId !== data.remoteProducerId)
      );
    });
  });

  const getLocalStream = () => {
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: { width: { min: 640, max: 1920 }, height: { min: 400, max: 1080 }, },
      })
      .then(streamSuccess)
      .catch((error: any) => {
        console.log(error.message);
      });
  };

  const streamSuccess = async (stream: MediaStream) => {
    console.log(`streamSuccess() :`, stream);
    localVideoRef!.srcObject = stream;
    audioParams.track = stream.getAudioTracks()[0];
    videoParams.track = stream.getVideoTracks()[0];
    joinRoom();
  };

  const joinRoom = () => {
    socket.emit('joinRoom', { roomName: params.roomName }, (data: any) => {
      console.log("socket.emit 'joinRoom' =>", data);
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
      console.log("createDevice() +", device);
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
    socket.emit('createWebRtcTransport', { consumer: false }, (data: {
      params: any
    }) => {
      console.log("socket.emit 'createWebRtcTransport' =>", data);

      if (data.params.error) {
        console.log("[!error] socket.emit 'createWebRtcTransport' ... data.params.error");
        return;
      }

      // create a new WebRTC Transport based on the server's producer transport params
      producerTransport = device.createSendTransport(data.params);

      // when a first call to transport.produce() is made
      producerTransport.on('connect', async (
        data: { dtlsParameters: any },
        callback: any,
        errback: any,
      ) => {
        console.log("producerTransport.on 'connect' :", data);
        try {
          // signal local DTLS prameters to the server side transport
          socket.emit('transport-connect', data);// { dtlsParameters });
          // tell the transport that parameters were transmitted
          callback();
        } catch (error: any) {
          errback(error);
        }
      });

      producerTransport.on('produce', async (
        data: any,
        callback: any,
        errback: any,
      ) => {
        console.log("producerTransport.on 'produce' :", data);
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
            (data: { id: any, producersExist: any }) => {
              console.log("socket.emit 'transport-produce' =>", data);
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
    //console.log("connectSendTransport() :", audioParams);
    //console.log("connectSendTransport() :", videoParams);
    //trigger the 'connect' and 'produce' events
    audioProducer = await producerTransport.produce(audioParams);
    videoProducer = await producerTransport.produce(videoParams);

    console.log("connectSendTransport() +", audioProducer, videoProducer);

    audioProducer.on('trackended', () => {
      console.log("audioProducer.on 'trackended'");
      // TODO: close the track
    });
    audioProducer.on('transportclose', () => {
      console.log("audioProducer.on 'transportclose'");
      // TODO: close the transport
    });

    videoProducer.on('trackended', () => {
      console.log("videoProducer.on 'trackended'");
      // TODO: close the track
    });
    videoProducer.on('transportclose', () => {
      console.log("videoProducer.on 'transportclose'");
      // TODO: close the transport
    });
  };

  const getProducers = () => {
    socket.emit('getProducers', (producerIds: any) => {
      console.log("consumerTransport.emit 'getProducers' =>", producerIds);
      producerIds.forEach(signalNewConsumerTransport);
    });
  };

  const signalNewConsumerTransport = async (remoteProducerId: any) => {
    console.log("signalNewConsumerTransport() :", remoteProducerId);
    if (consumingTransports.includes(remoteProducerId)) return;
    consumingTransports.push(remoteProducerId);

    socket.emit('createWebRtcTransport', { consumer: true }, (data: { params: any }) => {
      console.log("socket.emit 'createWebRtcTransport' =>", data);

      // server sends back params needed to create Send Transport on client side
      if (data.params.error) {
        console.log(data.params.error);
        return;
      }

      // WebRTC Transport to receive media based on server's consumer transport params
      let consumerTransport;
      try {
        consumerTransport = device.createRecvTransport(data.params);
      } catch (error) {
        console.log(error);
        return;
      }

      // an event raised when the first call to transport.produce() is made
      consumerTransport.on('connect', async (
        data2: { dtlsParameters: any },
        callback: any,
        errback: any,
      ) => {
        console.log("consumerTransport.on 'connect' :", data);
        try {
          // signal local DTLS parameters to the server side transport
          socket.emit('transport-recv-connect', {
            dtlsParameters: data2.dtlsParameters,
            serverConsumerTransportId: data.params.id,
          });
          // tell the transport that parameters were transmitted
          callback();
        } catch (error) {
          errback(error);
        }
      });

      connectRecvTransport(consumerTransport, remoteProducerId, data.params.id);
    });
  }

  const connectRecvTransport = async (
    consumerTransport: any,
    remoteProducerId: any,
    serverConsumerTransportId: any,
  ) => {
    console.log("connectRecvTransport() :", consumerTransport, remoteProducerId, serverConsumerTransportId);
    socket.emit(
      'consume',
      { 
        rtpCapabilities: device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async (data: { params: any }) => {
        console.log("socket.emit 'consume' :", data);

        if (data.params.error) {
          console.log('Cannot consume');
          return;
        }

        const consumer = await consumerTransport.consume(data.params);
        //consume({
        //  id: data.params.id,
        //  producerId: data.params.producerId,
        //  kind: data.params.kind,
        //  rtpParameters: data.params.rtpParameters,
        //});

        setConsumerTransports(cts => [
          ...cts,
          {
            consumerTransport,
            serverConsumerTransportId: data.params.id,
            producerId: remoteProducerId,
            consumer,
          },
        ]);

        // the server consumer started with media paused so we need to inform
        // the server to resume
        socket.emit('consumer-resume', { serverConsumerId: data.params.serverConsumerId });
      },
    );
  };

  return (
    <div>
      <div>Room "{params.roomName}"</div>
      <button onClick={() => {
        console.log(consumerTransports());
      }}>log consumer transports</button>
      <div><video ref={localVideoRef} autoplay class="video" /></div>
      <Show
        fallback={<div>No room specified</div>}
        when={params.roomName}
      >
        <Show
          fallback={<div>No other participants present</div>}
          when={consumerTransports().length}
        >
          <For each={consumerTransports()}>{(ct, index) => {
            if (ct.consumer.kind === "video") {
              return <video autoplay class="video" ref={(videoRef) => {
                console.log("rendering consumer source index", index);
                videoRef.srcObject = new MediaStream([ct.consumer.track]);
              }}/>;
            } else if (ct.consumer.kind === "audio") {
              return <audio autoplay ref={(audioRef) => {
                console.log("rendering consumer source index", index);
                audioRef.srcObject = new MediaStream([ct.consumer.track]);
              }}/>;
            }
            return <></>;
          }}</For>
        </Show>
      </Show>
    </div>
  );
};

export default GroupCall;
