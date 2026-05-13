import colyseus from 'colyseus';
import { Schema, MapSchema, defineTypes } from '@colyseus/schema';

const { Room } = colyseus;

class Player extends Schema {
  constructor() {
    super();
    this.name = '';
    this.team = '';
    this.role = '';
    this.color = '';
    this.revealed = false;
    this.alive = true;
    this.host = false;
    this.carrying = '';
    this.campTime = 0;
    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0; this.pitch = 0;
    this.crouching = false;
    this.sprinting = false;
  }
}
defineTypes(Player, {
  name: 'string',
  team: 'string',
  role: 'string',
  color: 'string',
  revealed: 'boolean',
  alive: 'boolean',
  host: 'boolean',
  carrying: 'string',
  campTime: 'number',
  x: 'number', y: 'number', z: 'number',
  yaw: 'number', pitch: 'number',
  crouching: 'boolean',
  sprinting: 'boolean',
});

class Flag extends Schema {
  constructor() {
    super();
    this.team = '';
    this.x = 0; this.y = 0; this.z = 0;
    this.carrier = '';
  }
}
defineTypes(Flag, {
  team: 'string',
  x: 'number', y: 'number', z: 'number',
  carrier: 'string',
});

class State extends Schema {
  constructor() {
    super();
    this.phase = 'lobby';
    this.players = new MapSchema();
    this.redScore = 0;
    this.blueScore = 0;
    this.code = '';
    this.playStartedAt = 0;
    this.redFlag = new Flag();
    this.redFlag.team = 'red';
    this.blueFlag = new Flag();
    this.blueFlag.team = 'blue';
  }
}
defineTypes(State, {
  phase: 'string',
  players: { map: Player },
  redScore: 'number',
  blueScore: 'number',
  code: 'string',
  playStartedAt: 'number',
  redFlag: Flag,
  blueFlag: Flag,
});

const BEATS = { A: 'B', B: 'C', C: 'A' };
const ROLES = ['A', 'B', 'C'];
const BLUE_BASE_Z = 46;
const RED_BASE_Z = -46;
const PICKUP_DIST_SQ = 4;
const CAPTURE_DIST_SQ = 144;
const FLAG_RETURN_MS = 5000;
const COMBAT_DIST_SQ = 6;
const MAX_THROW_DIST_SQ = 32 * 32;
const LOCKDOWN_MS = 30000;
const OPEN_GRACE = 5;

const COLOR_PALETTE = [
  '#ff4040', '#4080ff', '#ff9020', '#40c040',
  '#b060ff', '#ffd040', '#40d0d0', '#ff80c0',
  '#ffffff', '#909090', '#ffd060', '#60ff60',
  '#ff60ff', '#00bfff', '#ff4080', '#a05040',
];

export class GameRoom extends Room {
  maxClients = 16;

  onCreate(options) {
    this.setState(new State());
    this.state.code = options && options.code ? String(options.code).toUpperCase() : '';
    this.setMetadata({ code: this.state.code });
    this.autoDispose = true;

    this.flagDroppedAt = { red: 0, blue: 0 };
    this.usedColors = new Set();

    this.onMessage('pickTeam', (client, team) => {
      if (this.state.phase !== 'lobby') return;
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      if (team !== 'red' && team !== 'blue') return;
      p.team = team;
    });

    this.onMessage('startGame', (client) => {
      if (this.state.phase !== 'lobby') return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.host) return;
      this.startGame();
    });

    this.onMessage('move', (client, data) => {
      if (this.state.phase !== 'playing') return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || !data) return;
      if (typeof data.x === 'number') p.x = data.x;
      if (typeof data.y === 'number') p.y = data.y;
      if (typeof data.z === 'number') p.z = data.z;
      if (typeof data.yaw === 'number') p.yaw = data.yaw;
      if (typeof data.pitch === 'number') p.pitch = data.pitch;
      if (typeof data.crouching === 'boolean') p.crouching = data.crouching;
      if (typeof data.sprinting === 'boolean') p.sprinting = data.sprinting;
    });

    this.onMessage('throwFlag', (client, data) => {
      if (this.state.phase !== 'playing') return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || !p.carrying || !data) return;
      const dx = data.x - p.x;
      const dz = data.z - p.z;
      if (dx * dx + dz * dz > MAX_THROW_DIST_SQ) return;
      const team = p.carrying;
      const flag = team === 'red' ? this.state.redFlag : this.state.blueFlag;
      const from = { x: flag.x, y: flag.y, z: flag.z };
      flag.x = data.x;
      flag.y = Math.max(0.5, data.y || 0.5);
      flag.z = data.z;
      flag.carrier = '';
      p.carrying = '';
      this.flagDroppedAt[team] = Date.now();
      this.broadcast('flag', {
        event: 'thrown',
        team,
        by: client.sessionId,
        from,
        to: { x: flag.x, y: flag.y, z: flag.z },
      });
    });

    this.onMessage('attack', (client, targetId) => {
      if (this.state.phase !== 'playing') return;
      const attacker = this.state.players.get(client.sessionId);
      const victim = this.state.players.get(targetId);
      if (!attacker || !victim) return;
      if (!attacker.alive || !victim.alive) return;
      if (attacker.team === victim.team) return;
      const dx = attacker.x - victim.x;
      const dz = attacker.z - victim.z;
      if (dx * dx + dz * dz > COMBAT_DIST_SQ) return;
      this.resolveCombat(attacker, victim, client.sessionId, targetId);
    });

    this.setSimulationInterval(() => this.simulate(), 100);
  }

  onJoin(client, options) {
    if (this.state.phase !== 'lobby') {
      throw new Error('game in progress');
    }
    const p = new Player();
    p.name = String((options && options.name) || 'anon').slice(0, 14);
    p.host = this.state.players.size === 0;
    p.color = this.assignColor();
    this.state.players.set(client.sessionId, p);
  }

  onLeave(client) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    if (p.carrying) this.dropFlag(p.carrying, p.x, p.z);
    if (p.color) this.usedColors.delete(p.color);
    const wasHost = p.host;
    this.state.players.delete(client.sessionId);
    if (wasHost) {
      const first = this.state.players.values().next().value;
      if (first) first.host = true;
    }
  }

  assignColor() {
    for (const c of COLOR_PALETTE) {
      if (!this.usedColors.has(c)) {
        this.usedColors.add(c);
        return c;
      }
    }
    return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
  }

  startGame() {
    const byTeam = { red: [], blue: [] };
    this.state.players.forEach((p) => {
      if (p.team === 'red' || p.team === 'blue') byTeam[p.team].push(p);
    });
    for (const team of ['red', 'blue']) {
      const list = byTeam[team];
      const pool = [];
      while (pool.length < list.length) pool.push(...ROLES);
      shuffle(pool);
      list.forEach((p, i) => {
        p.role = pool[i];
        p.revealed = false;
        p.alive = true;
        p.carrying = '';
      });
    }
    this.state.players.forEach((p) => this.placeSpawn(p));
    this.returnFlag('red');
    this.returnFlag('blue');
    this.state.redScore = 0;
    this.state.blueScore = 0;
    this.state.playStartedAt = Date.now();
    this.state.phase = 'playing';
    this.broadcast('started', {});
  }

  placeSpawn(p) {
    const baseZ = p.team === 'blue' ? BLUE_BASE_Z : RED_BASE_Z;
    p.x = (Math.random() - 0.5) * 8;
    p.y = 1.7;
    p.z = baseZ + (Math.random() - 0.5) * 4;
    p.yaw = p.team === 'blue' ? Math.PI : 0;
    p.campTime = 0;
  }

  resetRound() {
    this.returnFlag('red');
    this.returnFlag('blue');
    this.state.playStartedAt = Date.now();

    this.state.players.forEach((player) => {
      if (player.team !== 'red' && player.team !== 'blue') return;
      player.alive = true;
      player.revealed = false;
      player.carrying = '';
      this.placeSpawn(player);
    });

    this.broadcast('roundReset', {});
  }

  returnFlag(team) {
    const f = team === 'red' ? this.state.redFlag : this.state.blueFlag;
    f.carrier = '';
    f.x = 0;
    f.y = 0.5;
    f.z = team === 'red' ? RED_BASE_Z : BLUE_BASE_Z;
    this.flagDroppedAt[team] = 0;
  }

  dropFlag(team, x, z) {
    const f = team === 'red' ? this.state.redFlag : this.state.blueFlag;
    f.carrier = '';
    f.x = x;
    f.y = 0.5;
    f.z = z;
    this.flagDroppedAt[team] = Date.now();
  }

  resolveCombat(attacker, victim, attackerId, victimId) {
    let killerId, deadId;
    if (attacker.role === victim.role) {
      killerId = attackerId; deadId = victimId;
    } else if (BEATS[attacker.role] === victim.role) {
      killerId = attackerId; deadId = victimId;
    } else if (BEATS[victim.role] === attacker.role) {
      killerId = victimId; deadId = attackerId;
    } else {
      return;
    }

    const killer = this.state.players.get(killerId);
    const dead = this.state.players.get(deadId);
    if (!killer || !dead) return;

    if (dead.carrying) {
      this.dropFlag(dead.carrying, dead.x, dead.z);
      dead.carrying = '';
    }

    dead.alive = false;
    killer.revealed = true;

    const victimClient = this.clients.find((c) => c.sessionId === deadId);
    if (victimClient) victimClient.send('youWereKilled', { killerRole: killer.role });
    const killerClient = this.clients.find((c) => c.sessionId === killerId);
    if (killerClient) killerClient.send('youKilled', { victimRole: dead.role });
  }

  simulate() {
    if (this.state.phase !== 'playing') return;
    const now = Date.now();

    for (const team of ['red', 'blue']) {
      const f = team === 'red' ? this.state.redFlag : this.state.blueFlag;
      if (f.carrier) {
        const c = this.state.players.get(f.carrier);
        if (c && c.alive) {
          f.x = c.x;
          f.y = 1.0;
          f.z = c.z;
        } else {
          this.dropFlag(team, f.x, f.z);
        }
      }
    }

    this.state.players.forEach((p, id) => {
      if (!p.alive || p.carrying) return;
      for (const team of ['red', 'blue']) {
        const flag = team === 'red' ? this.state.redFlag : this.state.blueFlag;
        if (flag.carrier) continue;
        if (team === p.team && !this.flagDroppedAt[team]) continue;
        const dx = p.x - flag.x;
        const dz = p.z - flag.z;
        if (dx * dx + dz * dz < PICKUP_DIST_SQ) {
          flag.carrier = id;
          p.carrying = team;
          this.flagDroppedAt[team] = 0;
          this.broadcast('flag', { event: 'pickup', team, by: id });
          break;
        }
      }
    });

    const elapsed = (Date.now() - this.state.playStartedAt) / 1000;
    const inLockdown = elapsed < LOCKDOWN_MS / 1000;

    this.state.players.forEach((p, id) => {
      if (!p.alive) {
        p.campTime = 0;
        return;
      }
      const ownBaseZ = p.team === 'red' ? RED_BASE_Z : BLUE_BASE_Z;
      const dx = p.x;
      const dz = p.z - ownBaseZ;
      const distSq = dx * dx + dz * dz;
      const inOwnBase = distSq < CAPTURE_DIST_SQ;

      // Lockdown phase: clamp anyone who got out of their own base
      if (inLockdown && !inOwnBase) {
        const dist = Math.sqrt(distSq) || 0.01;
        const max = Math.sqrt(CAPTURE_DIST_SQ) - 0.5;
        p.x = dx * (max / dist);
        p.z = ownBaseZ + dz * (max / dist);
      }

      // Drop-off (return / capture) — only fires when actually inside the circle
      const inBaseNow = (p.x * p.x + (p.z - ownBaseZ) * (p.z - ownBaseZ)) < CAPTURE_DIST_SQ;
      if (p.carrying && inBaseNow && !inLockdown) {
        const carriedTeam = p.carrying;
        p.carrying = '';
        if (carriedTeam === p.team) {
          this.returnFlag(carriedTeam);
          this.broadcast('flag', { event: 'returned', team: carriedTeam, by: id });
        } else {
          if (p.team === 'red') this.state.redScore++;
          else this.state.blueScore++;
          this.returnFlag(carriedTeam);
          this.broadcast('flag', { event: 'captured', team: p.team, by: id });
          this.resetRound();
          return;
        }
      }

      // Open-phase anti-camp: grace period, then kill
      if (!inLockdown && inBaseNow) {
        p.campTime = (p.campTime || 0) + 0.1;
        if (p.campTime >= OPEN_GRACE) {
          if (p.carrying) {
            this.dropFlag(p.carrying, p.x, p.z);
            p.carrying = '';
          }
          p.alive = false;
          p.campTime = 0;
          const cl = this.clients.find((c) => c.sessionId === id);
          if (cl) cl.send('campedOut', {});
          this.clock.setTimeout(() => {
            if (!this.state.players.has(id)) return;
            const v = this.state.players.get(id);
            v.alive = true;
            this.placeSpawn(v);
          }, 2000);
        }
      } else {
        p.campTime = 0;
      }
    });
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
