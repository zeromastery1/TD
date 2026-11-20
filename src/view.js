import * as THREE from 'three';
import { GRID, ROUTE, SHARDS, RELICS } from './config.js';
import { Crowd, setRim } from './three/Crowd.ts';
import { model } from './three/models.ts';
import { Vfx, BOARD, GROUND } from './three/Vfx.ts';
import * as R from './three/recipes.ts';
import { groundTile, VALE, GROUND_SIZE } from './art/ground.ts';
import { effectTextures } from './art/fx.ts';

// The 3D view, in the style of Emberfall Survivors: a moonlit painted ground seen
// from a fixed 46-degree tilt, animated models drawn through an instanced crowd,
// and spell effects from a shared sheet of soft shapes.
//
// The game works in cells; one cell is CELL world units here. The game's x runs
// along X and its z along Z (toward the viewer); height is Y.

export const CELL = 64;
const HALF = (GRID - 1) / 2;
const BOARD_W = GRID * CELL;
const PITCH = (46 * Math.PI) / 180;
const SQUASH = Math.sin(PITCH);
const RISE = Math.cos(PITCH);
const TAU = Math.PI * 2;

const LOOK = { moon: 0xb4c4e8, moonPower: 0.95, sky: 0x9aaccc, earth: 0x34402c, fill: 0.42, rim: 0x6a88c8, rimPower: 0.65 };

const TONES = {
  ember: R.FIRE, frost: R.FROST, venom: R.POISON, storm: R.STORM, void: R.ARCANE,
  radiant: R.HOLY, tide: R.SPIRIT, halo: R.tone(0xff6ad5),
  sunforge: R.FIRE, glacier: R.FROST, plague: R.POISON, tempest: R.STORM, eclipse: R.ARCANE, prism: R.HOLY,
};
const toneOf = (fam) => TONES[fam] || R.tone(0xffffff);

function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wx = (x) => x * CELL;

export class View {
  constructor(container, game) {
    this.g = game;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07080d);
    this.scene = scene;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 12000);

    // Light: the moon, the sky's fill, a warm glow over the field, and lamps lent to spells.
    scene.add(new THREE.HemisphereLight(LOOK.sky, LOOK.earth, LOOK.fill * Math.PI));
    const moon = new THREE.DirectionalLight(LOOK.moon, LOOK.moonPower * Math.PI);
    const dir = new THREE.Vector3(-0.5, 0.74, 0.34).normalize();
    moon.position.copy(dir).multiplyScalar(3000);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 2;
    const reach = BOARD_W * 0.78;
    Object.assign(moon.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 10, far: 6000 });
    scene.add(moon, moon.target);
    setRim(LOOK.rim, LOOK.rimPower);

    this.lamps = [];
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 620, 1);
      scene.add(light);
      this.lamps.push({ light, life: 0, max: 1, power: 0 });
    }
    // Two fires: at the gate and at the exit.
    this.fires = [];
    for (const wp of [ROUTE[0], ROUTE[ROUTE.length - 1]]) {
      const light = new THREE.PointLight(0xffa860, 0, 900, 1);
      const fx = wp.x === 0 ? -1.6 : GRID + 0.6;
      light.position.set(wx(fx - HALF), 90, wx(wp.z - HALF) + 70);
      scene.add(light);
      this.fires.push({ light, x: wx(fx - HALF), z: wx(wp.z - HALF) + 70 });
    }

    this.buildGround();
    this.crowd = new Crowd(scene);
    this.props = new Crowd(scene);
    const fxTex = effectTextures();
    this.vfx = new Vfx(scene, (key) => fxTex[key] || null, SQUASH, RISE);
    this.buildIndicators();
    this.buildDecor();
    this.buildBars();

    this.towerMeshes = new Map();
    this.corpses = [];
    this.time = 0;

    this.view = { x: 0, z: -20, zoom: 1 };
    this.fitZoom = 1;
    this.resize();
    this.view.zoom = this.fitZoom;
    this.applyCamera();
    window.addEventListener('resize', () => this.resize());
  }

  // ---------- Setup ----------

  buildGround() {
    const c = document.createElement('canvas');
    c.width = c.height = GROUND_SIZE;
    const ctx = c.getContext('2d');
    ctx.lineJoin = ctx.lineCap = 'round';
    groundTile(ctx, VALE);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const size = 9000;
    tex.repeat.set(size / GROUND_SIZE, size / GROUND_SIZE);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // The field: a faint grid of worn flagstone seams over the turf.
    const fc = document.createElement('canvas');
    const px = 48;
    fc.width = fc.height = GRID * px;
    const f = fc.getContext('2d');
    const grd = f.createRadialGradient(fc.width / 2, fc.height / 2, fc.width * 0.2, fc.width / 2, fc.height / 2, fc.width * 0.72);
    grd.addColorStop(0, 'rgba(10,12,20,0.0)');
    grd.addColorStop(1, 'rgba(10,12,20,0.12)');
    f.fillStyle = grd;
    f.fillRect(0, 0, fc.width, fc.height);
    f.strokeStyle = 'rgba(210,225,255,0.10)';
    f.lineWidth = 2;
    for (let i = 0; i <= GRID; i++) {
      f.beginPath(); f.moveTo(i * px, 0); f.lineTo(i * px, fc.height); f.stroke();
      f.beginPath(); f.moveTo(0, i * px); f.lineTo(fc.width, i * px); f.stroke();
    }
    f.strokeStyle = 'rgba(233,185,92,0.55)';
    f.lineWidth = 6;
    f.strokeRect(3, 3, fc.width - 6, fc.height - 6);
    const ftex = new THREE.CanvasTexture(fc);
    ftex.colorSpace = THREE.SRGBColorSpace;
    ftex.anisotropy = 4;
    this.field = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W, BOARD_W),
      new THREE.MeshBasicMaterial({ map: ftex, transparent: true, depthWrite: false, opacity: 1 }),
    );
    this.field.rotation.x = -Math.PI / 2;
    this.field.position.y = 0.4;
    this.field.renderOrder = 1;
    this.scene.add(this.field);
  }

  buildIndicators() {
    const scene = this.scene;
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xe9b95c, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96), ringMat);
    this.rangeDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 96),
      new THREE.MeshBasicMaterial({ color: 0xe9b95c, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    for (const m of [this.rangeRing, this.rangeDisc]) {
      m.rotation.x = -Math.PI / 2;
      m.position.y = 1.2;
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
    }

    // Placement marker: a soft-edged tile.
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 5;
    ctx.strokeRect(5, 5, 54, 54);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(5, 5, 54, 54);
    const tex = new THREE.CanvasTexture(c);
    this.ghost = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL, CELL),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xffe2a0 }),
    );
    this.ghost.rotation.x = -Math.PI / 2;
    this.ghost.position.y = 1.5;
    this.ghost.visible = false;
    this.ghost.renderOrder = 3;
    scene.add(this.ghost);

    // Waypoint labels.
    this.labels = ROUTE.map((wp, i) => {
      const color = i === 0 ? '#9dffb8' : i === ROUTE.length - 1 ? '#ff8a7a' : '#f0c674';
      const sp = makeLabel(wp.label, color);
      sp.position.set(wx(wp.x - HALF), 70, wx(wp.z - HALF));
      scene.add(sp);
      return sp;
    });
  }

  // Scenery stands around the field: trees, bushes, stumps and rocks, with a ring
  // of boulders marking its edge.
  buildDecor() {
    const rnd = rngOf(1337);
    const decor = [];
    const add = (name, x, z, h, yaw, tint = 0xffffff) => {
      const m = model(name);
      decor.push({ m, x, z, scale: h / m.height, yaw, tint });
    };
    const edge = BOARD_W / 2;
    const gateZ = wx(ROUTE[0].z - HALF), exitZ = wx(ROUTE[ROUTE.length - 1].z - HALF);
    const nearRoad = (x, z) => (Math.abs(z - gateZ) < 260 && x < -edge + 40) || (Math.abs(z - exitZ) < 260 && x > edge - 40);
    const trees = ['tree_dark', 'tree_oak', 'tree_fat', 'tree_dark'];
    for (let i = 0; i < 150; i++) {
      const a = rnd() * TAU;
      const r = edge * 1.25 + rnd() * 1500;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) < edge + 150 || nearRoad(x, z) || (z > edge - 200 && z < edge + 520 && Math.abs(x) < edge + 200)) continue;
      add(trees[(rnd() * trees.length) | 0], x, z, 260 + rnd() * 140, rnd() * TAU, 0xd8e0e8);
    }
    const small = [['bush', 50, 80], ['bush', 50, 80], ['stump', 34, 50], ['log', 40, 50], ['rock_large', 30, 50], ['rock_tall', 70, 120]];
    for (let i = 0; i < 160; i++) {
      const x = (rnd() - 0.5) * (BOARD_W + 1400);
      const z = (rnd() - 0.5) * (BOARD_W + 1100);
      if (Math.max(Math.abs(x), Math.abs(z)) < edge + 60 || nearRoad(x, z)) continue;
      const [name, h0, h1] = small[(rnd() * small.length) | 0];
      add(name, x, z, h0 + rnd() * (h1 - h0), rnd() * TAU);
    }
    // A broken ring of boulders right at the edge.
    for (let side = 0; side < 4; side++) {
      for (let k = -edge; k < edge; k += 50 + rnd() * 70) {
        const out = edge + 34 + rnd() * 30;
        let x, z;
        if (side === 0) { x = k; z = -out; } else if (side === 1) { x = k; z = out; } else if (side === 2) { x = -out; z = k; } else { x = out; z = k; }
        if (nearRoad(x, z) || rnd() < 0.25) continue;
        add(rnd() < 0.6 ? 'rock_large' : 'rock_basalt', x, z, rnd() < 0.6 ? 18 + rnd() * 14 : 36 + rnd() * 24, rnd() * TAU, 0xb8bcc8);
      }
    }
    // Gate and exit: columns either side of the road, and a campfire.
    for (const f of this.fires) {
      const isGate = f.x < 0;
      for (const s of [-1, 1]) add(isGate ? 'column' : 'column_broken', f.x + (isGate ? 40 : -40), f.z - 70 + s * 120, isGate ? 170 : 120, 0, 0xc8ccd8);
      add('campfire', f.x, f.z + 40, 14, 0);
    }
    this.decor = decor;
  }

  buildBars() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0.5, 0, 0);
    const mk = (color) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }), 400);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(400 * 3), 3);
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 20;
      this.scene.add(m);
      return m;
    };
    this.barBack = mk(0xffffff);
    this.barFill = mk(0xffffff);
  }

  // ---------- Camera ----------

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.fitZoom = Math.min(w / (BOARD_W + 120), h / (BOARD_W * SQUASH + 190));
    this.applyCamera();
  }

  applyCamera() {
    const v = this.view;
    const cam = this.camera;
    // Keep the field centred a little low, under the HUD.
    const w = window.innerWidth / v.zoom, h = window.innerHeight / v.zoom;
    cam.left = -w / 2; cam.right = w / 2; cam.top = h / 2; cam.bottom = -h / 2;
    cam.updateProjectionMatrix();
    const far = 5000;
    cam.position.set(v.x, SQUASH * far, v.z + RISE * far);
    cam.lookAt(v.x, 0, v.z);
  }

  zoomBy(k) {
    this.view.zoom = THREE.MathUtils.clamp(this.view.zoom * k, this.fitZoom * 0.75, this.fitZoom * 3);
    this.applyCamera();
  }

  panBy(dxPx, dyPx) {
    const v = this.view;
    v.x = THREE.MathUtils.clamp(v.x - dxPx / v.zoom, -BOARD_W * 0.6, BOARD_W * 0.6);
    v.z = THREE.MathUtils.clamp(v.z - dyPx / (v.zoom * SQUASH), -BOARD_W * 0.6, BOARD_W * 0.6);
    this.applyCamera();
  }

  pickCell(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    const x = Math.round(hit.x / CELL + HALF), z = Math.round(hit.z / CELL + HALF);
    if (x < 0 || z < 0 || x >= GRID || z >= GRID) return null;
    return { x, z };
  }

  setGhost(cell, ok) {
    if (!cell) { this.ghost.visible = false; return; }
    this.ghost.visible = true;
    this.ghost.position.x = wx(cell.x - HALF);
    this.ghost.position.z = wx(cell.z - HALF);
    this.ghost.material.color.setHex(ok ? 0xffe2a0 : 0xff4a4a);
  }

  // ---------- Effects interface used by recipes ----------

  flash(x, y, color, power, life = 0.35, reach = 620) {
    let pick = this.lamps[0];
    for (const lamp of this.lamps) {
      if (lamp.life <= 0) { pick = lamp; break; }
      if (lamp.life / lamp.max < pick.life / pick.max) pick = lamp;
    }
    pick.light.color.setHex(color);
    pick.light.position.set(x, 90, y);
    pick.light.distance = reach;
    pick.life = pick.max = life;
    pick.power = power * 90;
    pick.light.intensity = pick.power;
  }

  // ---------- Towers ----------

  towerKey(t) {
    return `${t.kind}:${t.type}:${t.tier}:${t.empower}`;
  }

  syncTowers() {
    const live = new Set();
    for (const t of this.g.towers) {
      live.add(t.id);
      if (t.kind === 'stone') {
        const old = this.towerMeshes.get(t.id);
        if (old) { this.scene.remove(old.group); disposeGroup(old.group); this.towerMeshes.delete(t.id); }
        continue;
      }
      const key = this.towerKey(t);
      let rec = this.towerMeshes.get(t.id);
      if (!rec || rec.key !== key) {
        if (rec) { this.scene.remove(rec.group); disposeGroup(rec.group); }
        rec = { key, group: t.kind === 'relic' ? makeRelic(t) : makeShard(t) };
        rec.group.position.set(wx(t.pos.x), 0, wx(t.pos.z));
        rec.group.scale.setScalar(1.3);
        this.scene.add(rec.group);
        this.towerMeshes.set(t.id, rec);
      }
    }
    for (const [id, rec] of this.towerMeshes) {
      if (!live.has(id)) { this.scene.remove(rec.group); disposeGroup(rec.group); this.towerMeshes.delete(id); }
    }
  }

  drawTowers(dt) {
    const g = this.g;
    const v = this.vfx;
    const now = this.time;
    for (const t of g.towers) {
      const x = wx(t.pos.x), z = wx(t.pos.z);
      const age = g.time - t.born;
      const grow = Math.min(1, age * 4 + 0.15);
      if (t.kind === 'stone') {
        // A boulder filling the cell, squat or tall by its seed.
        const m = model('rock_large');
        const rise = 0.4 + 0.6 * Math.min(1, age * 3 + 0.2);
        const wide = (CELL * (0.9 + t.seed * 0.15)) / m.width;
        this.props.add(m, x, z, 0, t.seed * TAU, wide, (2.2 + t.seed * 1.4) * rise, 0, 0xffffff, 0.06, 1, 0, true);
        continue;
      }
      const rec = this.towerMeshes.get(t.id);
      if (!rec) continue;
      const color = g.colorOf(t);
      const u = rec.group.userData;
      const pulse = t.pulse || 0;
      u.crystal.rotation.y += dt * (0.5 + (t.tier || 0) * 0.1);
      u.crystal.position.y = u.baseY + Math.sin(now * 2 + t.seed * 6) * 4;
      const s = grow * (1 + pulse * 0.12);
      u.crystal.scale.setScalar(s);
      u.mat.emissiveIntensity = u.glow + pulse * 1.2;
      const tierGlow = t.kind === 'relic' ? 1 : 0.4 + t.tier * 0.12;
      v.sprite('dot', x, z, 0.8, 90 + t.tier * 12, 90 + t.tier * 12, 0, color, 0.22 * tierGlow + pulse * 0.25, GROUND, 1);
      v.sprite('core', x, z, u.baseY + 2, 54 + t.tier * 10 + pulse * 30, 54 + t.tier * 10 + pulse * 30, 0, color, 0.25 * tierGlow + pulse * 0.4, BOARD, 1);
      if (t.kind === 'relic') {
        const m = model('obelisk');
        this.props.add(m, x, z, 0, t.seed * TAU, 100 / m.height, 1, 0, 0xc8cce0, 0.1, 1, 0.4, true, color, 0.45);
        v.sprite('sigil', x, z, 0.9, 120 + t.empower * 12, 120 + t.empower * 12, now * 0.6, color, 0.55, GROUND, 1);
      }
      if (t.candidate) {
        const k = 0.5 + 0.5 * Math.sin(now * 5);
        v.sprite('ring', x, z, 1, 74 + k * 8, 74 + k * 8, 0, 0xffe2a0, 0.6 + k * 0.3, GROUND, 1);
      }
      if ((t.tier >= 3 || t.kind === 'relic') && Math.random() < dt * (t.kind === 'relic' ? 3 : 1.2)) R.motes(this, x, z, 26, color, 1, 60, 6);
    }
  }

  // ---------- Creeps ----------

  pose(clip, t, loop = true) {
    let f = (t / clip.dur) * clip.frames;
    if (loop) f %= clip.frames;
    else f = Math.min(f, clip.frames - 1);
    const i = Math.floor(f);
    const next = loop ? (i + 1) % clip.frames : Math.min(i + 1, clip.frames - 1);
    return { a: clip.row + i, b: clip.row + next, blend: f - i, upper: false };
  }

  creepLook(c) {
    const m = model(c.model);
    const scale = (c.def.height * CELL) / m.height;
    const lift = c.flying ? 54 : 0;
    return { m, scale, lift };
  }

  drawCreeps(dt) {
    const g = this.g;
    const v = this.vfx;
    let n = 0;
    const bb = this.barBack, bf = this.barFill;
    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-PITCH, 0, 0));
    const P = new THREE.Vector3(), S = new THREE.Vector3();
    const col = new THREE.Color();
    for (const c of g.creeps) {
      if (!c.alive) continue;
      const { m, scale, lift } = this.creepLook(c);
      c.animT = (c.animT || Math.random()) + dt * ((c.pace || c.speed) / c.speed);
      c.yawV = c.yawV === undefined ? c.heading : turnToward(c.yawV, c.heading, dt * 10);
      const x = wx(c.pos.x), z = wx(c.pos.z);
      const now = g.time;
      const slowed = now < c.slowUntil;
      let poisoned = false, burning = false;
      for (const d of c.dots.values()) { if (d.kind === 'burn') burning = true; else poisoned = true; }
      const tint = slowed ? 0x9cc4ff : poisoned ? 0xb6f08c : burning ? 0xffc090 : 0xffffff;
      const bob = c.flying ? Math.sin(c.animT * 4) * 6 : 0;
      const spawnIn = Math.min(1, (now - c.born) * 3);
      const clip = m.clips.move || Object.values(m.clips)[0];
      this.crowd.add(m, x, z, lift + bob, c.yawV, scale, 1, this.pose(clip, c.animT), tint, c.hitFlash * 0.7, spawnIn, c.boss ? 0.5 : c.flying ? 0.45 : 0.2, true,
        c.boss ? 0xff4a3a : 0x120e14, c.boss ? 0.55 : 0);
      if (c.flying) v.sprite('blob', x, z, 0.5, 46, 46, 0, 0x000000, 0.35, GROUND, 0);
      if (slowed && Math.random() < dt * 4) R.motes(this, x, z, 18, 0xb4e6ff, 1, 40, 5);
      if (poisoned && Math.random() < dt * 4) R.chips(this, x, z, 20, 0x9be04a, 1, 60, 8, 'bubble');
      if (burning && Math.random() < dt * 8) R.flames(this, x, z, 10, 1, 18, R.FIRE, 8, 0, 80);

      // Health bar, once hurt.
      if (c.hp < c.maxHp && n < 400) {
        const frac = Math.max(0, c.hp / c.maxHp);
        const w = c.boss ? 110 : 44;
        const h = c.boss ? 9 : 6;
        const top = lift + c.def.height * CELL + 14;
        P.set(x - w / 2 - 1.5, top, z);
        S.set(w + 3, h + 3, 1);
        M.compose(P, Q, S);
        bb.setMatrixAt(n, M);
        bb.setColorAt(n, col.setHex(0x0c0a14));
        P.set(x - w / 2, top, z + 0.5);
        S.set(Math.max(0.001, w * frac), h, 1);
        M.compose(P, Q, S);
        bf.setMatrixAt(n, M);
        bf.setColorAt(n, col.setHex(c.boss ? 0xe9b95c : frac > 0.5 ? 0xd8433b : 0xff6a3a));
        n++;
      }
    }
    bb.count = bf.count = n;
    for (const b of [bb, bf]) {
      b.instanceMatrix.needsUpdate = true;
      if (b.instanceColor) b.instanceColor.needsUpdate = true;
    }

    // The fallen play their death once, lie a moment, and fade.
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const k = this.corpses[i];
      k.t += dt;
      const die = k.m.clips.die;
      const hold = 1.1;
      const fade = 0.6;
      if (k.t > (die ? die.dur : 0) + hold + fade) { this.corpses.splice(i, 1); continue; }
      const alpha = Math.max(0, Math.min(1, 1 - (k.t - (die ? die.dur : 0) - hold) / fade));
      const lift = k.lift * Math.max(0, 1 - k.t / 0.5);
      const anim = die ? this.pose(die, k.t, false) : this.pose(k.m.clips.move || Object.values(k.m.clips)[0], 0);
      this.crowd.add(k.m, k.x, k.z, lift, k.yaw, k.scale, 1, anim, 0xffffff, Math.max(0, 0.6 - k.t * 3), die ? alpha : alpha * Math.max(0, 1 - k.t), 0, alpha > 0.5, k.edge, k.edgeStrength);
    }
  }

  // ---------- Events ----------

  handleEvents() {
    const g = this.g;
    for (const e of g.events) {
      const t = e.t;
      switch (e.type) {
        case 'fire': {
          const x = wx(t.pos.x), z = wx(t.pos.z);
          R.flash(this, x, z, t.kind === 'relic' ? 96 : 64, 34, e.st.color, 0.12);
          break;
        }
        case 'hit': this.hitEffect(e); break;
        case 'chain': {
          const pts = e.pts;
          for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            R.zap(this, wx(a.x), wx(a.z), a.h * CELL, wx(b.x), wx(b.z), b.h * CELL, e.st.color, e.t.kind === 'relic' ? 6 : 4, 0.2);
          }
          const last = pts[pts.length - 1];
          this.flash(wx(last.x), wx(last.z), e.st.color, 1.2, 0.2);
          break;
        }
        case 'death': {
          const c = e.c;
          const { m, scale, lift } = this.creepLook(c);
          const x = wx(c.pos.x), z = wx(c.pos.z);
          this.corpses.push({ m, x, z, lift, yaw: c.yawV ?? c.heading, scale, t: 0, edge: c.boss ? 0xff4a3a : 0x120e14, edgeStrength: c.boss ? 0.55 : 0 });
          R.dust(this, x, z, c.boss ? 16 : 5, c.boss ? 60 : 26);
          R.motes(this, x, z, 20, 0xffe2a0, c.boss ? 20 : 3, 90, 6);
          if (c.boss) { R.wave(this, x, z, 260, 0.6, R.HOLY, 40, 46); this.flash(x, z, 0xffe2a0, 3, 0.8, 900); }
          break;
        }
        case 'leak': {
          const c = e.c;
          const x = wx(c.pos.x), z = wx(c.pos.z);
          R.ring(this, x, z, 20, 140, 0.5, 0xff3b3b, 0.9, true);
          R.smoke(this, x, z, 20, 6, 40, 0x2a1a1a, 0.6);
          this.flash(x, z, 0xff3b3b, 2, 0.4);
          break;
        }
        case 'place': {
          const x = wx(t.pos.x), z = wx(t.pos.z);
          R.dust(this, x, z, 5, 24, 0xa89c8a, 0.3, 50);
          R.motes(this, x, z, 24, g.colorOf(t), 6, 80, 7);
          R.ring(this, x, z, 10, 60, 0.35, g.colorOf(t), 0.8, true);
          break;
        }
        case 'stone': {
          const x = wx(t.pos.x), z = wx(t.pos.z);
          R.dust(this, x, z, 6, 30, 0x9a9488, 0.4, 70);
          R.chips(this, x, z, 30, 0x8a8478, 5, 220, 10, 'shard');
          break;
        }
        case 'clear': {
          const x = wx(t.pos.x), z = wx(t.pos.z);
          R.dust(this, x, z, 8, 34, 0x9a9488, 0.45, 90);
          break;
        }
        case 'keep': {
          const x = wx(t.pos.x), z = wx(t.pos.z);
          R.pillar(this, x, z, 220, 26, g.colorOf(t), 0.5, 0.7);
          R.ring(this, x, z, 20, 90, 0.4, g.colorOf(t), 0.8, true);
          break;
        }
        case 'combine':
        case 'empower':
        case 'forge': {
          const x = wx(t.pos.x), z = wx(t.pos.z);
          const color = g.colorOf(t);
          const big = e.type === 'forge' ? 1.6 : 1;
          R.pillar(this, x, z, 340 * big, 34 * big, color, 0.7, 0.85);
          R.wave(this, x, z, 150 * big, 0.45, R.tone(color), 30, 40);
          R.motes(this, x, z, 50, color, 18 * big, 120, 8);
          this.flash(x, z, color, 3 * big, 0.6, 800);
          break;
        }
        case 'feed': {
          const a = e.from, b = e.to;
          R.zap(this, wx(a.pos.x), wx(a.pos.z), 60, wx(b.pos.x), wx(b.pos.z), 80, g.colorOf(b), 5, 0.4);
          break;
        }
        case 'wave': {
          const p = g.routeWorld[0];
          R.ring(this, wx(p.x), wx(p.z), 20, 180, 0.7, 0x9dffb8, 0.8, true);
          break;
        }
      }
    }
    g.events.length = 0;
  }

  hitEffect(e) {
    const st = e.st;
    const p = e.point;
    const x = wx(p.x), z = wx(p.z), h = p.y * CELL;
    const fam = st.family;
    const pw = Math.min(2.4, st.power || 1);
    const tone = toneOf(fam);
    const relic = !!RELICS[fam];
    if (st.splash) {
      R.blast(this, x, z, h * 0.5, st.splash * CELL * 0.8, tone, 0.45 * pw, fam === 'ember' || fam === 'sunforge');
      if (relic) this.flash(x, z, tone.mid, 1.5, 0.25);
      return;
    }
    switch (fam) {
      case 'frost':
      case 'glacier':
        R.hit(this, x, z, h, tone.mid);
        R.chips(this, x, z, h, 0xcfefff, 3 + Math.round(pw * 2), 220, 9, 'shard');
        if (relic) R.ring(this, x, z, 10, 70, 0.3, tone.mid, 0.8);
        break;
      case 'venom':
        R.hit(this, x, z, h, tone.mid);
        R.chips(this, x, z, h, tone.mid, 3, 140, 9, 'bubble');
        break;
      case 'storm':
      case 'tempest':
        R.sparks(this, x, z, h, tone.mid, 4, 300, 5, 0.35);
        break;
      case 'void':
      case 'eclipse':
        R.hit(this, x, z, h, tone.mid);
        R.motes(this, x, z, 16, tone.deep, 3, 60, 7);
        break;
      case 'radiant':
        if (e.crit) { R.strike(this, x, z, tone.mid, 0.6 * pw); this.flash(x, z, tone.mid, 1.2, 0.18); }
        else R.hit(this, x, z, h, tone.mid, 0, 0, 5);
        break;
      case 'prism':
        R.strike(this, x, z, tone.mid, 1.2);
        break;
      case 'tide':
        R.hit(this, x, z, h, tone.mid);
        R.chips(this, x, z, h, 0xaafff0, 3, 200, 8, 'drop');
        break;
      default:
        R.hit(this, x, z, h, tone.mid);
    }
  }

  drawProjectiles(dt) {
    const v = this.vfx;
    for (const p of this.g.projectiles) {
      const x = wx(p.pos.x), z = wx(p.pos.z), h = p.pos.y * CELL;
      const st = p.st;
      const tone = toneOf(st.family);
      const big = RELICS[st.family] ? 1.5 : 1 + Math.min(1, (st.power - 1) * 0.6);
      v.sprite('core', x, z, h, 30 * big, 30 * big, 0, tone.mid, 0.9, BOARD, 1);
      v.sprite('dot', x, z, h, 12 * big, 12 * big, 0, tone.hot, 1, BOARD, 1);
      const dx = (p.pos.x - p.prev.x) * CELL, dz = (p.pos.z - p.prev.z) * CELL, dh = (p.pos.y - p.prev.y) * CELL;
      if (st.family === 'ember' || st.family === 'sunforge') {
        if (Math.random() < 0.7) R.flames(this, x, z, h, 1, 14 * big, R.FIRE, 3, 0, 40);
      } else {
        v.emit({ f: 'dot', x, y: z, h, life: 0.22, s0: 16 * big, s1: 2, c0: tone.hot, c1: tone.mid, a: 0.7, hold: 0.1 });
      }
      if (dx || dz) v.emit({ f: 'streak', mode: 2, x, y: z, h, ax: dx, ay: dz, ah: dh, life: 0.08, s0: 8 * big, s1: 2, c0: tone.hot, c1: tone.deep, a: 0.6, stretch: 0.05 });
    }
  }

  drawScenery(dt) {
    const v = this.vfx;
    for (const d of this.decor) this.props.add(d.m, d.x, d.z, 0, d.yaw, d.scale, 1, 0, d.tint, 0, 1, 0, true);
    // Waypoint sigils; the route ahead glows during building.
    ROUTE.forEach((wp, i) => {
      const color = i === 0 ? 0x5dff9a : i === ROUTE.length - 1 ? 0xff5d5d : 0x8fd4ff;
      v.sprite('sigil', wx(wp.x - HALF), wx(wp.z - HALF), 0.7, 96, 96, this.time * (i % 2 ? 0.5 : -0.5), color, 0.6, GROUND, 1);
    });
    const route = this.g.routeWorld;
    const building = this.g.phase === 'build' || this.g.phase === 'choose';
    const base = building ? 0.5 : 0.16;
    for (let i = 0; i < route.length; i++) {
      const k = 0.5 + 0.5 * Math.sin(i * 0.45 - this.time * 5);
      v.sprite('core', wx(route[i].x), wx(route[i].z), 1.2, 24 + k * 10, 24 + k * 10, 0, 0x9fd0ff, base * (0.5 + k * 0.7), GROUND, 1);
    }
    // Fires flicker; fireflies drift over the field.
    for (const f of this.fires) {
      f.light.intensity = 260 + Math.sin(this.time * 13 + f.x) * 30 + Math.random() * 30;
      if (Math.random() < 0.5) R.flames(this, f.x, f.z + 40, 6, 1, 26, R.FIRE, 10, 0, 90);
    }
    if (Math.random() < dt * 6) {
      const x = (Math.random() - 0.5) * BOARD_W * 1.4, z = (Math.random() - 0.5) * BOARD_W * 1.2;
      R.motes(this, x, z, 30, Math.random() < 0.5 ? 0xd8f070 : 0x9fd8f0, 1, 30, 6);
    }
  }

  showSelection() {
    const t = this.g.selected;
    const st = t && this.g.stats(t);
    if (!st) { this.rangeRing.visible = this.rangeDisc.visible = false; return; }
    const r = st.range * CELL;
    const color = this.g.colorOf(t);
    for (const m of [this.rangeRing, this.rangeDisc]) {
      m.visible = true;
      m.position.x = wx(t.pos.x);
      m.position.z = wx(t.pos.z);
      m.scale.set(r, r, 1);
    }
    this.rangeDisc.material.color.setHex(color);
    if (t) this.vfx.sprite('ring', wx(t.pos.x), wx(t.pos.z), 1.1, 80, 80, 0, 0xffe2a0, 0.9, GROUND, 1);
  }

  // ---------- Frame ----------

  update(rawDt) {
    const g = this.g;
    const dt = Math.min(rawDt, 0.05) * (g.phase === 'over' || g.phase === 'won' ? 0.3 : g.speed) * (this.paused ? 0 : 1);
    this.time += dt;
    this.crowd.begin();
    this.props.begin();
    this.vfx.begin();
    this.syncTowers();
    this.handleEvents();
    this.drawScenery(dt);
    this.drawTowers(dt);
    this.drawCreeps(dt);
    this.drawProjectiles(dt);
    this.showSelection();
    this.vfx.tick(dt);
    for (const lamp of this.lamps) {
      if (lamp.life <= 0) { lamp.light.intensity = 0; continue; }
      lamp.life -= dt;
      const k = Math.max(0, lamp.life / lamp.max);
      lamp.light.intensity = lamp.power * k * k;
    }
    this.field.material.opacity = g.phase === 'build' || g.phase === 'choose' ? 1 : 0.5;
    this.crowd.end();
    this.props.end();
    this.vfx.end();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

function turnToward(from, to, k) {
  let d = to - from;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return from + d * Math.min(1, k);
}

// ---------- Tower meshes ----------

const plinthGeo = new THREE.CylinderGeometry(24, 29, 16, 8).translate(0, 8, 0);
const plinthCapGeo = new THREE.CylinderGeometry(20, 24, 6, 8).translate(0, 19, 0);
const stoneMat = new THREE.MeshLambertMaterial({ color: 0x5a6070, flatShading: true });
const capMat = new THREE.MeshLambertMaterial({ color: 0x737a8c, flatShading: true });
const crystalGeo = makeCrystalGeometry();

function makeCrystalGeometry() {
  // A six-sided crystal: a tall prism with pointed ends.
  const pts = [];
  pts.push(new THREE.Vector2(0, -0.55));
  pts.push(new THREE.Vector2(0.42, -0.25));
  pts.push(new THREE.Vector2(0.42, 0.35));
  pts.push(new THREE.Vector2(0, 0.9));
  const g = new THREE.LatheGeometry(pts, 6);
  g.computeVertexNormals();
  return g;
}

function crystalMat(color, glow) {
  const c = new THREE.Color(color);
  // Pale crystals would glow to a white blob; give them a cooler, dimmer inner light.
  const pale = c.r + c.g + c.b > 2.4;
  const e = pale ? new THREE.Color(0x8fa8e0) : c;
  return new THREE.MeshStandardMaterial({
    color: c, emissive: e, emissiveIntensity: pale ? glow * 0.6 : glow, roughness: 0.25, metalness: 0.05, flatShading: true,
  });
}

function makeShard(t) {
  const def = SHARDS[t.type];
  const g = new THREE.Group();
  const plinth = new THREE.Mesh(plinthGeo, stoneMat);
  const cap = new THREE.Mesh(plinthCapGeo, capMat);
  plinth.castShadow = plinth.receiveShadow = cap.castShadow = cap.receiveShadow = true;
  g.add(plinth, cap);
  const glow = 0.35 + t.tier * 0.18;
  const mat = crystalMat(def.color, glow);
  const crystal = new THREE.Group();
  const size = 30 + t.tier * 4;
  const main = new THREE.Mesh(crystalGeo, mat);
  main.scale.set(size * 0.95, size * 1.45, size * 0.95);
  main.castShadow = true;
  crystal.add(main);
  // Smaller crystals around the main one, more at higher qualities.
  const extra = 1 + t.tier;
  for (let i = 0; i < extra; i++) {
    const a = (i / extra) * TAU + 0.4;
    const s = size * (0.35 + 0.05 * (i % 2));
    const m = new THREE.Mesh(crystalGeo, mat);
    m.scale.set(s * 0.7, s * 1.1, s * 0.7);
    m.position.set(Math.cos(a) * size * 0.42, -size * 0.2, Math.sin(a) * size * 0.42);
    m.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    m.castShadow = true;
    crystal.add(m);
  }
  const baseY = 32 + size * 0.75;
  crystal.position.y = baseY;
  g.add(crystal);
  g.userData = { crystal, mat, glow, baseY };
  return g;
}

function makeRelic(t) {
  const def = RELICS[t.type];
  const g = new THREE.Group();
  const glow = 1.0 + t.empower * 0.3;
  const mat = crystalMat(def.color, glow);
  const crystal = new THREE.Group();
  const main = new THREE.Mesh(crystalGeo, mat);
  main.scale.set(26, 46, 26);
  main.castShadow = true;
  crystal.add(main);
  for (let i = 0; i < 4 + t.empower; i++) {
    const a = (i / (4 + t.empower)) * TAU;
    const m = new THREE.Mesh(crystalGeo, mat);
    m.scale.set(7, 12, 7);
    m.position.set(Math.cos(a) * 30, 0, Math.sin(a) * 30);
    crystal.add(m);
  }
  const baseY = 104;
  crystal.position.y = baseY;
  g.add(crystal);
  g.userData = { crystal, mat, glow, baseY };
  return g;
}

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.material && o.material !== stoneMat && o.material !== capMat) o.material.dispose();
  });
}

function makeLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.font = '700 54px Cinzel, Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(12,10,20,0.9)';
  ctx.strokeText(text, 128, 50);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false }));
  sp.scale.set(96, 36, 1);
  sp.renderOrder = 15;
  return sp;
}
