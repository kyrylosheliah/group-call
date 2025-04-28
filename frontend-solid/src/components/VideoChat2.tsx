import { createSignal, For, onMount } from "solid-js";

import io, { Socket } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import { Device } from "mediasoup-client";

const VideoChat2 = () => {
  let localVideoRef: HTMLVideoElement | undefined;
  let remoteVideoRef: HTMLVideoElement | undefined;
  let socket: Socket = undefined!;

  let [WLH, setWLH] = createSignal<string>("0.0.0.0");
  let [logging, setLogging] = createSignal<string>("");
  
  onMount(() => {
    const hostname = `https://${window.location.hostname}:3000/mediasoup`;
    setWLH(hostname);
    socket = io(hostname, {
      transports: ['websocket'],
    });
    socket.on('connection-success', ({ socketId, existsProducer }: any) => {
      console.log(socketId, existsProducer);
    });
  });

  let device: Device;
  let rtpCapabilities: any;
  let producerTransport: any;
  let consumerTransport: any;
  let producer: any;
  let consumer: any;
  let isProducer: boolean = false;

  // producer options
  let params: any = {
    encodings: [
      { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
      { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
      { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
    ],
    codecOptions: {
      videoGoogleStartBitrate: 1000,
    },
  };

  const streamSuccess = async (stream: any) => {
    localVideoRef!.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    params = { track, ...params };
    goConnect(true);
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

  const goConsume = () => {
    goConnect(false);
  };

  const goConnect = (producerElseConsumer: boolean) => {
    isProducer = producerElseConsumer;
    if (device === undefined) {
      getRtpCapabilities()
    } else {
      goCreateTransport()
    }
  };

  const goCreateTransport = () => {
    if (isProducer) {
      createSendTransport();
    } else {
      createRecvTransport();
    }
  };

  const createDevice = async () => {
    try {
      device = new mediasoupClient.Device();
      await device.load({
        routerRtpCapabilities: rtpCapabilities,
      });
      console.log('RtpCapabilites', device.rtpCapabilities);
      // once the device loads, create transport
      goCreateTransport();
    } catch (error: any) {
      console.log(error);
      if (error.name === 'UnsupportedError') {
        console.warn('browser not supported');
      }
    }
  }

  const getRtpCapabilities = () => {
    setLogging(`before socket.emit\n${logging()}`);
    socket.emit('createRoom', (data: any) => { // 'getRtpCapabilities'
      setLogging(`after socket.emit\n${logging()}`);
      console.log(`Router RtpCapabilities: ${data.rtpCapabbilities}`);
      rtpCapabilities = data.rtpCapabilities;
      setLogging(`Router RtpCapabilities: ${data.rtpCapabbilities}\n${logging()}`);
      createDevice();
    });
  }

  const createSendTransport = () => {
    socket.emit('createWebRtcTransport', { sender: true }, ({ params }: any) => {
      if (params.error) {
        console.log(params.error);
        return;
      }
      console.log(params);

      // create a new WebRTC Transport based on the server's producer transport params
      producerTransport = device.createSendTransport(params);

      // when a first call to transport.produce() is made
      producerTransport.on('connect', async ({ dtlsParameters }: any, callback: any, errback: any) => {
        try {
          // signal local DTLS prameters to the server side transport
          await socket.emit('transport-connect', {
            dtlsParameters,
          });
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
          }, ({ id }: any) => {
            callback({ id });
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
    producer = await producerTransport.produce(params);

    producer.on('trackended', () => {
      console.log('track ended');
      // TODO: close video track
    });
    
    producer.on('transportclose', () => {
      console.log('transport ended');
      // TODO: close video track
    });
  };

  const createRecvTransport = async () => {
    // a call from Consumer wit sender = false
    await socket.emit('createWebRtcTransport', { sender: false }, ({ params }: any) => {
      // server sends back params needed to create Send Transport on client side
      if (params.error) {
        console.log(params.error);
        return;
      }
      console.log(params);

      // WebRTC Transport to receive media based on server's consumer transport params
      consumerTransport = device.createRecvTransport(params);

      // an event raised when the first call to transport.produce() is made
      consumerTransport.on('connect', async ({ dtlsParameters }: any, callback: any, errback: any ) => {
        try {
          // signal local DTLS parameters to the server side transport
          await socket.emit('transport-recv-connect', { dtlsParameters });
          // tell the transport that parameters were transmitted
          callback();
        } catch (error) {
          errback(error);
        }
      })

      connectRecvTransport();
    });
  }

  const connectRecvTransport = async () => {
    await socket.emit(
      'consume',
      { rtpCapabilities: device.rtpCapabilities },
      async ({ params }: any) => {
        if (params.error) {
          console.log('Cannot consume');
          return;
        }
        console.log(params);

        consumer = await consumerTransport.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
        });

        const { track } = consumer;
        //console.log(track);
        remoteVideoRef!.srcObject = new MediaStream([track]);

        // the server consumer started with media paused so we need to inform
        // the server to resume
        socket.emit('consumer-resume');
      },
    );
  };

  return (
    <div id="video">
      <div>{WLH()}</div>
      <table>
        <thead>
          <tr>
            <th>Local Video</th>
            <th>Remote Video</th>
          </tr>
        </thead>
        <tbody class="[&_button]:m-2.5 [&_button]:border [&_button]:border-rounded-md [&_button]:p-1 [&_button:hover]:bg-red">
          <tr>
            <td>
              <video ref={localVideoRef} autoplay class="video" />
            </td>
            <td>
              <video ref={remoteVideoRef} autoplay class="video" />
            </td>
          </tr>
          <tr>
            <td>
              <button onClick={getLocalStream}>publish</button>
            </td>
            <td>
              <button onClick={goConsume}>consume</button>
            </td>
          </tr>
        </tbody>
      </table>
      <For each={logging().split("\n")}>{(line) => <div>{line}</div>}</For>
    </div>
  );
};

export default VideoChat2;
