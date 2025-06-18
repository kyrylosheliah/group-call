import { types } from "mediasoup";
import { Socket } from "socket.io";

export interface IRooms {
  [roomName: string]: IRoom;
}

export interface IRoom {
  router: types.Router;
  peers: Array<string>;
}

export interface IPeers {
  [socketId: string]: IPeer;
}

export interface IPeer {
  socket: Socket;
  roomName: string;
  //transports: [];
  //producers: [];
  //consumers: [];
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
