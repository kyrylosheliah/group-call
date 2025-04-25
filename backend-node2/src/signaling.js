import { handleSFUConnection } from './sfuHandler';

const {
  getOrCreateRoom,
  addUserToRoom,
  removeUserFromRoom
} = require('./roomManager');

export default function setupSignaling(io) {
  io.on('connection', (socket) => {
    console.log('user connected: ', socket.id);
    socket.on('join-room', ({ roomId, preferredType }) => {
      const type = preferredType === 'server' ? 'server' : 'p2p';
      //const room = getOrCreateRoom(roomId, type);
      //addUserToRoom(roomId, socket.id);
      socket.join(roomId);
      socket.emit('room-type', { type });
      // Notify others
      if (type === 'server') {
        handleSFUConnection(socket, io);
        socket.emit('log', 'SFU connection initialized');
      } else {
        socket.to(roomId).emit('user-joined', { id: socket.id });
      }
    });
    socket.on('signal', ({ to, data }) => {
      socket.to(to).emit('signal', { from: socket.id, data });
    });
    socket.on('disconnecting', () => {
      for (const roomId of socket.rooms) {
        //removeUserFromRoom(roomId, socket.id);
        socket.to(roomId).emit('user-left', { id: socket.id });
      }
    });
  });
}