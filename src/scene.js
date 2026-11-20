import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GRID, ROUTE, SHARDS, RELICS } from './config.js';

const HALF = (GRID - 1) / 2;
export const cellToWorld = (x, z, y = 0) => new THREE.Vector3(x - HALF, y, z - HALF);
export const worldToCell = (v) => ({ x: Math.round(v.x + HALF), z: Math.round(v.z + HALF) });

export class Scene3D {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d16);
    scene.fog = new THREE.Fog(0x0b0d16, 40, 80);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 25, 19);
    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 1);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI * 0.42;
    controls.minPolarAngle = 0.15;
    controls.minDistance = 10;
    controls.maxDistance = 55;
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    controls.screenSpacePanning = false;
    this.controls = controls;

    scene.add(new THREE.HemisphereLight(0x8090ff, 0x201810, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
    sun.position.set(-14, 26, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 18;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 70 });
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.5, 0.82);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.geo = makeGeometries();
    this.buildBoard();

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  buildBoard() {
    const { scene } = this;
    // Outer terrain
    const outer = new THREE.Mesh(
      new THREE.CircleGeometry(60, 48),
      new THREE.MeshStandardMaterial({ color: 0x141826, roughness: 1 }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.3;
    outer.receiveShadow = true;
    scene.add(outer);

    // Board slab with a grid texture
    const tex = makeGridTexture();
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(GRID, 0.6, GRID),
      [
        new THREE.MeshStandardMaterial({ color: 0x232a3d, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ color: 0x232a3d, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
        new THREE.MeshStandardMaterial({ color: 0x232a3d }),
        new THREE.MeshStandardMaterial({ color: 0x232a3d, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ color: 0x232a3d, roughness: 0.9 }),
      ],
    );
    board.position.y = -0.3;
    board.receiveShadow = true;
    scene.add(board);

    // Scattered decorative crystals around the board edge
    const rng = mulberry(7);
    const decoMat = new THREE.MeshStandardMaterial({ color: 0x2a3150, roughness: 0.6, flatShading: true });
    for (let i = 0; i < 70; i++) {
      const a = rng() * Math.PI * 2;
      const r = GRID * 0.75 + rng() * 14;
      const m = new THREE.Mesh(this.geo.stone, decoMat);
      m.position.set(Math.cos(a) * r, -0.2, Math.sin(a) * r);
      const sc = 0.6 + rng() * 2.2;
      m.scale.set(sc, sc * (0.6 + rng()), sc);
      m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      m.castShadow = true;
      scene.add(m);
    }

    // Waypoint markers
    this.waypointMeshes = [];
    ROUTE.forEach((wp, i) => {
      const isEnd = i === 0 || i === ROUTE.length - 1;
      const color = i === 0 ? 0x5dff9a : i === ROUTE.length - 1 ? 0xff5d5d : 0x60c8ff;
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.05, 8, 32),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      g.add(ring);
      if (isEnd) {
        const arch = new THREE.Mesh(
          new THREE.TorusGeometry(0.55, 0.08, 8, 24, Math.PI),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 }),
        );
        arch.rotation.y = Math.PI / 2;
        g.add(arch);
      }
      const label = makeLabelSprite(wp.label, color);
      label.position.y = isEnd ? 1.1 : 0.8;
      g.add(label);
      g.position.copy(cellToWorld(wp.x, wp.z));
      g.userData.ring = ring;
      scene.add(g);
      this.waypointMeshes.push(g);
    });

    // Route preview tiles (instanced)
    this.routeMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({ color: 0x4f7cff, transparent: true, opacity: 0.55, depthWrite: false }),
      GRID * GRID * 2,
    );
    this.routeMesh.count = 0;
    this.routeMesh.frustumCulled = false;
    scene.add(this.routeMesh);

    // Selection and range indicators
    this.selectRing = new THREE.Mesh(
      new THREE.RingGeometry(0.46, 0.56, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.visible = false;
    scene.add(this.selectRing);

    this.rangeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.rangeRing.position.y = 0.03;
    this.rangeRing.visible = false;
    scene.add(this.rangeRing);

    this.rangeDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.07, depthWrite: false }),
    );
    this.rangeDisc.rotation.x = -Math.PI / 2;
    this.rangeDisc.position.y = 0.02;
    this.rangeDisc.visible = false;
    scene.add(this.rangeDisc);

    // Placement ghost
    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 0.08, 0.92),
      new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.45 }),
    );
    this.ghost.visible = false;
    scene.add(this.ghost);
  }

  setRoute(cells, flyingPoints) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.PI / 4));
    const s = new THREE.Vector3(1, 1, 1);
    let n = 0;
    if (cells) {
      for (let i = 0; i < cells.length; i++) {
        const p = cellToWorld(cells[i].x, cells[i].z, 0.015);
        m.compose(p, q, s);
        this.routeMesh.setMatrixAt(n++, m);
      }
    }
    this.routeMesh.count = n;
    this.routeMesh.instanceMatrix.needsUpdate = true;
    this.routeCells = cells;
  }

  pickCell(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    const c = worldToCell(hit);
    if (c.x < 0 || c.z < 0 || c.x >= GRID || c.z >= GRID) return null;
    return c;
  }

  showRange(x, z, range, color = 0x9fd0ff) {
    if (range == null) {
      this.rangeRing.visible = this.rangeDisc.visible = false;
      return;
    }
    const p = cellToWorld(x, z);
    for (const m of [this.rangeRing, this.rangeDisc]) {
      m.visible = true;
      m.position.x = p.x;
      m.position.z = p.z;
      m.scale.set(range, range, 1);
      m.material.color.setHex(color);
    }
  }

  // ---------- Mesh factories ----------

  makeShardMesh(type, tier) {
    const def = SHARDS[type];
    const g = new THREE.Group();
    const ped = new THREE.Mesh(this.geo.pedestal, this.geo.pedestalMat);
    ped.castShadow = ped.receiveShadow = true;
    g.add(ped);
    const mat = new THREE.MeshStandardMaterial({
      color: def.color,
      emissive: def.color,
      emissiveIntensity: 0.35 + tier * 0.22,
      roughness: 0.15,
      metalness: 0.1,
      flatShading: true,
    });
    const gem = new THREE.Mesh(this.geo[def.shape], mat);
    const sc = 0.34 + tier * 0.05;
    gem.scale.set(sc, sc * 1.35, sc);
    gem.position.y = 0.55 + tier * 0.04;
    gem.castShadow = true;
    g.add(gem);
    // Tier pips orbiting the gem
    const pips = new THREE.Group();
    for (let i = 0; i < tier; i++) {
      const pip = new THREE.Mesh(this.geo.pip, mat);
      const a = (i / tier) * Math.PI * 2;
      pip.position.set(Math.cos(a) * 0.48, 0, Math.sin(a) * 0.48);
      pips.add(pip);
    }
    pips.position.y = gem.position.y;
    g.add(pips);
    g.userData = { gem, pips, spin: 0.6 + Math.random() * 0.4, baseY: gem.position.y, phase: Math.random() * 6 };
    return g;
  }

  makeRelicMesh(type, empower = 0) {
    const def = RELICS[type];
    const g = new THREE.Group();
    const ped = new THREE.Mesh(this.geo.relicPedestal, this.geo.pedestalMat);
    ped.castShadow = ped.receiveShadow = true;
    g.add(ped);
    const mat = new THREE.MeshStandardMaterial({
      color: def.color, emissive: def.color, emissiveIntensity: 1.1 + empower * 0.3,
      roughness: 0.1, flatShading: true,
    });
    const gem = new THREE.Mesh(this.geo.octa, mat);
    gem.scale.set(0.34, 0.6, 0.34);
    gem.position.y = 0.95;
    gem.castShadow = true;
    g.add(gem);
    const pips = new THREE.Group();
    for (let i = 0; i < 3 + empower; i++) {
      const sh = new THREE.Mesh(this.geo.tetra, mat);
      const a = (i / (3 + empower)) * Math.PI * 2;
      sh.position.set(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45);
      sh.scale.setScalar(0.12);
      pips.add(sh);
    }
    pips.position.y = 0.95;
    g.add(pips);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.025, 6, 32),
      new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 2 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.32;
    g.add(ring);
    g.userData = { gem, pips, spin: 1.2, baseY: 0.95, phase: Math.random() * 6 };
    return g;
  }

  makeStoneMesh() {
    const m = new THREE.Mesh(this.geo.stone, this.geo.stoneMat);
    const s = 0.38 + Math.random() * 0.08;
    m.scale.set(s, s * (0.8 + Math.random() * 0.4), s);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.position.y = 0.3;
    m.castShadow = m.receiveShadow = true;
    const g = new THREE.Group();
    g.add(m);
    g.userData = {};
    return g;
  }

  makeCandidateMarker() {
    const m = new THREE.Mesh(this.geo.candRing, this.geo.candMat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.04;
    return m;
  }

  makeCreepMesh(type, color, size) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, flatShading: true, emissive: color, emissiveIntensity: 0.15 });
    let body;
    switch (type) {
      case 'fast': body = new THREE.Mesh(this.geo.cone, mat); body.rotation.z = -Math.PI / 2; break;
      case 'armored': body = new THREE.Mesh(this.geo.box, mat); break;
      case 'swarm': body = new THREE.Mesh(this.geo.sphere, mat); break;
      case 'regen': body = new THREE.Mesh(this.geo.knot, mat); break;
      case 'flying':
        mat.emissiveIntensity = 0.9;
        body = new THREE.Mesh(this.geo.octa, mat);
        break;
      case 'boss': body = new THREE.Mesh(this.geo.spiky, mat); break;
      default: body = new THREE.Mesh(this.geo.capsule, mat);
    }
    body.scale.setScalar(size * 1.3);
    body.castShadow = true;
    const inner = new THREE.Group();
    inner.add(body);
    g.add(inner);

    const barBg = new THREE.Mesh(this.geo.bar, this.geo.barBgMat);
    const barFg = new THREE.Mesh(this.geo.bar, new THREE.MeshBasicMaterial({ color: 0x55ff55 }));
    barFg.position.z = 0.001;
    const bar = new THREE.Group();
    bar.add(barBg, barFg);
    bar.position.y = size * 2.6 + 0.35;
    bar.scale.x = Math.max(0.6, size * 2.2);
    g.add(bar);
    g.userData = { inner, body, bar, barFg, mat };
    return g;
  }

  makeProjectile(color) {
    const m = new THREE.Mesh(this.geo.proj, new THREE.MeshBasicMaterial({ color }));
    m.material.color.multiplyScalar(2.2);
    return m;
  }

  makeLightning(points, color) {
    const pts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const steps = 5;
      for (let s = 0; s <= steps; s++) {
        const p = a.clone().lerp(b, s / steps);
        if (s > 0 && s < steps) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3));
        pts.push(p);
      }
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const c = new THREE.Color(color).multiplyScalar(2.5);
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: c, transparent: true }));
  }

  makeBurst(color, radius) {
    const m = new THREE.Mesh(this.geo.burst, new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false,
    }));
    m.rotation.x = -Math.PI / 2;
    m.userData.radius = radius;
    return m;
  }

  makeParticle(color) {
    return new THREE.Mesh(this.geo.particle, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8), transparent: true }));
  }

  render() {
    this.controls.update();
    this.composer.render();
  }
}

function makeGeometries() {
  const stone = new THREE.DodecahedronGeometry(1, 0);
  const geo = {
    octa: new THREE.OctahedronGeometry(1, 0),
    icosa: new THREE.IcosahedronGeometry(1, 0),
    tetra: new THREE.TetrahedronGeometry(1, 0),
    dodeca: new THREE.DodecahedronGeometry(1, 0),
    pip: new THREE.OctahedronGeometry(0.07, 0),
    pedestal: new THREE.CylinderGeometry(0.32, 0.42, 0.24, 8).translate(0, 0.12, 0),
    relicPedestal: new THREE.CylinderGeometry(0.34, 0.46, 0.34, 8).translate(0, 0.17, 0),
    pedestalMat: new THREE.MeshStandardMaterial({ color: 0x3a3f55, roughness: 0.7, metalness: 0.3, flatShading: true }),
    stone,
    stoneMat: new THREE.MeshStandardMaterial({ color: 0x6b6458, roughness: 0.95, flatShading: true }),
    candRing: new THREE.RingGeometry(0.4, 0.48, 4, 1, Math.PI / 4),
    candMat: new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    capsule: new THREE.CapsuleGeometry(0.7, 0.6, 4, 8).translate(0, 1, 0),
    cone: new THREE.ConeGeometry(0.8, 2, 6).rotateZ(0).translate(0, 0, 0),
    box: new THREE.BoxGeometry(1.5, 1.4, 1.5).translate(0, 0.7, 0),
    sphere: new THREE.SphereGeometry(1, 8, 6).translate(0, 1, 0),
    knot: new THREE.TorusKnotGeometry(0.6, 0.25, 32, 6).translate(0, 1, 0),
    spiky: new THREE.IcosahedronGeometry(1, 1).translate(0, 1, 0),
    bar: new THREE.PlaneGeometry(1, 0.09),
    barBgMat: new THREE.MeshBasicMaterial({ color: 0x220000 }),
    proj: new THREE.SphereGeometry(0.09, 8, 6),
    burst: new THREE.RingGeometry(0.85, 1, 32),
    particle: new THREE.TetrahedronGeometry(0.06, 0),
  };
  for (const v of Object.values(geo)) if (v.isMaterial) v.userData.shared = true;
  return geo;
}

function makeGridTexture() {
  const px = 64;
  const c = document.createElement('canvas');
  c.width = c.height = GRID * px;
  const ctx = c.getContext('2d');
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) {
      const shade = 34 + ((x + z) % 2) * 5 + Math.random() * 4;
      ctx.fillStyle = `rgb(${shade}, ${shade + 6}, ${shade + 22})`;
      ctx.fillRect(x * px, z * px, px, px);
    }
  }
  ctx.strokeStyle = 'rgba(140,170,255,0.12)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath(); ctx.moveTo(i * px, 0); ctx.lineTo(i * px, GRID * px); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * px); ctx.lineTo(GRID * px, i * px); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeLabelSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(text, 64, 32);
  ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
  ctx.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(1.2, 0.6, 1);
  return sp;
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
