import { Client } from 'colyseus.js';

const isDev = location.port === '5173';
const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ENDPOINT = isDev
  ? `ws://${location.hostname}:2567`
  : `${proto}//${location.host}`;

export class Net {
  constructor() {
    this.client = new Client(ENDPOINT);
    this.room = null;
    this.listeners = {
      state: [],
      message: [],
      error: [],
      leave: [],
    };
  }

  on(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  emit(event, ...args) {
    const list = this.listeners[event] || [];
    for (const fn of list) fn(...args);
  }

  async createRoom(name) {
    const code = randomCode();
    this.room = await this.client.create('game', { name, code });
    this.attach();
    return this.room;
  }

  async joinRoom(code, name) {
    this.room = await this.client.join('game', { name, code: code.toUpperCase() });
    this.attach();
    return this.room;
  }

  attach() {
    this.room.onStateChange((s) => this.emit('state', s));
    this.room.onMessage('*', (type, payload) => this.emit('message', type, payload));
    this.room.onError((c, m) => this.emit('error', c, m));
    this.room.onLeave(() => this.emit('leave'));
  }

  send(type, payload) {
    if (this.room) this.room.send(type, payload);
  }

  get sessionId() { return this.room ? this.room.sessionId : null; }
  get state() { return this.room ? this.room.state : null; }
}

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
