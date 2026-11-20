import * as THREE from 'three';
import type { Pose, Row } from '../anim/motion';
import type { Model } from './models';

const rimColor = new THREE.Color();
const rimUniform = { value: new THREE.Vector3(1, 1, 1) };
const rimPowerUniform = { value: 1 };

export function setRim(hex: number, power: number): void {
  rimColor.setHex(hex);
  rimUniform.value.set(rimColor.r, rimColor.g, rimColor.b);
  rimPowerUniform.value = power;
}

// Draws every animated model in the scene with instancing: one draw call per
// kind of model, however many of it there are. The game refills the crowd
// each frame, so nothing here outlives the frame it was asked for.

const PARS = /* glsl */ `
attribute vec4 aBone;
attribute vec4 aWeight;
attribute float aUpper;
attribute float aGlow;
attribute vec4 aAnim;
attribute vec4 aLook;
uniform sampler2D uAnim;
varying vec3 vLook;

mat4 boneAt(float bone, float row) {
  int x = int(bone + 0.5) * 3;
  int y = int(row + 0.5);
  vec4 a = texelFetch(uAnim, ivec2(x, y), 0);
  vec4 b = texelFetch(uAnim, ivec2(x + 1, y), 0);
  vec4 c = texelFetch(uAnim, ivec2(x + 2, y), 0);
  return mat4(a.x, b.x, c.x, 0.0, a.y, b.y, c.y, 0.0, a.z, b.z, c.z, 0.0, a.w, b.w, c.w, 1.0);
}
mat4 poseAt(float row) {
  mat4 m = boneAt(aBone.x, row) * aWeight.x;
  if (aWeight.y > 0.0) m += boneAt(aBone.y, row) * aWeight.y;
  if (aWeight.z > 0.0) m += boneAt(aBone.z, row) * aWeight.z;
  if (aWeight.w > 0.0) m += boneAt(aBone.w, row) * aWeight.w;
  return m;
}
`;

// aAnim: row A, row B, how far from A to B, and whether B only moves the upper body.
const BASE = /* glsl */ `
mat4 pose = poseAt(aAnim.x);
float blend = aAnim.z * mix(1.0, aUpper, aAnim.w);
if (blend > 0.001) pose = pose * (1.0 - blend) + poseAt(aAnim.y) * blend;
vLook = vec3(aLook.x, aLook.y, aGlow * aLook.z);
`;

function animate(shader: { vertexShader: string; uniforms: Record<string, THREE.IUniform> }, anim: THREE.Texture): void {
  shader.uniforms.uAnim = { value: anim };
  shader.vertexShader = shader.vertexShader
    .replace('#include <skinning_pars_vertex>', PARS)
    .replace('#include <skinbase_vertex>', BASE)
    .replace('#include <skinnormal_vertex>', 'objectNormal = normalize(mat3(pose) * objectNormal);')
    .replace('#include <skinning_vertex>', 'transformed = (pose * vec4(transformed, 1.0)).xyz;');
}

// aLook: flash toward white, opacity (dithered), and how brightly the glowing parts glow.
const FRAG_PARS = /* glsl */ `
varying vec3 vLook;
`;
const FRAG = /* glsl */ `
#include <color_fragment>
if (vLook.y < 0.995) {
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (vLook.y <= dither) discard;
}
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vLook.x);
float facing = abs(normalize(vNormal).z);
float rim = pow(clamp(1.0 - facing, 0.0, 1.0), 2.0);
float line = rim * rim;
diffuseColor.rgb *= mix(1.0, 0.5, line * (1.0 - vEdge.a));
vec3 edgeCol = mix(diffuseColor.rgb, vEdge.rgb, min(1.0, vEdge.a * 1.35));
edgeCol = mix(edgeCol, uRim, 0.5);
float amt = mix(0.28, 1.15, vEdge.a) * uRimPower;
diffuseColor.rgb += vEdge.rgb * smoothstep(0.5, 1.0, vEdge.a) * 0.22;
totalEmissiveRadiance += vec3(vLook.x) * 0.7 + diffuseColor.rgb * (vLook.z + rim * 0.55) + edgeCol * rim * amt;
`;

interface Batch {
  model: Model;
  mesh: THREE.InstancedMesh;
  material: THREE.MeshLambertMaterial;
  /** Whether the batch is being drawn into the shadow map only. */
  hidden: boolean;
  n: number;
  cap: number;
  anim: THREE.InstancedBufferAttribute;
  look: THREE.InstancedBufferAttribute;
  edge: THREE.InstancedBufferAttribute;
}

export class Crowd {
  private batches = new Map<string, Batch>();
  private hidden = false;

  constructor(private scene: THREE.Scene) {}

  private make(model: Model, cap: number): Batch {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    material.onBeforeCompile = (shader) => {
      animate(shader, model.anim);
      shader.uniforms.uRim = rimUniform;
      shader.uniforms.uRimPower = rimPowerUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aEdge;\nvarying vec4 vEdge;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_PARS}\nvarying vec4 vEdge;\nuniform vec3 uRim;\nuniform float uRimPower;`)
        .replace('#include <color_fragment>', FRAG);
    };
    material.customProgramCacheKey = () => 'crowd-edge-zone';
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (shader) => {
      animate(shader, model.anim);
      // The depth shader has no use for the look, and skips instances that cast no shadow
      // (or are mostly see-through) before doing any work on them.
      shader.vertexShader = shader.vertexShader
        .replace('varying vec3 vLook;', '')
        .replace(/vLook = [^;]+;/, '')
        .replace('mat4 pose = poseAt(aAnim.x);', 'if (aLook.w < 0.5 || aLook.y < 0.5) {\n  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n  return;\n}\nmat4 pose = poseAt(aAnim.x);');
    };
    depth.customProgramCacheKey = () => 'crowd-depth';

    // The instanced attributes live on the geometry, so each batch needs its own copy of it.
    const geometry = model.geometry.clone();
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    const look = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    const edge = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    anim.setUsage(THREE.DynamicDrawUsage);
    look.setUsage(THREE.DynamicDrawUsage);
    edge.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aAnim', anim);
    geometry.setAttribute('aLook', look);
    geometry.setAttribute('aEdge', edge);
    const mesh = new THREE.InstancedMesh(geometry, material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.customDepthMaterial = depth;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    const batch: Batch = { model, mesh, material, hidden: this.hidden, n: 0, cap, anim, look, edge };
    // A batch that is hidden still has to reach the shadow map, so it is given
    // its instances back for just that part of the frame.
    mesh.onBeforeShadow = () => {
      mesh.count = batch.n;
    };
    mesh.onAfterShadow = () => {
      mesh.count = batch.hidden ? 0 : batch.n;
    };
    this.scene.add(mesh);
    return batch;
  }

  private grow(old: Batch): Batch {
    const b = this.make(old.model, old.cap * 2);
    (b.mesh.instanceMatrix.array as Float32Array).set(old.mesh.instanceMatrix.array as Float32Array);
    (b.mesh.instanceColor!.array as Float32Array).set(old.mesh.instanceColor!.array as Float32Array);
    (b.anim.array as Float32Array).set(old.anim.array as Float32Array);
    (b.look.array as Float32Array).set(old.look.array as Float32Array);
    (b.edge.array as Float32Array).set(old.edge.array as Float32Array);
    b.n = old.n;
    this.scene.remove(old.mesh);
    old.mesh.geometry.dispose();
    old.material.dispose();
    (old.mesh.customDepthMaterial as THREE.Material).dispose();
    old.mesh.dispose();
    this.batches.set(old.model.name, b);
    return b;
  }

  begin(): void {
    for (const b of this.batches.values()) b.n = 0;
  }

  /**
   * One model this frame. (x, y) is its place in the game's world, `lift` its
   * height off the ground, `yaw` the way it faces (0 is toward the viewer).
   * A lone Row costs one bone fetch per vertex; a Pose may cost two.
   */
  add(
    model: Model,
    x: number,
    y: number,
    lift: number,
    yaw: number,
    scale: number,
    stretch: number,
    anim: Pose | Row,
    tint: number,
    flash: number,
    alpha: number,
    glow: number,
    shadow: boolean,
    edge = 0x120e14,
    edgeStrength = 0,
    pitch = 0,
    wide = 1,
  ): void {
    let b = this.batches.get(model.name);
    if (!b) {
      b = this.make(model, 16);
      this.batches.set(model.name, b);
    }
    if (b.n >= b.cap) b = this.grow(b);
    const i = b.n++;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const sx = scale * wide;
    const sy = scale * stretch;
    const m = b.mesh.instanceMatrix.array as Float32Array;
    const o = i * 16;
    // Yaw, then a pitch that tips the body toward the ground. Pitch 0 stands upright.
    m[o] = sx * c;
    m[o + 1] = 0;
    m[o + 2] = -sx * s;
    m[o + 3] = 0;
    m[o + 4] = sy * sp * s;
    m[o + 5] = sy * cp;
    m[o + 6] = sy * sp * c;
    m[o + 7] = 0;
    m[o + 8] = sx * cp * s;
    m[o + 9] = -sx * sp;
    m[o + 10] = sx * cp * c;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = lift;
    m[o + 14] = y;
    m[o + 15] = 1;
    const col = b.mesh.instanceColor!.array as Float32Array;
    // Tints are written as sRGB hex; the shader works in linear light.
    col[i * 3] = LINEAR[(tint >> 16) & 255];
    col[i * 3 + 1] = LINEAR[(tint >> 8) & 255];
    col[i * 3 + 2] = LINEAR[tint & 255];
    const a = b.anim.array as Float32Array;
    if (typeof anim === 'number') {
      a[i * 4] = a[i * 4 + 1] = anim;
      a[i * 4 + 2] = a[i * 4 + 3] = 0;
    } else {
      a[i * 4] = anim.a;
      a[i * 4 + 1] = anim.b;
      a[i * 4 + 2] = anim.blend;
      a[i * 4 + 3] = anim.upper ? 1 : 0;
    }
    const l = b.look.array as Float32Array;
    l[i * 4] = flash;
    l[i * 4 + 1] = alpha;
    l[i * 4 + 2] = glow;
    l[i * 4 + 3] = shadow ? 1 : 0;
    const e = b.edge.array as Float32Array;
    e[i * 4] = LINEAR[(edge >> 16) & 255];
    e[i * 4 + 1] = LINEAR[(edge >> 8) & 255];
    e[i * 4 + 2] = LINEAR[edge & 255];
    e[i * 4 + 3] = edgeStrength;
  }

  end(): void {
    for (const b of this.batches.values()) {
      b.mesh.count = b.hidden ? 0 : b.n;
      b.mesh.visible = b.n > 0;
      if (!b.n) continue;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.instanceColor!.needsUpdate = true;
      b.anim.needsUpdate = true;
      b.look.needsUpdate = true;
      b.edge.needsUpdate = true;
    }
  }

  /** How many bodies the last fill put on the field. */
  get size(): number {
    let n = 0;
    for (const b of this.batches.values()) n += b.n;
    return n;
  }

  /** Keep the models out of the picture while still letting them cast shadows, or put them back. */
  shadowsOnly(on: boolean): void {
    this.hidden = on;
    for (const b of this.batches.values()) {
      b.hidden = on;
      b.mesh.count = on ? 0 : b.n;
    }
  }

  dispose(): void {
    for (const b of this.batches.values()) {
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.material.dispose();
      (b.mesh.customDepthMaterial as THREE.Material).dispose();
      b.mesh.dispose();
    }
    this.batches.clear();
  }
}

const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const x = i / 255;
  LINEAR[i] = x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
