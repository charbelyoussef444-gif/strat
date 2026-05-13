import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { SFX } from './audio.js';

const SPEED_WALK = 5;
const SPEED_SPRINT = 9;
const SPEED_CROUCH = 2.5;
const JUMP_VEL = 9;
const GRAVITY = 24;
const STAND_HEIGHT = 1.7;
const CROUCH_HEIGHT = 1.0;
const STAMINA_MAX = 100;
const STAMINA_DRAIN = 26;
const STAMINA_REGEN = 18;
const SPRINT_MIN = 15;
const PLAYER_RADIUS = 0.4;

export class LocalPlayer {
  constructor(camera, dom, obstacles, color) {
    this.camera = camera;
    this.color = color || 0x888888;
    this.dom = dom;
    this.obstacles = obstacles;
    this.controls = new PointerLockControls(camera, dom);
    this.controls.maxPolarAngle = Math.PI - 0.08;
    this.controls.minPolarAngle = 0.08;
    this.velocity = new THREE.Vector3();
    this.keys = {};
    this.height = STAND_HEIGHT;
    this.crouching = false;
    this.sprinting = false;
    this.sprintLocked = false;
    this.onGround = true;
    this.stamina = STAMINA_MAX;
    this.alive = true;
    this.role = null;
    this.stepTimer = 0;
    this._yawEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.lockdown = null;

    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space' && this.onGround && this.alive && this.controls.isLocked) {
        this.jump();
      }
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    this.viewmodel = new ViewModel(this.camera, this.color);
  }

  spawn(pos) {
    this.camera.position.copy(pos);
    this.camera.position.y = STAND_HEIGHT;
    this.height = STAND_HEIGHT;
    this.velocity.set(0, 0, 0);
    this.alive = true;
    this.stamina = STAMINA_MAX;
    this.crouching = false;
    this.sprintLocked = false;
  }

  jump() {
    this.velocity.y = JUMP_VEL;
    this.onGround = false;
    SFX.jump();
  }

  setRole(role) { this.role = role; }

  die() {
    this.alive = false;
    SFX.die();
  }

  update(dt) {
    if (!this.alive) {
      this.viewmodel.group.visible = false;
      return;
    }
    this.viewmodel.group.visible = true;
    if (!this.controls.isLocked) return;

    let mx = 0, mz = 0;
    if (this.keys['KeyW']) mz -= 1;
    if (this.keys['KeyS']) mz += 1;
    if (this.keys['KeyA']) mx -= 1;
    if (this.keys['KeyD']) mx += 1;
    const moving = mx !== 0 || mz !== 0;
    if (moving) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
    }

    const wantCrouch = !!(this.keys['ControlLeft'] || this.keys['KeyC']);
    if (wantCrouch !== this.crouching) {
      this.crouching = wantCrouch;
      this.height = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;
    }

    if (!this.keys['ShiftLeft']) this.sprintLocked = false;
    const wantSprint = !!this.keys['ShiftLeft'] && moving && !this.crouching && !this.sprintLocked;
    if (wantSprint && (this.sprinting || this.stamina > SPRINT_MIN)) {
      this.sprinting = true;
    } else {
      this.sprinting = false;
    }
    if (this.sprinting) {
      this.stamina -= STAMINA_DRAIN * dt;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.sprinting = false;
        this.sprintLocked = true;
      }
    } else {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN * dt);
    }

    const speed = this.crouching ? SPEED_CROUCH : (this.sprinting ? SPEED_SPRINT : SPEED_WALK);

    const cam = this.camera;
    this._yawEuler.setFromQuaternion(cam.quaternion);
    const yaw = this._yawEuler.y;
    const stride = speed * dt;
    const dx = mx * stride * Math.cos(yaw) + mz * stride * Math.sin(yaw);
    const dz = -mx * stride * Math.sin(yaw) + mz * stride * Math.cos(yaw);

    const oldX = cam.position.x;
    const oldZ = cam.position.z;

    cam.position.x += dx;
    if (this.collidesAt(cam.position.x, cam.position.y, oldZ)) {
      cam.position.x = oldX;
    }
    cam.position.z += dz;
    if (this.collidesAt(cam.position.x, cam.position.y, cam.position.z)) {
      cam.position.z = oldZ;
    }

    this.velocity.y -= GRAVITY * dt;
    cam.position.y += this.velocity.y * dt;

    const floor = this.groundY() + this.height;
    if (cam.position.y <= floor) {
      if (!this.onGround && this.velocity.y < -4) SFX.land();
      cam.position.y = floor;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    if (this.lockdown) {
      const ldx = cam.position.x - this.lockdown.cx;
      const ldz = cam.position.z - this.lockdown.cz;
      const dSq = ldx * ldx + ldz * ldz;
      if (dSq > this.lockdown.maxDistSq) {
        const d = Math.sqrt(dSq);
        const max = Math.sqrt(this.lockdown.maxDistSq);
        cam.position.x = this.lockdown.cx + ldx * (max / d);
        cam.position.z = this.lockdown.cz + ldz * (max / d);
      }
    }

    if (moving && this.onGround) {
      this.stepTimer += dt;
      const interval = this.sprinting ? 0.28 : 0.42;
      if (this.stepTimer > interval) {
        this.stepTimer = 0;
        SFX.step();
      }
    } else {
      this.stepTimer = 0;
    }

    this.viewmodel.update(dt, moving, this.sprinting, this.crouching);
  }

  collidesAt(x, y, z) {
    const r = PLAYER_RADIUS;
    for (const box of this.obstacles) {
      const yLow = y - this.height;
      const yHigh = y;
      if (yHigh <= box.min.y + 0.02) continue;
      if (yLow >= box.max.y - 0.5) continue;
      if (x + r <= box.min.x || x - r >= box.max.x) continue;
      if (z + r <= box.min.z || z - r >= box.max.z) continue;
      return true;
    }
    return false;
  }

  groundY() {
    let g = 0;
    const px = this.camera.position.x;
    const pz = this.camera.position.z;
    const pyFoot = this.camera.position.y - this.height;
    for (const box of this.obstacles) {
      if (px < box.min.x - 0.05 || px > box.max.x + 0.05) continue;
      if (pz < box.min.z - 0.05 || pz > box.max.z + 0.05) continue;
      if (box.max.y > g && box.max.y <= pyFoot + 1.5) {
        g = box.max.y;
      }
    }
    return g;
  }

  getNetState() {
    const o = this.camera;
    this._yawEuler.setFromQuaternion(o.quaternion);
    return {
      x: o.position.x,
      y: o.position.y,
      z: o.position.z,
      yaw: this._yawEuler.y,
      pitch: this._yawEuler.x,
      crouching: this.crouching,
      sprinting: this.sprinting,
    };
  }

  get position() { return this.camera.position; }
}

class ViewModel {
  constructor(camera, color = 0x303440) {
    this.group = new THREE.Group();
    this.group.position.set(0, -0.45, -0.35);
    camera.add(this.group);

    const skinMat = new THREE.MeshLambertMaterial({ color: 0xeac09a });
    const sleeveMat = new THREE.MeshLambertMaterial({ color });

    this.left = this.buildHand(skinMat, sleeveMat);
    this.right = this.buildHand(skinMat, sleeveMat);
    this.left.position.set(-0.28, 0, 0);
    this.right.position.set(0.28, 0, 0);
    this.group.add(this.left);
    this.group.add(this.right);

    this._t = 0;
  }

  buildHand(skinMat, sleeveMat) {
    const g = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.32, 0.13), sleeveMat);
    arm.position.y = -0.16;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), skinMat);
    hand.position.y = -0.39;
    g.add(arm);
    g.add(hand);
    return g;
  }

  update(dt, moving, sprinting, crouching) {
    if (moving) {
      this._t += dt * (sprinting ? 11 : 8);
      const amp = sprinting ? 0.35 : 0.2;
      this.left.rotation.x = Math.sin(this._t) * amp;
      this.right.rotation.x = -Math.sin(this._t) * amp;
    } else {
      this._t += dt * 1.5;
      const idle = Math.sin(this._t) * 0.02;
      this.left.rotation.x *= 0.9;
      this.right.rotation.x *= 0.9;
      this.left.position.y = idle;
      this.right.position.y = -idle;
    }
    this.group.position.y = crouching ? -0.55 : -0.45;
  }
}
