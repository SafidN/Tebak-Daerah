import { Server, Socket } from 'socket.io';
import { handleRoomEvents } from './roomHandler';
import { handleGameEvents } from './gameHandler';

export const registerSocketHandlers = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log(`User connected: ${socket.id}`);
    
    handleRoomEvents(io, socket);
    handleGameEvents(io, socket);

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });
  });
};
