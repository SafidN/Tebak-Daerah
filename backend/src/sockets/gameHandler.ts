import { Server, Socket } from 'socket.io';
import { rooms } from '../store/memoryStore';

export const handleGameEvents = (io: Server, socket: Socket) => {
  // Logic dipindah ke roomHandler.ts untuk mencegah duplikasi
};
