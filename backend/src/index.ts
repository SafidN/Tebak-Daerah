import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import { registerSocketHandlers } from './sockets';
import apiRoutes from './routes/api';

const app = new Hono();

// Middleware CORS
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}));

// Middleware Serve Static untuk folder Foto
app.use('/photos/*', serveStatic({ root: './public' }));

// Setup Routes API Hono
app.route('/api', apiRoutes);

app.get('/', (c) => c.text('🟢 Tebak Daerah Backend API & Socket is Live!'));

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const server = serve({
  fetch: app.fetch,
  port
});

// Setup Socket.io dengan HTTP Server yang sama
const io = new SocketIOServer(server as HTTPServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Register Event Handlers
registerSocketHandlers(io);

console.log(`🚀 Server berjalan di http://localhost:${port}`);
