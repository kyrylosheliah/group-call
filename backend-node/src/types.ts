import { types } from "mediasoup";
import { Socket } from "socket.io";

export interface IRooms {
  [roomName: string]: IRoom;
}

export interface IMessage {
  senderName: string;
  message: string;
  timestamp: number;
}

export interface IPendingUpload {
  roomName: string,
  uploaderName: string,
  location: string,
  rename: string,
  expiresAt: number,
}

export interface IPendingUploads {
  [id: string]: IPendingUpload;
}

export interface IRoom {
  router: types.Router;
  peers: Array<string>;
  messages: Array<IMessage>;
}

export interface IPeers {
  [socketId: string]: IPeer;
}

export interface IPeer {
  socket: Socket;
  roomName: string;
  userName: string;
  transports: string[];
  producers: string[];
  consumers: string[];
  peerDetails: {
    name: string;
    isAdmin: boolean;
  };
}

export interface ITransport {
  socketId: string;
  transport: types.Transport;
  roomName: string;
  consumer: types.Consumer;
}

export interface IProducer {
  socketId: string,
  producer: types.Producer,
  roomName: string,
}

export interface IConsumer {
  socketId: string,
  consumer: types.Consumer,
  roomName: string,
}
