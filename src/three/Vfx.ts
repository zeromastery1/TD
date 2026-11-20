import * as THREE from 'three';
import { Frame, FRAME_ID, RECTS, buildAtlas } from './atlas';

// Spell effects on the 3D stage. Three kinds of thing are drawn here, each in
// one draw call however many there are:
//
//  - sprites: soft shapes from the effect sheet, either turned to the camera,
//    lying on the ground, or stretched along the way they move. Particles are
//    sprites the layer moves by itself; the game can also place sprites for
//    one step at a time.
//  - ribbons: strips of light, for blade trails, lightning and the tails of
//    things in flight.
//
// Places are given the way the game thinks of them: (x, y) is a point on the
// ground and h a height above it.

/** Turned to face the camera. */
export const BOARD = 0;
/** Lying flat on the ground. */
export const GROUND = 1;
/** Facing the camera, drawn out along the way it moves (or along `ax, ay, ah`). */
export const STREAK = 2;

/** One particle. Everything but the frame, place, life, size and colour has a default. */
export interface Puff {
  f: Frame;
  x: number;
  y: number;
  h?: number;
  vx?: number;
  vy?: number;
  vh?: number;
  /** Pull toward the ground, in units a second each second. Negative floats upward. */
  g?: number;
  /** How quickly it slows: speed falls by this factor's exponent each second. */
  drag?: number;
  life: number;
  /** Width at birth and at death. For a streak, its thickness. */
  s0: number;
  s1?: number;
  /** Height over width. */
  ratio?: number;
  rot?: number;
  spin?: number;
  /** Colour at birth and at death. */
  c0: number;
  c1?: number;
  a?: number;
  /** The part of its life spent fading in, and the part after which it fades out. */
  in?: number;
  hold?: number;
  mode?: number;
  /** 1 adds its light to what is behind it; 0 covers it. */
  add?: number;
  /** For a streak: seconds of travel its length covers. */
  stretch?: number;
  /** For a streak that does not move: the line it is drawn along. */
  ax?: number;
  ay?: number;
  ah?: number;
  /** How much speed it keeps when it hits the ground; 0 lets it pass through. */
  bounce?: number;
  delay?: number;
}

const STRIDE = 20;
const CAP = 9000;
const PARTICLES = 6000;
const PS = 34;
const QUADS = 3600;
const VS = 10;

interface Bolt {
  x0: number;
  h0: number;
  z0: number;
  x1: number;
  h1: number;
  z1: number;
  color: number;
  width: number;
  age: number;
  max: number;
  seed: number;
  jag: number;
  forks: number;
}

interface Slash {
  x: number;
  h: number;
  z: number;
  from: number;
  sweep: number;
  r0: number;
  r1: number;
  color: number;
  age: number;
  max: number;
  /** How far the far end of the swing dips or lifts, for a cut that is not level. */
  tilt: number;
  alpha: number;
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iAxis;
attribute vec4 iShape;
attribute vec2 iBlend;
attribute vec4 iColor;
attribute vec4 iFrame;
varying vec2 vUv;
varying vec4 vColor;
varying float vAdd;
void main() {
  vec2 c = position.xy;
  float mode = iShape.w;
  float cr = cos(iShape.z);
  float sr = sin(iShape.z);
  vec4 mv;
  float vy = 1.0 - uv.y;
  if (mode < 0.5) {
    vec2 q = c * iShape.xy;
    q = vec2(q.x * cr - q.y * sr, q.x * sr + q.y * cr);
    mv = viewMatrix * vec4(iPos, 1.0);
    mv.xy += q;
  } else if (mode < 1.5) {
    vec2 q = c * iShape.xy;
    q = vec2(q.x * cr - q.y * sr, q.x * sr + q.y * cr);
    mv = viewMatrix * vec4(iPos + vec3(q.x, 0.0, q.y), 1.0);
    vy = uv.y;
  } else {
    vec3 a = mat3(viewMatrix) * iAxis;
    float len = length(a.xy);
    vec2 dir = len > 0.0001 ? a.xy / len : vec2(1.0, 0.0);
    mv = viewMatrix * vec4(iPos, 1.0);
    mv.xy += dir * (c.x * max(len, iShape.x)) + vec2(-dir.y, dir.x) * (c.y * iShape.y);
  }
  gl_Position = projectionMatrix * mv;
  vUv = iFrame.xy + vec2(uv.x, vy) * iFrame.zw;
  vColor = iColor;
  vAdd = iBlend.x;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
varying float vAdd;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(t.rgb * vColor.rgb * a, a * (1.0 - vAdd));
}
`;

const RIBBON_VERT = /* glsl */ `
attribute vec4 rColor;
attribute float rAdd;
varying vec2 vUv;
varying vec4 vColor;
varying float vAdd;
void main() {
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  vUv = uv;
  vColor = rColor;
  vAdd = rAdd;
}
`;

function rnd(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export class Vfx {
  /** Scales how many particles the recipes ask for; lowered when frames run long. */
  density = 1;

  private atlas: THREE.CanvasTexture;
  private sprites: THREE.Mesh;
  private data: Float32Array;
  private buffer: THREE.InstancedInterleavedBuffer;
  private spriteGeo: THREE.InstancedBufferGeometry;

  /** Sprites the game placed during this step, by layer. */
  private placed: Float32Array[] = [];
  private placedN = [0, 0, 0, 0];

  private p = new Float32Array(PARTICLES * PS);
  private n = 0;

  private ribbons: THREE.Mesh;
  private rdata: Float32Array;
  private rbuffer: THREE.InterleavedBuffer;
  /** Ribbon quads the game placed during this step. */
  private rplaced: Float32Array;
  private rplacedN = 0;
  private rn = 0;

  private bolts: Bolt[] = [];
  private slashes: Slash[] = [];
  private pts = new Float32Array(3 * 64);

  /** The way the camera looks, which never changes. */
  private fy: number;
  private fz: number;

  constructor(
    private scene: THREE.Scene,
    borrow: (key: string) => CanvasImageSource | null,
    squash: number,
    rise: number,
  ) {
    this.fy = -squash;
    this.fz = -rise;
    this.atlas = buildAtlas(borrow);

    for (let i = 0; i < 4; i++) this.placed.push(new Float32Array(2200 * STRIDE));
    this.data = new Float32Array(CAP * STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
    buffer.setUsage(THREE.DynamicDrawUsage);
    this.buffer = buffer;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    geo.setAttribute('iAxis', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    geo.setAttribute('iShape', new THREE.InterleavedBufferAttribute(buffer, 4, 6));
    geo.setAttribute('iBlend', new THREE.InterleavedBufferAttribute(buffer, 2, 10));
    geo.setAttribute('iColor', new THREE.InterleavedBufferAttribute(buffer, 4, 12));
    geo.setAttribute('iFrame', new THREE.InterleavedBufferAttribute(buffer, 4, 16));
    geo.instanceCount = 0;
    this.spriteGeo = geo;
    const blend = {
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
    };
    this.sprites = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ uniforms: { map: { value: this.atlas } }, vertexShader: VERT, fragmentShader: FRAG, ...blend }),
    );
    this.sprites.frustumCulled = false;
    this.sprites.renderOrder = 10;
    scene.add(this.sprites);

    this.rdata = new Float32Array(QUADS * 4 * VS);
    this.rplaced = new Float32Array(QUADS * 4 * VS);
    const rbuffer = new THREE.InterleavedBuffer(this.rdata, VS);
    rbuffer.setUsage(THREE.DynamicDrawUsage);
    this.rbuffer = rbuffer;
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.InterleavedBufferAttribute(rbuffer, 3, 0));
    rgeo.setAttribute('uv', new THREE.InterleavedBufferAttribute(rbuffer, 2, 3));
    rgeo.setAttribute('rColor', new THREE.InterleavedBufferAttribute(rbuffer, 4, 5));
    rgeo.setAttribute('rAdd', new THREE.InterleavedBufferAttribute(rbuffer, 1, 9));
    const index = new Uint16Array(QUADS * 6);
    for (let q = 0; q < QUADS; q++) index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3], q * 6);
    rgeo.setIndex(new THREE.BufferAttribute(index, 1));
    rgeo.setDrawRange(0, 0);
    this.ribbons = new THREE.Mesh(
      rgeo,
      new THREE.ShaderMaterial({ uniforms: { map: { value: this.atlas } }, vertexShader: RIBBON_VERT, fragmentShader: FRAG, ...blend }),
    );
    this.ribbons.frustumCulled = false;
    this.ribbons.renderOrder = 11;
    scene.add(this.ribbons);
  }

  /** Hide or show everything, for the pass that draws only the ground. */
  show(on: boolean): void {
    this.sprites.visible = on;
    this.ribbons.visible = on;
  }

  /** A count of particles scaled by how much the machine can take. */
  count(n: number): number {
    const k = n * this.density;
    const whole = Math.floor(k);
    return whole + (Math.random() < k - whole ? 1 : 0);
  }

  // ---- particles ----------------------------------------------------------

  emit(o: Puff): void {
    if (this.n >= PARTICLES) return;
    const p = this.p;
    const i = this.n++ * PS;
    const mode = o.mode ?? BOARD;
    const rect = RECTS[FRAME_ID[o.f]];
    p[i] = o.x;
    p[i + 1] = o.h ?? 0;
    p[i + 2] = o.y;
    p[i + 3] = o.vx ?? 0;
    p[i + 4] = o.vh ?? 0;
    p[i + 5] = o.vy ?? 0;
    p[i + 6] = o.g ?? 0;
    p[i + 7] = o.drag ?? 0;
    p[i + 8] = 0;
    p[i + 9] = o.life;
    p[i + 10] = o.s0;
    p[i + 11] = o.s1 ?? o.s0;
    // Frames keep their own shape unless told otherwise. (The sheet is twice as wide as it is tall.)
    p[i + 12] = o.ratio ?? (rect[3] / (rect[2] * 2) || 1);
    p[i + 13] = o.rot ?? 0;
    p[i + 14] = o.spin ?? 0;
    const c0 = o.c0;
    const c1 = o.c1 ?? c0;
    p[i + 15] = ((c0 >> 16) & 255) / 255;
    p[i + 16] = ((c0 >> 8) & 255) / 255;
    p[i + 17] = (c0 & 255) / 255;
    p[i + 18] = ((c1 >> 16) & 255) / 255;
    p[i + 19] = ((c1 >> 8) & 255) / 255;
    p[i + 20] = (c1 & 255) / 255;
    p[i + 21] = o.a ?? 1;
    p[i + 22] = o.in ?? 0;
    p[i + 23] = o.hold ?? 0;
    p[i + 24] = FRAME_ID[o.f];
    p[i + 25] = mode;
    p[i + 26] = o.add ?? 1;
    p[i + 27] = o.stretch ?? 0;
    p[i + 28] = o.bounce ?? 0;
    p[i + 29] = o.delay ?? 0;
    p[i + 30] = o.ax ?? 0;
    p[i + 31] = o.ah ?? 0;
    p[i + 32] = o.ay ?? 0;
    p[i + 33] = 0;
  }

  // ---- sprites placed for one step ------------------------------------------

  /** A sprite for this step only. `w` and `hgt` are its size; on the ground, `rot` turns it. */
  sprite(f: Frame, x: number, y: number, h: number, w: number, hgt: number, rot: number, color: number, alpha: number, mode = BOARD, add = 1): void {
    const layer = (mode === GROUND ? 0 : 2) + (add > 0.5 ? 1 : 0);
    const n = this.placedN[layer];
    const d = this.placed[layer];
    if ((n + 1) * STRIDE > d.length) return;
    this.placedN[layer] = n + 1;
    const o = n * STRIDE;
    const rect = RECTS[FRAME_ID[f]];
    d[o] = x;
    d[o + 1] = h;
    d[o + 2] = y;
    d[o + 3] = 0;
    d[o + 4] = 0;
    d[o + 5] = 0;
    d[o + 6] = w;
    d[o + 7] = hgt;
    d[o + 8] = rot;
    d[o + 9] = mode;
    d[o + 10] = add;
    d[o + 11] = 0;
    d[o + 12] = ((color >> 16) & 255) / 255;
    d[o + 13] = ((color >> 8) & 255) / 255;
    d[o + 14] = (color & 255) / 255;
    d[o + 15] = alpha;
    d[o + 16] = rect[0];
    d[o + 17] = rect[1];
    d[o + 18] = rect[2];
    d[o + 19] = rect[3];
  }

  /** A sprite drawn out from one point to another, for this step only. */
  beam(f: Frame, x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, width: number, color: number, alpha: number, add = 1): void {
    const layer = 2 + (add > 0.5 ? 1 : 0);
    const n = this.placedN[layer];
    const d = this.placed[layer];
    if ((n + 1) * STRIDE > d.length) return;
    this.sprite(f, (x0 + x1) / 2, (y0 + y1) / 2, (h0 + h1) / 2, 0, width, 0, color, alpha, STREAK, add);
    const o = n * STRIDE;
    d[o + 3] = x1 - x0;
    d[o + 4] = h1 - h0;
    d[o + 5] = y1 - y0;
  }

  // ---- ribbons --------------------------------------------------------------

  private vert(d: Float32Array, o: number, x: number, h: number, z: number, u: number, v: number, r: number, g: number, b: number, a: number, add: number): void {
    d[o] = x;
    d[o + 1] = h;
    d[o + 2] = z;
    d[o + 3] = u;
    d[o + 4] = v;
    d[o + 5] = r;
    d[o + 6] = g;
    d[o + 7] = b;
    d[o + 8] = a;
    d[o + 9] = add;
  }

  /**
   * A strip of light through `n` points (x, h, z triples in `pts`), turned to the camera.
   * Width and alpha run from the first point's to the last's.
   */
  private strip(d: Float32Array, at: number, pts: ArrayLike<number>, n: number, w0: number, w1: number, color: number, a0: number, a1: number, f: Frame, add: number): number {
    if (n < 2) return at;
    const rect = RECTS[FRAME_ID[f]];
    const r = ((color >> 16) & 255) / 255;
    const g = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    const fy = this.fy;
    const fz = this.fz;
    let plx = 0;
    let plh = 0;
    let plz = 0;
    let prx = 0;
    let prh = 0;
    let prz = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1) * 3;
      const c = Math.min(n - 1, i + 1) * 3;
      const tx = pts[c] - pts[a];
      const th = pts[c + 1] - pts[a + 1];
      const tz = pts[c + 2] - pts[a + 2];
      // Across the strip: at right angles to both its run and the camera's line of sight.
      let sx = th * fz - tz * fy;
      let sh = -tx * fz;
      let sz = tx * fy;
      const sl = Math.hypot(sx, sh, sz) || 1;
      const k = i / (n - 1);
      const half = (w0 + (w1 - w0) * k) / 2 / sl;
      sx *= half;
      sh *= half;
      sz *= half;
      const x = pts[i * 3];
      const h = pts[i * 3 + 1];
      const z = pts[i * 3 + 2];
      const lx = x + sx;
      const lh = h + sh;
      const lz = z + sz;
      const rx = x - sx;
      const rh = h - sh;
      const rz = z - sz;
      if (i > 0) {
        if (at >= QUADS) return at;
        const o = at * 4 * VS;
        const k0 = (i - 1) / (n - 1);
        const al0 = a0 + (a1 - a0) * k0;
        const al1 = a0 + (a1 - a0) * k;
        const u0 = rect[0] + rect[2] * k0;
        const u1 = rect[0] + rect[2] * k;
        this.vert(d, o, plx, plh, plz, u0, rect[1], r, g, b, al0, add);
        this.vert(d, o + VS, prx, prh, prz, u0, rect[1] + rect[3], r, g, b, al0, add);
        this.vert(d, o + VS * 2, lx, lh, lz, u1, rect[1], r, g, b, al1, add);
        this.vert(d, o + VS * 3, rx, rh, rz, u1, rect[1] + rect[3], r, g, b, al1, add);
        at++;
      }
      plx = lx;
      plh = lh;
      plz = lz;
      prx = rx;
      prh = rh;
      prz = rz;
    }
    return at;
  }

  /** A strip of light through points, for this step only. `pts` holds x, y, h for each point. */
  path(pts: ArrayLike<number>, n: number, w0: number, w1: number, color: number, a0: number, a1: number, f: Frame = 'beam', add = 1): void {
    const s = this.pts.length >= n * 3 ? this.pts : (this.pts = new Float32Array(n * 3));
    for (let i = 0; i < n; i++) {
      s[i * 3] = pts[i * 3];
      s[i * 3 + 1] = pts[i * 3 + 2];
      s[i * 3 + 2] = pts[i * 3 + 1];
    }
    this.rplacedN = this.strip(this.rplaced, this.rplacedN, s, n, w0, w1, color, a0, a1, f, add);
  }

  /**
   * Part of a flat ring about (x, y) at height h, from angle a0 to a1 and radius r0 to r1.
   * Alpha runs from `alpha0` at a0 to `alpha1` at a1. The frame's top edge goes to the outside.
   */
  private fan(d: Float32Array, at: number, x: number, h: number, z: number, r0: number, r1: number, a0: number, a1: number, color: number, alpha0: number, alpha1: number, f: Frame, add: number, tilt: number): number {
    const rect = RECTS[FRAME_ID[f]];
    const r = ((color >> 16) & 255) / 255;
    const g = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    const segs = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.14));
    for (let i = 0; i < segs; i++) {
      if (at >= QUADS) return at;
      const k0 = i / segs;
      const k1 = (i + 1) / segs;
      const b0 = a0 + (a1 - a0) * k0;
      const b1 = a0 + (a1 - a0) * k1;
      const c0 = Math.cos(b0);
      const s0 = Math.sin(b0);
      const c1 = Math.cos(b1);
      const s1 = Math.sin(b1);
      const h0 = h + tilt * (k0 - 0.5);
      const h1 = h + tilt * (k1 - 0.5);
      const al0 = alpha0 + (alpha1 - alpha0) * k0;
      const al1 = alpha0 + (alpha1 - alpha0) * k1;
      const u0 = rect[0] + rect[2] * k0;
      const u1 = rect[0] + rect[2] * k1;
      const o = at * 4 * VS;
      this.vert(d, o, x + c0 * r1, h0, z + s0 * r1, u0, rect[1], r, g, b, al0, add);
      this.vert(d, o + VS, x + c0 * r0, h0, z + s0 * r0, u0, rect[1] + rect[3], r, g, b, al0, add);
      this.vert(d, o + VS * 2, x + c1 * r1, h1, z + s1 * r1, u1, rect[1], r, g, b, al1, add);
      this.vert(d, o + VS * 3, x + c1 * r0, h1, z + s1 * r0, u1, rect[1] + rect[3], r, g, b, al1, add);
      at++;
    }
    return at;
  }

  /** Part of a flat ring of light, for this step only. */
  arc(x: number, y: number, h: number, r0: number, r1: number, a0: number, a1: number, color: number, alpha0: number, alpha1: number, f: Frame = 'edge', add = 1, tilt = 0): void {
    this.rplacedN = this.fan(this.rplaced, this.rplacedN, x, h, y, r0, r1, a0, a1, color, alpha0, alpha1, f, add, tilt);
  }

  // ---- ribbons that play out by themselves ----------------------------------

  /** Lightning between two points: it flickers for `life` seconds and is gone. */
  bolt(x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, color: number, width = 5, life = 0.22, jag = 26, forks = 1): void {
    if (this.bolts.length > 60) this.bolts.shift();
    this.bolts.push({ x0, h0, z0: y0, x1, h1, z1: y1, color, width, age: 0, max: life, seed: (Math.random() * 1e9) | 0, jag, forks });
  }

  /**
   * The trail of a blade swung about (x, y): from angle `from` through `sweep` radians,
   * reaching from r0 out to r1. Angles are the game's: 0 is to the right, and they turn toward the viewer.
   */
  slash(x: number, y: number, h: number, from: number, sweep: number, r0: number, r1: number, color: number, life = 0.26, tilt = 0, alpha = 1): void {
    if (this.slashes.length > 40) this.slashes.shift();
    this.slashes.push({ x, h, z: y, from, sweep, r0, r1, color, age: 0, max: life, tilt, alpha });
  }

  // ---- the frame ------------------------------------------------------------

  /** Forget what the game placed during the last step. */
  begin(): void {
    this.placedN[0] = this.placedN[1] = this.placedN[2] = this.placedN[3] = 0;
    this.rplacedN = 0;
  }

  /** Move the particles on by `dt` seconds. */
  tick(dt: number): void {
    const p = this.p;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * PS;
      if (p[o + 29] > 0) {
        p[o + 29] -= dt;
      } else {
        p[o + 8] += dt;
        if (p[o + 8] >= p[o + 9]) continue;
        const drag = p[o + 7];
        if (drag) {
          const k = Math.exp(-drag * dt);
          p[o + 3] *= k;
          p[o + 4] *= k;
          p[o + 5] *= k;
        }
        p[o + 4] -= p[o + 6] * dt;
        p[o] += p[o + 3] * dt;
        p[o + 1] += p[o + 4] * dt;
        p[o + 2] += p[o + 5] * dt;
        if (p[o + 1] < 0 && p[o + 28] > 0) {
          p[o + 1] = -p[o + 1] * p[o + 28];
          p[o + 4] = -p[o + 4] * p[o + 28];
          p[o + 3] *= 0.6;
          p[o + 5] *= 0.6;
        }
        p[o + 13] += p[o + 14] * dt;
      }
      if (w !== i) p.copyWithin(w * PS, o, o + PS);
      w++;
    }
    this.n = w;

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += dt;
      if (b.age >= b.max) this.bolts.splice(i, 1);
    }
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.age += dt;
      if (s.age >= s.max) this.slashes.splice(i, 1);
    }
  }

  /** Hand everything to the graphics card. Call once a frame, after the last step. */
  end(): void {
    // Sprites go down in four layers: on the ground covering, on the ground glowing,
    // in the air covering, in the air glowing.
    const p = this.p;
    const counts = [this.placedN[0], this.placedN[1], this.placedN[2], this.placedN[3]];
    for (let i = 0; i < this.n; i++) {
      const o = i * PS;
      if (p[o + 29] > 0) continue;
      counts[(p[o + 25] === GROUND ? 0 : 2) + (p[o + 26] > 0.5 ? 1 : 0)]++;
    }
    const at = [0, 0, 0, 0];
    let total = 0;
    for (let l = 0; l < 4; l++) {
      at[l] = total;
      total += counts[l];
    }
    const d = this.data;
    const room = CAP;
    for (let l = 0; l < 4; l++) {
      const n = Math.min(this.placedN[l], Math.max(0, room - at[l]));
      d.set(this.placed[l].subarray(0, n * STRIDE), at[l] * STRIDE);
      at[l] += n;
    }
    for (let i = 0; i < this.n; i++) {
      const o = i * PS;
      if (p[o + 29] > 0) continue;
      const mode = p[o + 25];
      const l = (mode === GROUND ? 0 : 2) + (p[o + 26] > 0.5 ? 1 : 0);
      const slot = at[l]++;
      if (slot >= room) continue;
      const q = slot * STRIDE;
      const t = p[o + 8] / p[o + 9];
      const ease = 1 - (1 - t) * (1 - t);
      const size = p[o + 10] + (p[o + 11] - p[o + 10]) * ease;
      const fadeIn = p[o + 22];
      const hold = p[o + 23];
      let alpha = p[o + 21];
      if (fadeIn > 0 && t < fadeIn) alpha *= t / fadeIn;
      if (t > hold) alpha *= 1 - (t - hold) / (1 - hold);
      d[q] = p[o];
      d[q + 1] = p[o + 1];
      d[q + 2] = p[o + 2];
      if (mode === STREAK) {
        const stretch = p[o + 27];
        if (stretch > 0) {
          d[q + 3] = p[o + 3] * stretch;
          d[q + 4] = p[o + 4] * stretch;
          d[q + 5] = p[o + 5] * stretch;
        } else {
          d[q + 3] = p[o + 30];
          d[q + 4] = p[o + 31];
          d[q + 5] = p[o + 32];
        }
        // Never shorter than it is thick, so a slow spark is still a dot.
        d[q + 6] = size;
        d[q + 7] = size;
      } else {
        d[q + 3] = d[q + 4] = d[q + 5] = 0;
        d[q + 6] = size;
        d[q + 7] = size * p[o + 12];
      }
      d[q + 8] = p[o + 13];
      d[q + 9] = mode;
      d[q + 10] = p[o + 26];
      d[q + 11] = 0;
      d[q + 12] = p[o + 15] + (p[o + 18] - p[o + 15]) * t;
      d[q + 13] = p[o + 16] + (p[o + 19] - p[o + 16]) * t;
      d[q + 14] = p[o + 17] + (p[o + 20] - p[o + 17]) * t;
      d[q + 15] = alpha;
      const rect = RECTS[p[o + 24]];
      d[q + 16] = rect[0];
      d[q + 17] = rect[1];
      d[q + 18] = rect[2];
      d[q + 19] = rect[3];
    }
    const drawn = Math.min(total, room);
    this.spriteGeo.instanceCount = drawn;
    if (drawn) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(0, drawn * STRIDE);
      this.buffer.needsUpdate = true;
    }

    // Ribbons: what the game placed, then the ones that play out by themselves.
    const r = this.rdata;
    r.set(this.rplaced.subarray(0, this.rplacedN * 4 * VS));
    let n = this.rplacedN;
    for (const b of this.bolts) n = this.drawBolt(b, n);
    for (const s of this.slashes) n = this.drawSlash(s, n);
    this.rn = n;
    this.ribbons.geometry.setDrawRange(0, n * 6);
    if (n) {
      this.rbuffer.clearUpdateRanges();
      this.rbuffer.addUpdateRange(0, n * 4 * VS);
      this.rbuffer.needsUpdate = true;
    }
  }

  private drawBolt(b: Bolt, at: number): number {
    const t = b.age / b.max;
    // It crackles: a fresh path every few hundredths of a second.
    const seed = b.seed + Math.floor(b.age / 0.045) * 7919;
    const fade = t < 0.25 ? 1 : 1 - (t - 0.25) / 0.75;
    const dx = b.x1 - b.x0;
    const dh = b.h1 - b.h0;
    const dz = b.z1 - b.z0;
    const len = Math.hypot(dx, dh, dz);
    if (len < 1) return at;
    const n = Math.max(4, Math.min(18, Math.round(len / 34)));
    // Wander off the straight line across the camera's view, pinned at both ends.
    let sx = dh * this.fz - dz * this.fy;
    let sh = -dx * this.fz;
    let sz = dx * this.fy;
    const sl = Math.hypot(sx, sh, sz) || 1;
    sx /= sl;
    sh /= sl;
    sz /= sl;
    const pts = this.pts;
    const jag = Math.min(b.jag, len * 0.2);
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const off = i === 0 || i === n ? 0 : (rnd(seed + i * 131) * 2 - 1) * jag * (0.45 + 0.55 * Math.sin(k * Math.PI));
      pts[i * 3] = b.x0 + dx * k + sx * off;
      pts[i * 3 + 1] = b.h0 + dh * k + sh * off;
      pts[i * 3 + 2] = b.z0 + dz * k + sz * off;
    }
    const w = b.width * (0.6 + 0.4 * fade);
    at = this.strip(this.rdata, at, pts, n + 1, w * 7, w * 7, b.color, 0.3 * fade, 0.3 * fade, 'beam', 1);
    at = this.strip(this.rdata, at, pts, n + 1, w * 2.6, w * 2.6, b.color, 0.9 * fade, 0.9 * fade, 'beam', 1);
    at = this.strip(this.rdata, at, pts, n + 1, w, w, 0xffffff, fade, fade, 'beam', 1);
    // Forks leave the main stroke partway along and die out.
    for (let f = 0; f < b.forks; f++) {
      const from = 1 + Math.floor(rnd(seed + 977 * (f + 1)) * (n - 2));
      const m = 4;
      const bx = pts[from * 3];
      const bh = pts[from * 3 + 1];
      const bz = pts[from * 3 + 2];
      const side = rnd(seed + 311 * (f + 1)) < 0.5 ? -1 : 1;
      const reach = len * (0.16 + 0.16 * rnd(seed + 71 * (f + 1)));
      const fork = this.fork;
      for (let i = 0; i <= m; i++) {
        const k = i / m;
        const off = (rnd(seed + f * 53 + i * 17) * 2 - 1) * jag * 0.5 * k;
        fork[i * 3] = bx + (dx / len) * reach * k + sx * (side * reach * 0.6 * k + off);
        fork[i * 3 + 1] = bh + (dh / len) * reach * k + sh * (side * reach * 0.6 * k + off);
        fork[i * 3 + 2] = bz + (dz / len) * reach * k + sz * (side * reach * 0.6 * k + off);
      }
      at = this.strip(this.rdata, at, fork, m + 1, w * 2, w * 0.6, b.color, 0.8 * fade, 0, 'beam', 1);
      at = this.strip(this.rdata, at, fork, m + 1, w * 0.7, w * 0.2, 0xffffff, 0.9 * fade, 0, 'beam', 1);
    }
    return at;
  }

  private fork = new Float32Array(3 * 8);

  private drawSlash(s: Slash, at: number): number {
    const t = s.age / s.max;
    // The blade's edge races through the arc in the first half; its trail then closes up behind it.
    const head = 1 - Math.pow(1 - Math.min(1, t / 0.5), 3);
    const tail = t < 0.3 ? 0 : Math.pow((t - 0.3) / 0.7, 1.5);
    if (head - tail < 0.01) return at;
    const a0 = s.from + s.sweep * tail;
    const a1 = s.from + s.sweep * head;
    const fade = (t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6) * s.alpha;
    at = this.fan(this.rdata, at, s.x, s.h, s.z, s.r0, s.r1, a0, a1, s.color, 0, 0.85 * fade, 'edge', 1, s.tilt * (head - tail));
    // A hard white line along the very edge.
    at = this.fan(this.rdata, at, s.x, s.h, s.z, s.r1 * 0.9, s.r1 * 1.02, a0, a1, 0xffffff, 0, fade, 'beam', 1, s.tilt * (head - tail));
    return at;
  }

  dispose(): void {
    this.scene.remove(this.sprites, this.ribbons);
    this.spriteGeo.dispose();
    (this.sprites.material as THREE.Material).dispose();
    this.ribbons.geometry.dispose();
    (this.ribbons.material as THREE.Material).dispose();
    this.atlas.dispose();
  }

  /** For the test: how much is in the air. */
  get size(): number {
    return this.n + this.placedN[0] + this.placedN[1] + this.placedN[2] + this.placedN[3] + this.rn;
  }
}

export type { Frame };
