import os from 'os';

export default {
  domain: "192.168.1.109",
  peerTimeout: 15000,
  http: {
    port: 3000,
    tls: {
      cert: `${process.cwd()}/../.ssl/cert.pem`,
      key: `${process.cwd()}/../.ssl/key.pem`,
    },
  },
  mediasoup: {
    numWorkers: Object.keys(os.cpus()).length,
    workerSettings: {
      dtlsCertificateFile: `${process.cwd()}/../.ssl/cert.pem`,
      dtlsPrivateKeyFile: `${process.cwd()}/../.ssl/key.pem`,
      logLevel: "debug",
      logTags: [
        "info",
        "ice",
        "dtls",
        "rtp",
        "srtp",
        "rtcp",
        "rtx",
        "bwe",
        "score",
        "simulcast",
        "svc",
        "sctp",
      ],
    },
    routerOptions: {
      mediaCodecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90000,
          parameters: {
            "x-google-start-bitrate": 1000,
          },
        },
        {
          kind: "video",
          mimeType: "video/VP9",
          clockRate: 90000,
          parameters: {
            "profile-id": 2,
            "x-google-start-bitrate": 1000,
          },
        },
        {
          kind: "video",
          mimeType: "video/h264",
          clockRate: 90000,
          parameters: {
            "packetization-mode": 1,
            "profile-level-id": "4d0032",
            "level-asymmetry-allowed": 1,
            "x-google-start-bitrate": 1000,
          },
        },
        {
          kind: "video",
          mimeType: "video/h264",
          clockRate: 90000,
          parameters: {
            "packetization-mode": 1,
            "profile-level-id": "42e01f",
            "level-asymmetry-allowed": 1,
            "x-google-start-bitrate": 1000,
          },
        },
      ],
    },
    // NOTE: mediasoup-demo/server/lib/Room.js will increase this port for
    // each mediasoup Worker since each Worker is a separate process.
    webRtcServerOptions: {
      listenInfos: [
        {
          protocol: "udp",
          ip: "0.0.0.0",
          announcedAddress: null,
          port: 44444,
        },
        {
          protocol: "tcp",
          ip: "0.0.0.0",
          announcedAddress: null,
          port: 44444,
        },
      ],
    },
    webRtcTransportOptions: {
      // listenInfos is not needed since webRtcServer is used.
      // However passing MEDIASOUP_USE_WEBRTC_SERVER=false will change it.
      listenInfos: [
        {
          protocol: "udp",
          ip: "0.0.0.0",
          announcedAddress: null,
          portRange: {
            min: 40000,
            max: 49999,
          },
        },
        {
          protocol: "tcp",
          ip: "0.0.0.0",
          announcedAddress: null,
          portRange: {
            min: 40000,
            max: 49999,
          },
        },
      ],
      initialAvailableOutgoingBitrate: 1000000,
      minimumAvailableOutgoingBitrate: 600000,
      maxSctpMessageSize: 262144,
      maxIncomingBitrate: 1500000,
    },
    plainTransportOptions: {
      listenInfo: {
        protocol: "udp",
        ip: "0.0.0.0",
        announcedAddress: null,
        portRange: {
          min: 40000,
          max: 49999,
        },
      },
      maxSctpMessageSize: 262144,
    },
  },
};
