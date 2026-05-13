import { SFX } from './audio.js';
import { colorFor, hexStr } from './colors.js';

export class Lobby {
  constructor(net, onStart) {
    this.net = net;
    this.onStart = onStart;
    this.el = {
      lobby: document.getElementById('lobby'),
      home: document.getElementById('screen-home'),
      join: document.getElementById('screen-join'),
      room: document.getElementById('screen-room'),
      name: document.getElementById('input-name'),
      code: document.getElementById('input-code'),
      roomCode: document.getElementById('room-code'),
      listRed: document.getElementById('list-red'),
      listBlue: document.getElementById('list-blue'),
      btnStart: document.getElementById('btn-start'),
      status: document.getElementById('lobby-status'),
      myChip: document.getElementById('my-chip'),
    };
    this.bind();
  }

  bind() {
    document.getElementById('btn-create').onclick = () => this.create();
    document.getElementById('btn-join').onclick = () => this.show('join');
    document.getElementById('btn-back-1').onclick = () => this.show('home');
    document.getElementById('btn-confirm-join').onclick = () => this.join();
    document.querySelectorAll('.pick').forEach(b => {
      b.onclick = () => {
        SFX.hover();
        this.net.send('pickTeam', b.dataset.team);
      };
    });
    this.el.btnStart.onclick = () => this.net.send('startGame');

    this.net.on('state', (s) => this.render(s));
    this.net.on('message', (type, payload) => {
      if (type === 'started') this.handleStart();
    });
    this.net.on('error', (c, m) => this.status('error: ' + (m || c)));
    this.net.on('leave', () => this.status('disconnected'));
  }

  show(name) {
    ['home', 'join', 'room'].forEach(n => {
      this.el[n].classList.toggle('hidden', n !== name);
    });
  }

  status(text) { this.el.status.textContent = text; }

  async create() {
    const name = (this.el.name.value || '').trim() || 'anon';
    try {
      await this.net.createRoom(name);
      this.show('room');
    } catch (e) {
      this.status('create failed: ' + (e.message || e));
    }
  }

  async join() {
    const name = (this.el.name.value || '').trim() || 'anon';
    const code = (this.el.code.value || '').trim().toUpperCase();
    if (!code) return this.status('enter a code');
    try {
      await this.net.joinRoom(code, name);
      this.show('room');
    } catch (e) {
      this.status('join failed: ' + (e.message || e));
    }
  }

  render(state) {
    if (!state) return;
    this.el.roomCode.textContent = state.code || '';

    const myPlayer = state.players.get(this.net.sessionId);
    if (myPlayer) {
      const myColor = myPlayer.color || hexStr(colorFor(this.net.sessionId));
      this.el.myChip.innerHTML = `you are <span class="color-chip" style="background:${myColor}"></span>`;
    }

    const red = [], blue = [];
    let unassigned = 0;
    let me = null;
    state.players.forEach((p, id) => {
      const color = p.color || hexStr(colorFor(id));
      const swatch = `<span class="color-chip" style="background:${color}"></span>`;
      const youTag = id === this.net.sessionId ? ' <i>(you)</i>' : '';
      const star = p.host ? ' ★' : '';
      const line = `${swatch}${p.name || 'player'}${youTag}${star}`;
      if (p.team === 'red') red.push(line);
      else if (p.team === 'blue') blue.push(line);
      else unassigned++;
      if (id === this.net.sessionId) me = p;
    });

    this.el.listRed.innerHTML = red.map(l => `<li>${l}</li>`).join('');
    this.el.listBlue.innerHTML = blue.map(l => `<li>${l}</li>`).join('');

    const isHost = me && me.host;
    const canStart = red.length > 0 && blue.length > 0;
    this.el.btnStart.disabled = !(isHost && canStart);
    if (isHost) {
      this.el.btnStart.textContent = canStart ? 'Start game' : 'Need players on both teams';
    } else {
      this.el.btnStart.textContent = 'Waiting for host…';
    }

    if (unassigned > 0) this.status(`${unassigned} waiting to pick a team`);
    else this.status('');
  }

  handleStart() {
    SFX.start();
    this.el.lobby.style.display = 'none';
    document.getElementById('hud').hidden = false;
    this.onStart();
  }
}
