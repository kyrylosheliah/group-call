import { createSignal, For, onMount, Show } from "solid-js";

import io, { Socket } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import { Device } from "mediasoup-client";
import { useParams } from "@solidjs/router";

const GroupCall = () => {
  let localVideoRef: HTMLVideoElement | undefined;
  let socket: Socket = undefined!;

  const params = useParams();
  const roomName = () => params.id;

  let device: Device;
  let rtpCapabilities: any;
  let producerTransport: mediasoupClient.types.Transport<mediasoupClient.types.AppData>;
  let [consumerTransports, setConsumerTransports] = createSignal<any[]>([]);
  let audioProducer: any;
  let videoProducer: any;
  //let consumer: any;

  let audioParams: any = {};
  let videoParams: any = {};
  let consumingTransports: any[] = [];

  let producerOptions: any = {
    encodings: [
      { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
      { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
      { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
    ],
    codecOptions: {
      videoGoogleStartBitrate: 1000,
    },
  };
  
  onMount(() => {
    socket = io(`https://${window.location.hostname}:3000/mediasoup`, {
      transports: ['websocket'],
    });
    socket.on('connection-success', (data: {
      socketId: any,
      existsProducer: any,
    }) => {
      console.log("socket.on'connection-success'", data);
      getLocalStream();
    });
    socket.on('new-producer', ({ producerId }: any) => {
      signalNewConsumerTransport(producerId);
    });
    socket.on('producer-closed', ({ remoteProducerId }: any) => {
      // server notification is received when a producer is closed
      // close the client-sze consumer and associated transport
      const producerToClose = consumerTransports().find(
        ct => ct.producerId === remoteProducerId
      );
      producerToClose.consumerTranport.close();
      producerToClose.consumer.close();
      // remove consumer transport from the list
      setConsumerTransports(
        consumerTransports().filter(ct => ct.producerId !== remoteProducerId)
      );
    });
  });

  const streamSuccess = async (stream: any) => {
    localVideoRef!.srcObject = stream;
    audioParams.track = stream.getAudioTracks()[0];
    videoParams.track = stream.getVideoTracks()[0];
    joinRoom();
  };

  const joinRoom = () => {
    socket.emit('joinRoom', { roomName }, (data: any) => {
      console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`);
      rtpCapabilities = data.rtpCapabilities;
      createDevice();
    });
  };

  const getLocalStream = () => {
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { width: { min: 640, max: 1920 }, height: { min: 400, max: 1080 }, },
      })
      .then(streamSuccess)
      .catch((error: any) => {
        console.log(error.message);
      });
  }

  const createDevice = async () => {
    try {
      device = new mediasoupClient.Device();
      await device.load({
        routerRtpCapabilities: rtpCapabilities,
      });
      console.log('RtpCapabilites', device.rtpCapabilities);
      // once the device loads, create transport
      createSendTransport();
    } catch (error: any) {
      console.log(error);
      if (error.name === 'UnsupportedError') {
        console.warn('browser not supported');
      }
    }
  }

  //const getRtpCapabilities = () => {
  //  socket.emit('createRoom', (data: any) => { // 'getRtpCapabilities'
  //    console.log(`Router RtpCapabilities: ${data.rtpCapabbilities}`);
  //    rtpCapabilities = data.rtpCapabilities;
  //    createDevice();
  //  });
  //}

  const createSendTransport = () => {
    socket.emit('createWebRtcTransport', { consumer: false }, ({ params }: any) => {
      if (params.error) {
        console.log(params.error);
        return;
      }
      console.log(params);

      // create a new WebRTC Transport based on the server's producer transport params
      producerTransport = device.createSendTransport(params);

      // when a first call to transport.produce() is made
      producerTransport.on('connect', async (
        { dtlsParameters }: any,
        callback: any,
        errback: any,
      ) => {
        try {
          // signal local DTLS prameters to the server side transport
          await socket.emit('transport-connect', { dtlsParameters });
          // tell the transport that parameters were transmitted
          callback();
        } catch (error: any) {
          errback(error);
        }
      });

      producerTransport.on('produce', async (parameters: any, callback: any, errback: any) => {
        console.log(parameters);
        try {
          // thell the server to create a Producer with the following
          // parameters and produce and expect back a server side producer id
          await socket.emit('transport-produce', {
            kind: parameters.kind,
            rtpParameters: parameters.rtpParameters,
            appData: parameters.appData,
          }, ({ id, producerExist }: any) => {
            callback({ id });
            if (producerExist) getProducers();
          });
        } catch (error: any) {
          errback(error);
        }
      })

      connectSendTransport();
    });
  };

  const connectSendTransport = async () => {
    //trigger the 'connect' and 'produce' events
    audioProducer = await producerTransport.produce(audioParams);
    videoProducer = await producerTransport.produce(videoParams);

    audioProducer.on('trackended', () => {
      console.log('audio track ended');
      // TODO: close the track
    });
    audioProducer.on('transportclose', () => {
      console.log('audio transport ended');
      // TODO: close the transport
    });

    videoProducer.on('trackended', () => {
      console.log('video track ended');
      // TODO: close the track
    });
    videoProducer.on('transportclose', () => {
      console.log('video transport ended');
      // TODO: close the transport
    });
  };

  const signalNewConsumerTransport = async (remoteProducerId: any) => {
    if (consumingTransports.includes(remoteProducerId)) return;
    consumingTransports.push(remoteProducerId);

    await socket.emit('createWebRtcTransport', { consumer: true }, ({ params }: any) => {
      // server sends back params needed to create Send Transport on client side
      if (params.error) {
        console.log(params.error);
        return;
      }
      console.log(params);

      // WebRTC Transport to receive media based on server's consumer transport params
      let consumerTransport;
      try {
        consumerTransport = device.createRecvTransport(params);
      } catch (error) {
        console.log(error);
        return;
      }

      // an event raised when the first call to transport.produce() is made
      consumerTransport.on('connect', async (
        { dtlsParameters }: any,
        callback: any,
        errback: any,
      ) => {
        try {
          // signal local DTLS parameters to the server side transport
          await socket.emit('transport-recv-connect', {
            dtlsParameters,
            serverConsumerTransportId: params.id,
          });
          // tell the transport that parameters were transmitted
          callback();
        } catch (error) {
          errback(error);
        }
      })

      connectRecvTransport(consumerTransport, remoteProducerId, params.id);
    });
  }

  const getProducers = () => {
    socket.emit('getProducers', (producerIds: any) => {
      console.log(producerIds);
      producerIds.forEach(signalNewConsumerTransport);
    });
  };

  const connectRecvTransport = async (
    consumerTransport: any,
    remoteProducerId: any,
    serverConsumerTransportId: any,
  ) => {
    await socket.emit(
      'consume',
      { 
        rtpCapabilities: device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async ({ params }: any) => {
        if (params.error) {
          console.log('Cannot consume');
          return;
        }
        console.log(params);

        const consumer = await consumerTransport.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
        });

        // TODO: questionable
        const cts = consumerTransports();
        cts.push({
          consumerTransport,
          serverConsumerTransportId: params.id,
          producerId: remoteProducerId,
          consumer,
        });
        // should trigger <For each={}> dynamic srcObject binding
        setConsumerTransports(cts);

        // the server consumer started with media paused so we need to inform
        // the server to resume
        socket.emit('consumer-resume', { serverConsumerId: params.serverConsumerId });
      },
    );
  };

  return (
    <div>
      <div>Room "{roomName()}"</div>
      <div><video ref={localVideoRef} autoplay class="video" /></div>
      <Show
        fallback={<div>No room specified</div>}
        when={roomName()}
      >
        <For each={consumerTransports()}>{
          (ct) => (<div><video autoplay class="video" ref={(ref) => {
            ref.srcObject = new MediaStream([ct.consumer.track]);
          }} /></div>)
        }</For>
      </Show>
    </div>
  );
};

export default GroupCall;
