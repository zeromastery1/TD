import * as THREE from 'three';
import { Mask, parseMask } from '../anim/motion';

// Compiled models (see tools/models). Each is one vertex-coloured mesh whose
// animation is a table of bone matrices: one row per frame, three texels per
// bone. The crowd shader reads a row for every instance, so nothing is
// animated on the CPU.

export interface Clip {
  /** First row of the clip in the animation table. */
  row: number;
  frames: number;
  loop: boolean;
  /** Seconds the clip takes at its natural speed. */
  dur: number;
}

export interface Model {
  name: string;
  geometry: THREE.BufferGeometry;
  anim: THREE.DataTexture;
  clips: Record<string, Clip>;
  mask: Mask | null;
  /** Size in world units in the first frame of the first clip. */
  height: number;
  width: number;
}

interface Header {
  v: number;
  name: string;
  verts: number;
  tris: number;
  bones: number;
  rows: number;
  bigIndex: boolean;
  posMin: [number, number, number];
  posSize: [number, number, number];
  height: number;
  width: number;
  clips: Record<string, Clip>;
  parts: Record<string, [number, number]>;
}

const files = import.meta.glob('./data/*.bin', { query: '?url', eager: true, import: 'default' }) as Record<string, string>;
const MODELS = new Map<string, Model>();

async function bytesOf(url: string): Promise<Uint8Array> {
  // Single-file builds carry the models as data URLs; decode those by hand so
  // that a page which may not fetch can still load them.
  if (url.startsWith('data:')) {
    const text = atob(url.slice(url.indexOf(',') + 1));
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
    return out;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function decode(bytes: Uint8Array): Model {
  if (bytes[0] !== 0x45 || bytes[1] !== 0x4d || bytes[2] !== 0x44 || bytes[3] !== 0x4c) throw new Error('not a model file');
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const headLen = new DataView(buf).getUint32(4, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headLen))) as Header;
  const base = 8 + headLen;
  const at = (name: string) => base + h.parts[name][0];
  const n = h.verts;

  const p16 = new Int16Array(buf, at('pos'), n * 3);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = ((p16[i] + 32768) / 65535) * h.posSize[i % 3] + h.posMin[i % 3];
  const n8 = new Int8Array(buf, at('nrm'), n * 4);
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) nrm[i * 3 + k] = n8[i * 4 + k] / 127;
  const c8 = new Uint8Array(buf, at('col'), n * 4);
  const col = new Float32Array(n * 3);
  const glow = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) col[i * 3 + k] = srgbToLinear(c8[i * 4 + k]);
    glow[i] = c8[i * 4 + 3];
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1, true));
  g.setAttribute('aBone', new THREE.BufferAttribute(new Uint8Array(buf, at('skinI'), n * 4), 4, false));
  g.setAttribute('aWeight', new THREE.BufferAttribute(new Uint8Array(buf, at('skinW'), n * 4), 4, true));
  const upper = new Uint8Array(buf, at('upper'), n);
  g.setAttribute('aUpper', new THREE.BufferAttribute(upper, 1, true));
  const count = h.tris * 3;
  g.setIndex(new THREE.BufferAttribute(h.bigIndex ? new Uint32Array(buf, at('idx'), count) : new Uint16Array(buf, at('idx'), count), 1));

  const anim = new THREE.DataTexture(new Uint16Array(buf, at('anim'), h.bones * 12 * h.rows), h.bones * 3, h.rows, THREE.RGBAFormat, THREE.HalfFloatType);
  anim.minFilter = anim.magFilter = THREE.NearestFilter;
  anim.generateMipmaps = false;
  anim.needsUpdate = true;
  return { name: h.name, geometry: g, anim, clips: h.clips, mask: parseMask(upper), height: h.height, width: h.width };
}

let loading: Promise<void> | null = null;

/** Fetch and unpack every model. Safe to call more than once. */
export function loadModels(): Promise<void> {
  loading ??= Promise.all(
    Object.entries(files).map(async ([path, url]) => {
      const model = decode(await bytesOf(url));
      MODELS.set(path.slice(path.lastIndexOf('/') + 1, -4), model);
    }),
  ).then(() => undefined);
  return loading;
}

export function modelsReady(): boolean {
  return MODELS.size > 0 && MODELS.size === Object.keys(files).length;
}

export function model(name: string): Model {
  const m = MODELS.get(name);
  if (!m) throw new Error(`model ${name} is not loaded`);
  return m;
}