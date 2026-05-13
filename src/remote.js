import * as THREE from 'three';
import { darken, colorFromStr } from './colors.js';

const NEUTRAL = 0x888888;

export class RemotePlayer {
  constructor(sessionId, scene) {
    this.id = sessionId;
    this.scene = scene;
    this.group = new THREE.Group();
    this.color = NEUTRAL;

    this.torsoMat = new THREE.MeshLambertMaterial({ color: NEUTRAL });
    this.headMat = new THREE.MeshLambertMaterial({ color: NEUTRAL });
    this.limbMat = new THREE.MeshLambertMaterial({ color: darken(NEUTRAL) });

    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.45), this.torsoMat);
    this.torso.position.y = 1.0;
    this.group.add(this.torso);

    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), this.headMat);
    this.head.position.y = 1.85;
    this.group.add(this.head);

    const armGeom = new THREE.BoxGeometry(0.22, 0.85, 0.22);
    this.armL = new THREE.Mesh(armGeom, this.limbMat);
    this.armR = new THREE.Mesh(armGeom, this.limbMat);
    this.armL.position.set(-0.46, 1.05, 0);
    this.armR.position.set( 0.46, 1.05, 0);
    this.group.add(this.armL);
    this.group.add(this.armR);

    const legGeom = new THREE.BoxGeometry(0.26, 0.85, 0.26);
    this.legL = new THREE.Mesh(legGeom, this.limbMat);
    this.legR = new THREE.Mesh(legGeom, this.limbMat);
    this.legL.position.set(-0.18, 0.42, 0);
    this.legR.position.set( 0.18, 0.42, 0);
    this.group.add(this.legL);
    this.group.add(this.legR);

    this.target = { x: 0, y: 0, z: 0, yaw: 0 };
    this.legPhase = Math.random() * Math.PI * 2;
    this._prev = { x: 0, z: 0 };

    scene.add(this.group);
  }

  setName() {}
  setTeam() {}
  setRevealed() {}

  setColor(hexStr) {
    const c = colorFromStr(hexStr);
    if (c === this.color) return;
    this.color = c;
    this.torsoMat.color.setHex(c);
    this.headMat.color.setHex(c);
    this.limbMat.color.setHex(darken(c));
  }

  setAlive(alive) {
    this.group.visible = alive;
  }

  setState(s) {
    this.target.x = s.x;
    this.target.y = s.y;
    this.target.z = s.z;
    this.target.yaw = s.yaw;
    this.crouching = s.crouching;
  }

  update(dt) {
    const p = this.group.position;
    const k = Math.min(1, dt * 14);
    p.x += (this.target.x - p.x) * k;
    p.z += (this.target.z - p.z) * k;
    p.y += ((this.target.y - 1.7) - p.y) * k;

    let dy = this.target.yaw - this.group.rotation.y;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    this.group.rotation.y += dy * k;

    const moved = Math.hypot(p.x - this._prev.x, p.z - this._prev.z) > 0.005;
    if (moved) {
      this.legPhase += dt * 9;
      const amp = 0.55;
      this.legL.rotation.x =  Math.sin(this.legPhase) * amp;
      this.legR.rotation.x = -Math.sin(this.legPhase) * amp;
      this.armL.rotation.x = -Math.sin(this.legPhase) * amp * 0.7;
      this.armR.rotation.x =  Math.sin(this.legPhase) * amp * 0.7;
    } else {
      this.legL.rotation.x *= 0.85;
      this.legR.rotation.x *= 0.85;
      this.armL.rotation.x *= 0.85;
      this.armR.rotation.x *= 0.85;
    }

    if (this.crouching) {
      this.group.scale.y = 0.7;
    } else {
      this.group.scale.y += (1 - this.group.scale.y) * k;
    }

    this._prev.x = p.x;
    this._prev.z = p.z;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}
