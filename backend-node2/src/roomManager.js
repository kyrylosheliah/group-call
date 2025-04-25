const rooms = new Map();

function getOrCreateRoom(id, type = 'p2p') {
  if (!rooms.has(id)) {
    rooms.set(id, { type, users: new Set() });
  }
  return rooms.get(id);
}

function addUserToRoom(roomId, userId) {
  const room = getOrCreateRoom(roomId);
  room.users.add(userId);
  return room;
}

function removeUserFromRoom(roomId, userId) {
  const room = getOrCreateRoom(roomId);
  if (room) {
    room.users.delete(userId);
    if (room.users.size === 0) {
      rooms.delete(roomId);
    }
  }
  return room;
}

export default {
  getOrCreateRoom,
  addUserToRoom,
  removeUserFromRoom,
};