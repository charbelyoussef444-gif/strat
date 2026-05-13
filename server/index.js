import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import express from 'express';
import colyseus from 'colyseus';
import wsTransport from '@colyseus/ws-transport';
import { GameRoom } from './GameRoom.js';

const { Server } = colyseus;
const { WebSocketTransport } = wsTransport;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 2567;
const distPath = path.join(__dirname, '..', 'dist');

const app = express();

app.use((req, res, next) => {
  if (req.path.startsWith('/matchmake')) return;
  next();
});

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res) => res.sendFile(path.join(distPath, 'index.html')));
  console.log(`[server] serving static from ${distPath}`);
} else {
  console.log('[server] no dist/ — dev mode, run vite separately');
}

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('game', GameRoom).filterBy(['code']);

gameServer.listen(port).then(() => {
  console.log(`[server] listening on port ${port}`);
});
