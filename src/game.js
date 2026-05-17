import * as THREE from 'three';
import { LocalPlayer } from './player.js';
import { RemotePlayer } from './remote.js';
import { SFX } from './audio.js';
import { colorFor, colorFromStr, hexStr } from './colors.js';

const ROLE_NAME = { A: 'King', B: 'General', C: 'Spy', D: 'Horse' };
const ROLE_INFO = {
  A: 'kills General but dies to Spy',
  B: 'kills Spy but dies to King',
  C: 'kills King but dies to General',
  D: 'keeps stamina while carrying flag, but loses to any non-Horse role',
};
const TEAM_COLOR = { red: 0xff3030, blue: 0x3060ff };
const ARENA = 60;
const BLUE_BASE_Z = 46;
const RED_BASE_Z = -46;
const THROW_SPEED = 22;
const THROW_GRAVITY = 24;
const MAX_THROW_RANGE_SQ = 28 * 28;
const FLAG_FLIGHT_MS = 900;

export class Game {
  constructor(net) {
    this.net = net;
    this.remotes = new Map();
    this.obstacles = [];
    this.flags = {};
    this.lastSync = 0;
    this.attackCooldown = 0;
    this.respawnAt = 0;
    this.carrying = '';
  }

  start() {
    this.setupScene();
    this.buildArena();
    this.setupHUD();

    const me = this.net.state.players.get(this.net.sessionId);
    const team = me ? me.team : 'blue';
    const baseZ = team === 'blue' ? BLUE_BASE_Z : RED_BASE_Z;
    const spawn = new THREE.Vector3(
      (Math.random() - 0.5) * 8,
      1.7,
      baseZ + (Math.random() - 0.5) * 4,
    );
    const myColor = me && me.color ? colorFromStr(me.color) : colorFor(this.net.sessionId);

    this.player = new LocalPlayer(this.camera, document.body, this.obstacles, myColor);
    this.scene.add(this.camera);
    this.player.spawn(spawn);
    this.buildTrajectory();
    this.flagAnims = { red: null, blue: null };
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && this.player.alive && this.carrying && this.player.controls.isLocked) {
        this.throwFlag();
      }
      if (!this.player.alive) {
        if (e.code === 'ArrowLeft' || e.code === 'KeyQ') this.cycleSpectator(-1);
        if (e.code === 'ArrowRight' || e.code === 'KeyE') this.cycleSpectator(1);
      }
    });
    const lookAt = new THREE.Vector3(spawn.x, spawn.y, team === 'blue' ? spawn.z - 10 : spawn.z + 10);
    this.camera.lookAt(lookAt);

    if (me && me.role) {
      this.player.setRole(me.role);
      this.renderRoleInfo(me.role);
    } else {
      this.renderRoleInfo('');
    }

    this.bindNet();

    document.body.addEventListener('click', () => {
      if (this.player.alive) this.player.controls.lock();
    });
    addEventListener('resize', () => this.onResize());

    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 70, 220);

    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 600);

    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x404020, 0.85));
    const sun = new THREE.DirectionalLight(0xfff4d6, 0.95);
    sun.position.set(40, 80, 20);
    this.scene.add(sun);
  }

  buildArena() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
      new THREE.MeshLambertMaterial({ color: 0x4a7c3a }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const wallMat = new THREE.MeshLambertMaterial({ color: 0x555a66 });
    const addBox = (x, z, w, h, d, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, h / 2, z);
      this.scene.add(m);
      this.obstacles.push(new THREE.Box3().setFromObject(m));
      return m;
    };

    addBox(0, -ARENA, ARENA * 2, 6, 1, wallMat);
    addBox(0,  ARENA, ARENA * 2, 6, 1, wallMat);
    addBox(-ARENA, 0, 1, 6, ARENA * 2, wallMat);
    addBox( ARENA, 0, 1, 6, ARENA * 2, wallMat);

    this.makeBasePad(new THREE.Vector3(0, 0, BLUE_BASE_Z), TEAM_COLOR.blue);
    this.makeBasePad(new THREE.Vector3(0, 0, RED_BASE_Z), TEAM_COLOR.red);

    const crateMat = new THREE.MeshLambertMaterial({ color: 0x6b4f2a });
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x808591 });

    const layout = [
      [-15, -10, 4, 1.5, 4, crateMat],
      [ 15,  10, 4, 1.5, 4, crateMat],
      [-25,  20, 6, 1.5, 2, crateMat],
      [ 25, -20, 6, 1.5, 2, crateMat],
      [  0,   0, 3, 4.2, 3, stoneMat],
      [-30, -30, 5, 1.5, 5, crateMat],
      [ 30,  30, 5, 1.5, 5, crateMat],
      [ -8,  25, 2, 1.5, 2, crateMat],
      [  8, -25, 2, 1.5, 2, crateMat],
      [-22,  -2, 1, 4, 8, stoneMat],
      [ 22,   2, 1, 4, 8, stoneMat],
      [  0, -35, 10, 1.5, 1, crateMat],
      [  0,  35, 10, 1.5, 1, crateMat],
      [-12,  40, 3, 2.5, 3, stoneMat],
      [ 12, -40, 3, 2.5, 3, stoneMat],
    ];
    for (const [x, z, w, h, d, mat] of layout) addBox(x, z, w, h, d, mat);

    this.flags.red = this.makeFlag(TEAM_COLOR.red);
    this.flags.blue = this.makeFlag(TEAM_COLOR.blue);

    this.baseWalls = {
      blue: this.makeBaseWall(new THREE.Vector3(0, 0, BLUE_BASE_Z), 0x60a0ff),
      red: this.makeBaseWall(new THREE.Vector3(0, 0, RED_BASE_Z), 0xff6060),
    };
  }

  makeBaseWall(pos, color) {
    const geom = new THREE.CylinderGeometry(12, 12, 7, 64, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const wall = new THREE.Mesh(geom, mat);
    wall.position.copy(pos);
    wall.position.y = 3.5;
    wall.visible = false;
    this.scene.add(wall);
    return wall;
  }

  makeBasePad(pos, color) {
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(12, 12, 0.25, 32),
      new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.5 }),
    );
    pad.position.copy(pos);
    pad.position.y = 0.13;
    this.scene.add(pad);
  }

  makeFlag(color) {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 2.4, 0.1),
      new THREE.MeshLambertMaterial({ color: 0x666666 }),
    );
    pole.position.y = 1.2;
    const cloth = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.6, 0.05),
      new THREE.MeshLambertMaterial({ color }),
    );
    cloth.position.set(0.55, 2.0, 0);
    group.add(pole);
    group.add(cloth);
    this.scene.add(group);
    return group;
  }

  buildTrajectory() {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(300), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffe040, transparent: true, opacity: 0.8 });
    this.trajectoryLine = new THREE.Line(geom, mat);
    this.trajectoryLine.frustumCulled = false;
    this.trajectoryLine.visible = false;
    this.scene.add(this.trajectoryLine);

    const markGeom = new THREE.SphereGeometry(0.25, 12, 8);
    const markMat = new THREE.MeshBasicMaterial({ color: 0xffe040, transparent: true, opacity: 0.5 });
    this.trajectoryMark = new THREE.Mesh(markGeom, markMat);
    this.trajectoryMark.visible = false;
    this.scene.add(this.trajectoryMark);
  }

  simulateTrajectory() {
    const start = this.player.position.clone();
    start.y -= 0.4;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const v = dir.clone().multiplyScalar(THROW_SPEED);
    const p = start.clone();
    const points = [p.clone()];
    const dt = 0.04;
    for (let i = 0; i < 80; i++) {
      p.x += v.x * dt;
      p.y += v.y * dt;
      p.z += v.z * dt;
      v.y -= THROW_GRAVITY * dt;
      if (p.y <= 0.35) {
        p.y = 0.35;
        points.push(p.clone());
        break;
      }
      points.push(p.clone());
    }
    return points;
  }

  enterSpectator() {
    this.spectatedId = null;
    this.cycleSpectator(1);
    this.spectatorInfo.classList.remove('hidden');
    this.deathScreen.classList.add('hidden');
    this.carryHint.classList.add('hidden');
    this.trajectoryLine.visible = false;
    this.trajectoryMark.visible = false;
  }

  cycleSpectator(dir) {
    const me = this.net.state.players.get(this.net.sessionId);
    if (!me) return;
    const teammates = [];
    this.net.state.players.forEach((p, id) => {
      if (id === this.net.sessionId) return;
      if (p.team !== me.team) return;
      if (!p.alive) return;
      teammates.push(id);
    });
    if (teammates.length === 0) {
      this.spectatedId = null;
      this.spectatorInfo.textContent = 'No teammates alive — round is over for you.';
      return;
    }
    let idx = this.spectatedId ? teammates.indexOf(this.spectatedId) : -1;
    if (idx === -1) idx = 0;
    else idx = (idx + dir + teammates.length) % teammates.length;
    this.spectatedId = teammates[idx];
    const t = this.net.state.players.get(this.spectatedId);
    const color = t && t.color ? t.color : '#ffffff';
    this.spectatorInfo.innerHTML = `Spectating <span class="color-chip" style="background:${color}"></span> · Q/E or ←/→ to switch`;
  }

  updateSpectatorCamera() {
    if (!this.spectatedId) return;
    const target = this.remotes.get(this.spectatedId);
    if (!target) return;
    const yaw = target.group.rotation.y;
    const dist = 4.5;
    const height = 2.3;
    this.camera.position.x = target.group.position.x + Math.sin(yaw) * dist;
    this.camera.position.y = target.group.position.y + height;
    this.camera.position.z = target.group.position.z + Math.cos(yaw) * dist;
    this.camera.lookAt(
      target.group.position.x,
      target.group.position.y + 1.5,
      target.group.position.z,
    );
  }

  throwFlag() {
    const points = this.simulateTrajectory();
    const target = points[points.length - 1];
    const dx = target.x - this.player.position.x;
    const dz = target.z - this.player.position.z;
    if (dx * dx + dz * dz > MAX_THROW_RANGE_SQ) return;
    this.net.send('throwFlag', { x: target.x, y: target.y, z: target.z });
  }

  setupHUD() {
    this.scoreBlue = document.getElementById('score-blue');
    this.scoreRed = document.getElementById('score-red');
    this.roleInfo = document.getElementById('role-info');
    this.staminaFill = document.getElementById('stamina-fill');
    this.deathScreen = document.getElementById('death-screen');
    this.respawnCount = document.getElementById('respawn-count');
    this.eventLog = document.getElementById('event-log');
    this.carryHint = document.getElementById('carry-hint');
    this.campWarning = document.getElementById('camp-warning');
    this.lockdownInfo = document.getElementById('lockdown-info');
    this.spectatorInfo = document.getElementById('spectator-info');
    this.spectatedId = null;
  }

  bindNet() {
    const room = this.net.room;

    room.state.players.onAdd((p, id) => {
      this.upsertRemote(id, p);
      p.onChange(() => this.upsertRemote(id, p));
    });
    room.state.players.onRemove((p, id) => {
      const r = this.remotes.get(id);
      if (r) { r.dispose(); this.remotes.delete(id); }
    });

    room.state.listen('blueScore', (v) => { this.scoreBlue.textContent = `Blue ${v}`; });
    room.state.listen('redScore', (v) => { this.scoreRed.textContent = `Red ${v}`; });

    this.net.on('message', (type, payload) => this.onServerMessage(type, payload));
  }

  upsertRemote(id, p) {
    if (id === this.net.sessionId) {
      if (p.role && this.player.role !== p.role) {
        this.player.setRole(p.role);
        this.renderRoleInfo(p.role);
      }
      if (!p.alive && this.player.alive) {
        this.player.die();
        this.player.controls.unlock();
      }
      if (p.alive && !this.player.alive) {
        this.player.spawn(new THREE.Vector3(p.x, 1.7, p.z));
        this.deathScreen.classList.add('hidden');
        this.spectatorInfo.classList.add('hidden');
        this.spectatedId = null;
      }
      if (p.carrying !== this.carrying) {
        const had = this.carrying;
        this.carrying = p.carrying;
        if (p.carrying && !had) {
          this.carryHint.innerHTML = `You took the ${p.carrying} flag — return to base · press <b>F</b> to throw`;
          this.carryHint.classList.remove('hidden');
          SFX.reveal();
        } else if (!p.carrying) {
          this.carryHint.classList.add('hidden');
        }
      }
      return;
    }
    let r = this.remotes.get(id);
    if (!r) {
      r = new RemotePlayer(id, this.scene);
      this.remotes.set(id, r);
    }
    r.setName(p.name);
    r.setTeam(p.team);
    r.setColor(p.color);
    r.setRevealed(p.revealed, p.role);
    r.setAlive(p.alive);
    r.setState({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, crouching: p.crouching });
  }

  onServerMessage(type, payload) {
    if (type === 'youKilled') {
      SFX.reveal();
      this.logEvent(`You killed them — they were ${ROLE_NAME[payload.victimRole] || payload.victimRole}`, 'reveal');
    } else if (type === 'youWereKilled') {
      SFX.die();
      this.logEvent(`You were killed — they were ${ROLE_NAME[payload.killerRole] || payload.killerRole}`, 'reveal');
      this.enterSpectator();
    } else if (type === 'campedOut') {
      SFX.die();
      this.logEvent('You camped your base — kicked out', 'kill');
      this.deathScreen.classList.remove('hidden');
      this.respawnAt = performance.now() + 2000;
    } else if (type === 'flag') {
      if (payload.event === 'captured') {
        SFX.start();
      } else if (payload.event === 'thrown') {
        this.flagAnims[payload.team] = {
          from: payload.from,
          to: payload.to,
          start: performance.now(),
          duration: FLAG_FLIGHT_MS,
        };
        SFX.jump();
      }
    }
  }

  renderRoleInfo(role) {
    if (!role) {
      this.roleInfo.textContent = '';
      return;
    }
    const name = ROLE_NAME[role] || role;
    this.roleInfo.textContent = `You are a ${name} — ${ROLE_INFO[role]}`;
  }

  logEvent(text, cls = '') {
    const el = document.createElement('div');
    el.className = 'event ' + cls;
    el.textContent = text;
    this.eventLog.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.5s';
      setTimeout(() => el.remove(), 500);
    }, 3500);
  }

  updateFlags() {
    const now = performance.now();
    for (const team of ['red', 'blue']) {
      const flagState = team === 'red' ? this.net.state.redFlag : this.net.state.blueFlag;
      const flagMesh = this.flags[team];
      if (!flagState || !flagMesh) continue;

      const anim = this.flagAnims[team];
      if (anim) {
        const t = (now - anim.start) / anim.duration;
        if (t >= 1) {
          this.flagAnims[team] = null;
          flagMesh.position.set(anim.to.x, anim.to.y, anim.to.z);
        } else {
          const arc = 5;
          const x = anim.from.x + (anim.to.x - anim.from.x) * t;
          const z = anim.from.z + (anim.to.z - anim.from.z) * t;
          const y = anim.from.y + (anim.to.y - anim.from.y) * t + arc * 4 * t * (1 - t);
          flagMesh.position.set(x, y, z);
          flagMesh.rotation.y += 0.18;
          continue;
        }
      } else if (flagState.carrier) {
        if (flagState.carrier === this.net.sessionId) {
          flagMesh.position.set(this.player.position.x, 0.5, this.player.position.z);
        } else {
          const r = this.remotes.get(flagState.carrier);
          if (r) {
            flagMesh.position.set(r.group.position.x, 0.5, r.group.position.z);
          } else {
            flagMesh.position.set(flagState.x, flagState.y, flagState.z);
          }
        }
      } else {
        flagMesh.position.set(flagState.x, flagState.y, flagState.z);
      }
      flagMesh.rotation.y += 0.01;
    }
  }

  updateTrajectory() {
    if (!this.carrying || !this.player.alive || !this.player.controls.isLocked) {
      this.trajectoryLine.visible = false;
      this.trajectoryMark.visible = false;
      return;
    }
    const points = this.simulateTrajectory();
    if (points.length < 2) {
      this.trajectoryLine.visible = false;
      this.trajectoryMark.visible = false;
      return;
    }
    const target = points[points.length - 1];
    const dx = target.x - this.player.position.x;
    const dz = target.z - this.player.position.z;
    const inRange = dx * dx + dz * dz <= MAX_THROW_RANGE_SQ;

    const positions = this.trajectoryLine.geometry.attributes.position.array;
    const count = Math.min(points.length, 100);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = points[i].x;
      positions[i * 3 + 1] = points[i].y;
      positions[i * 3 + 2] = points[i].z;
    }
    this.trajectoryLine.geometry.setDrawRange(0, count);
    this.trajectoryLine.geometry.attributes.position.needsUpdate = true;
    this.trajectoryLine.material.color.setHex(inRange ? 0xffe040 : 0xff4040);
    this.trajectoryLine.visible = true;

    this.trajectoryMark.position.copy(target);
    this.trajectoryMark.material.color.setHex(inRange ? 0xffe040 : 0xff4040);
    this.trajectoryMark.visible = true;
  }

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    this.player.flagCarrierExhausted = !!(this.carrying && this.player.role !== 'D');
    this.player.update(dt);
    for (const r of this.remotes.values()) r.update(dt);

    if (!this.player.alive && this.spectatedId) {
      const spec = this.net.state.players.get(this.spectatedId);
      if (!spec || !spec.alive) this.cycleSpectator(1);
      this.updateSpectatorCamera();
    }

    this.updateFlags();
    this.updateTrajectory();

    this.attackCooldown -= dt;
    if (this.player.alive && this.attackCooldown <= 0) {
      const pp = this.player.position;
      for (const [id, r] of this.remotes) {
        if (!r.group.visible) continue;
        const rp = r.group.position;
        const dx = pp.x - rp.x;
        const dz = pp.z - rp.z;
        if (dx * dx + dz * dz < 1.5 * 1.5) {
          this.net.send('attack', id);
          this.attackCooldown = 0.5;
          break;
        }
      }
    }

    this.lastSync += dt;
    if (this.lastSync > 0.05) {
      this.lastSync = 0;
      if (this.player.alive) this.net.send('move', this.player.getNetState());
    }

    if (!this.player.alive && this.respawnAt > 0) {
      const remain = Math.max(0, Math.ceil((this.respawnAt - performance.now()) / 1000));
      this.respawnCount.textContent = remain;
    }

    this.staminaFill.style.width = `${this.player.stamina}%`;

    this.updatePhaseUI();

    this.renderer.render(this.scene, this.camera);
  }

  updatePhaseUI() {
    const me = this.net.state.players.get(this.net.sessionId);
    if (!me) {
      this.lockdownInfo.classList.add('hidden');
      this.campWarning.classList.add('hidden');
      this.player.lockdown = null;
      return;
    }
    const startedAt = this.net.state.playStartedAt || 0;
    const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
    const lockdownLeft = Math.max(0, 30 - elapsed);
    const inLockdown = lockdownLeft > 0;

    if (inLockdown) {
      const baseZ = me.team === 'blue' ? BLUE_BASE_Z : RED_BASE_Z;
      this.player.lockdown = {
        cx: 0,
        cz: baseZ,
        maxDistSq: 144 - 4,
      };
      this.lockdownInfo.innerHTML = `Stay in base · combat opens in <b>${Math.ceil(lockdownLeft)}</b>s`;
      this.lockdownInfo.classList.remove('hidden');
      this.campWarning.classList.add('hidden');
    } else {
      this.player.lockdown = null;
      this.lockdownInfo.classList.add('hidden');
      if (this.player.alive && me.campTime > 1.5) {
        const remaining = Math.max(0, Math.ceil(5 - me.campTime));
        this.campWarning.textContent = `Leave your base — ${remaining}s`;
        this.campWarning.classList.remove('hidden');
      } else {
        this.campWarning.classList.add('hidden');
      }
    }

    if (this.baseWalls) {
      const pulse = 0.25 + 0.12 * Math.sin(performance.now() * 0.004);
      this.baseWalls.blue.visible = inLockdown;
      this.baseWalls.red.visible = inLockdown;
      if (inLockdown) {
        this.baseWalls.blue.material.opacity = pulse;
        this.baseWalls.red.material.opacity = pulse;
      }
    }
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
}
