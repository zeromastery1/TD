import { FLAME, SMOKE } from './atlas';
import type { Stage } from './Stage';
import { BOARD, GROUND, STREAK } from './Vfx';

// The building blocks spells are made of on the 3D stage: a spray of sparks,
// a roll of smoke, a ring racing over the ground, a whole explosion. Places
// are a point on the ground (x, y) and a height h above it.

const TAU = Math.PI * 2;

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** A colour partway between two others. */
export function mix(a: number, b: number, k: number): number {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** The three colours a burst of something runs through: white-hot, its own, and the dying edge. */
export interface Tone {
  hot: number;
  mid: number;
  deep: number;
}

export function tone(color: number): Tone {
  return { hot: mix(color, 0xffffff, 0.68), mid: color, deep: mix(color, 0x000000, 0.45) };
}

export const FIRE: Tone = { hot: 0xfff3c4, mid: 0xff9a2e, deep: 0xc0300f };
export const HOLY: Tone = { hot: 0xffffff, mid: 0xffe9a0, deep: 0xe0a030 };
export const STORM: Tone = { hot: 0xffffff, mid: 0x8fd4ff, deep: 0x3a78e0 };
export const FROST: Tone = { hot: 0xffffff, mid: 0xb4e6ff, deep: 0x4a94d8 };
export const POISON: Tone = { hot: 0xf0ffc0, mid: 0x9be04a, deep: 0x2f8f3a };
export const ARCANE: Tone = { hot: 0xffffff, mid: 0xd49bff, deep: 0x7a3fe0 };
export const SPIRIT: Tone = { hot: 0xffffff, mid: 0x7ff0d8, deep: 0x2aa890 };
export const EARTH: Tone = { hot: 0xfff0d0, mid: 0xc9a476, deep: 0x6b5a48 };

/** Sparks thrown out in every direction, falling and skipping off the ground. */
export function sparks(st: Stage, x: number, y: number, h: number, color: number, n: number, speed = 380, size = 7, life = 0.5): void {
  const v = st.vfx;
  const hot = mix(color, 0xffffff, 0.7);
  for (let i = v.count(n); i > 0; i--) {
    const a = rand(0, TAU);
    const up = rand(-0.15, 1);
    const s = speed * rand(0.3, 1);
    const flat = Math.sqrt(Math.max(0, 1 - up * up * 0.6));
    v.emit({
      f: 'streak',
      mode: STREAK,
      x,
      y,
      h,
      vx: Math.cos(a) * s * flat,
      vy: Math.sin(a) * s * flat,
      vh: s * up * 0.9 + 60,
      g: 1150,
      drag: 1.4,
      life: life * rand(0.5, 1.15),
      s0: size * rand(0.7, 1.2),
      s1: size * 0.25,
      c0: hot,
      c1: color,
      stretch: 0.06,
      bounce: 0.42,
      hold: 0.55,
    });
  }
}

/** Sparks thrown mostly one way, as off a blow. (dx, dy) need not be a unit vector. */
export function spray(st: Stage, x: number, y: number, h: number, dx: number, dy: number, color: number, n: number, speed = 420, spread = 0.7, size = 7): void {
  const v = st.vfx;
  const hot = mix(color, 0xffffff, 0.7);
  const base = Math.atan2(dy, dx);
  for (let i = v.count(n); i > 0; i--) {
    const a = base + rand(-spread, spread);
    const s = speed * rand(0.35, 1);
    v.emit({
      f: 'streak',
      mode: STREAK,
      x,
      y,
      h,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      vh: s * rand(-0.1, 0.7),
      g: 1150,
      drag: 1.6,
      life: rand(0.22, 0.5),
      s0: size * rand(0.7, 1.2),
      s1: size * 0.25,
      c0: hot,
      c1: color,
      stretch: 0.06,
      bounce: 0.42,
      hold: 0.55,
    });
  }
}

/** Smoke that rolls up and thins out. `spread` is how far from the point it may start. */
export function smoke(st: Stage, x: number, y: number, h: number, n: number, size: number, color = 0x1d1a1f, alpha = 0.5, spread = 0, rise = 70, delay = 0): void {
  const v = st.vfx;
  for (let i = v.count(n); i > 0; i--) {
    const a = rand(0, TAU);
    const d = spread * Math.sqrt(Math.random());
    v.emit({
      f: SMOKE[(Math.random() * 4) | 0],
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d,
      h: h + rand(0, size * 0.3),
      vx: Math.cos(a) * rand(10, 60),
      vy: Math.sin(a) * rand(10, 60),
      vh: rise * rand(0.6, 1.4),
      drag: 1.2,
      life: rand(0.7, 1.3),
      s0: size * rand(0.5, 0.8),
      s1: size * rand(1.5, 2.2),
      rot: rand(0, TAU),
      spin: rand(-0.9, 0.9),
      c0: color,
      a: alpha,
      in: 0.15,
      hold: 0.3,
      add: 0,
      delay: delay + rand(0, 0.08),
    });
  }
}

/** A cloud of coloured vapour that glows a little, for magic and for what the dead leave. */
export function vapour(st: Stage, x: number, y: number, h: number, color: number, n: number, size = 34, speed = 150, alpha = 0.7): void {
  const v = st.vfx;
  const pale = mix(color, 0xffffff, 0.35);
  for (let i = v.count(n); i > 0; i--) {
    const a = rand(0, TAU);
    const s = speed * rand(0.2, 1);
    v.emit({
      f: SMOKE[(Math.random() * 4) | 0],
      x,
      y,
      h: h + rand(-8, 8),
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      vh: rand(20, 110),
      drag: 3.2,
      life: rand(0.35, 0.7),
      s0: size * rand(0.5, 0.9),
      s1: size * rand(1.3, 1.9),
      rot: rand(0, TAU),
      spin: rand(-1.5, 1.5),
      c0: pale,
      c1: color,
      a: alpha,
      in: 0.1,
      hold: 0.25,
      add: 0.55,
    });
  }
}

/** Licks of flame that leap up and shrink away. */
export function flames(st: Stage, x: number, y: number, h: number, n: number, size: number, t: Tone = FIRE, spread = 0, push = 0, rise = 130, delay = 0): void {
  const v = st.vfx;
  for (let i = v.count(n); i > 0; i--) {
    const a = rand(0, TAU);
    const d = spread * Math.sqrt(Math.random());
    const out = push * rand(0.3, 1);
    v.emit({
      f: FLAME[(Math.random() * 4) | 0],
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d,
      h: h + size * 0.3,
      vx: Math.cos(a) * out,
      vy: Math.sin(a) * out,
      vh: rise * rand(0.6, 1.3),
      drag: 2.2,
      life: rand(0.28, 0.55),
      s0: size * rand(0.75, 1.15),
      s1: size * 0.35,
      rot: rand(-0.3, 0.3),
      spin: rand(-0.6, 0.6),
      c0: mix(t.hot, t.mid, 0.5),
      c1: t.deep,
      a: 0.8,
      in: 0.08,
      hold: 0.35,
      add: 0.7,
      delay: delay + rand(0, 0.06),
    });
  }
}

/** A burst of light at a point, with a glint across it. */
export function flash(st: Stage, x: number, y: number, h: number, size: number, color: number, life = 0.14): void {
  const v = st.vfx;
  v.emit({ f: 'dot', x, y, h, life, s0: size * 0.5, s1: size * 1.1, c0: 0xffffff, c1: color, a: 0.95, hold: 0.2 });
  v.emit({ f: 'flare', x, y, h, life: life * 1.4, s0: size * 1.5, s1: size * 0.6, c0: 0xffffff, c1: color, a: 0.6, hold: 0.1, rot: rand(-0.2, 0.2) });
}

/** A ring that races out over the ground. */
export function ring(st: Stage, x: number, y: number, r0: number, r1: number, life: number, color: number, alpha = 0.9, hard = false, h = 1): void {
  st.vfx.emit({ f: hard ? 'shock' : 'ring', mode: GROUND, x, y, h, life, s0: r0 * 2, s1: r1 * 2, ratio: 1, c0: mix(color, 0xffffff, 0.4), c1: color, a: alpha, hold: 0.35 });
}

/** Light lying on the ground for a moment. */
export function pool(st: Stage, x: number, y: number, r: number, color: number, life = 0.4, alpha = 0.6): void {
  st.vfx.emit({ f: 'dot', mode: GROUND, x, y, h: 0.6, life, s0: r * 1.6, s1: r * 2.4, ratio: 1, c0: color, a: alpha, in: 0.05, hold: 0.25 });
}

/** A shaft of light standing on a point. */
export function pillar(st: Stage, x: number, y: number, height: number, width: number, color: number, life = 0.35, alpha = 0.8): void {
  const v = st.vfx;
  v.emit({ f: 'beam', mode: STREAK, x, y, h: height / 2, ah: height, life, s0: width, s1: width * 0.2, c0: 0xffffff, c1: color, a: alpha, hold: 0.2 });
  v.emit({ f: 'beam', mode: STREAK, x, y, h: height / 2, ah: height, life: life * 1.3, s0: width * 2.6, s1: width * 0.8, c0: color, a: alpha * 0.45, hold: 0.2 });
}

/** Motes of light drifting up out of the ground inside a circle. */
export function motes(st: Stage, x: number, y: number, r: number, color: number, n: number, rise = 90, size = 7): void {
  const v = st.vfx;
  for (let i = v.count(n); i > 0; i--) {
    const a = rand(0, TAU);
    const d = r * Math.sqrt(Math.random());
    v.emit({
      f: 'core',
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d,
      h: rand(2, 20),
      vx: rand(-12, 12),
      vy: rand(-12, 12),
      vh: rise * rand(0.5, 1.3),
      life: rand(0.6, 1.2),
      s0: size * rand(0.6, 1.2),
      s1: size * 0.2,
      c0: mix(color, 0xffffff, 0.5),
      c1: color,
      a: 0.95,
      in: 0.15,
      hold: 0.5,
    });
  }
}

/** Flat chips (ice, glass, leaves) thrown out and tumbling down. */
export function chips(st: Stage, x: number, y: number, h: number, color: number, n: number, speed = 300, size = 10, frame: 'shard' | 'leaf' | 'feather' | 'drop' | 'bubble' = 'shard'): void {
  const v = st.vfx;
  for (let i = v.count(n); i > 0; i--) {
    const a = rand(0, TAU);
    const s = speed * rand(0.3, 1);
    v.emit({
      f: frame,
      x,
      y,
      h,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      vh: s * rand(0.3, 1.1),
      g: 1000,
      drag: 1,
      life: rand(0.4, 0.8),
      s0: size * rand(0.6, 1.3),
      s1: size * 0.5,
      rot: rand(0, TAU),
      spin: rand(-12, 12),
      c0: mix(color, 0xffffff, 0.5),
      c1: color,
      a: 1,
      hold: 0.6,
      add: 0.5,
      bounce: 0.3,
    });
  }
}

/** Dust kicked up along the ground. */
export function dust(st: Stage, x: number, y: number, n: number, size = 26, color = 0xa89c8a, alpha = 0.32, push = 60): void {
  const v = st.vfx;
  for (let i = v.count(n); i > 0; i--) {
    const a = rand(0, TAU);
    v.emit({
      f: SMOKE[(Math.random() * 4) | 0],
      x,
      y,
      h: rand(3, 9),
      vx: Math.cos(a) * push * rand(0.3, 1),
      vy: Math.sin(a) * push * rand(0.3, 1),
      vh: rand(10, 40),
      drag: 2.5,
      life: rand(0.35, 0.7),
      s0: size * 0.5,
      s1: size * rand(1.2, 1.8),
      rot: rand(0, TAU),
      spin: rand(-1, 1),
      c0: color,
      a: alpha,
      in: 0.1,
      hold: 0.2,
      add: 0,
    });
  }
}

/**
 * An explosion of radius `r`: flash, a shock ring over the ground, a ball of fire,
 * smoke after it, sparks and light on everything near. `power` scales how much of each.
 */
export function blast(st: Stage, x: number, y: number, h: number, r: number, t: Tone = FIRE, power = 1, smoky = true): void {
  const big = Math.min(r, 520);
  st.flash(x, y, t.mid, Math.min(2.2, 0.7 + big / 160) * power, 0.38, 240 + big * 2.4);
  flash(st, x, y, h + big * 0.2, big * 0.55, t.mid, 0.14);
  ring(st, x, y, r * 0.25, r * 1.06, 0.3, t.mid, 0.72, true);
  pool(st, x, y, r, t.deep, 0.45, 0.7);
  const n = Math.min(18, 4 + big / 12) * power;
  flames(st, x, y, h, n, big * 0.6, t, big * 0.35, big * 2.2, 60 + big * 0.9);
  if (smoky) smoke(st, x, y, h + big * 0.25, Math.min(8, 2 + big / 40) * power, big * 0.55, mix(t.deep, 0x15131a, 0.8), 0.45, big * 0.3, 60, 0.1);
  sparks(st, x, y, h + 6, t.mid, Math.min(30, 6 + big / 7) * power, 220 + big * 3, 5);
}

/** A stroke of lightning out of the sky onto a point on the ground. */
export function strike(st: Stage, x: number, y: number, color: number, power = 1): void {
  const v = st.vfx;
  const lean = rand(-260, 260);
  v.bolt(x + lean, y - 120, 1500, x, y, 0, color, 6 * power, 0.26, 46, 2);
  flash(st, x, y, 14, 90 * power, color, 0.16);
  ring(st, x, y, 12, 90 * power, 0.28, color, 0.9, true);
  pool(st, x, y, 90 * power, color, 0.35, 0.8);
  sparks(st, x, y, 6, color, 9 * power, 420, 5);
  st.flash(x, y, color, 1.7 * power, 0.32);
}

/** A crackle of lightning from one point to another. */
export function zap(st: Stage, x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, color: number, width = 4, life = 0.2): void {
  const v = st.vfx;
  v.bolt(x0, y0, h0, x1, y1, h1, color, width, life, 24, 1);
  v.emit({ f: 'flare', x: x1, y: y1, h: h1, life: 0.16, s0: 70, s1: 24, c0: 0xffffff, c1: color, a: 0.9 });
  v.emit({ f: 'dot', x: x1, y: y1, h: h1, life: 0.14, s0: 30, s1: 54, c0: 0xffffff, c1: color, a: 0.9 });
}

export function hit(st: Stage, x: number, y: number, h: number, color: number, dx = 0, dy = 0, n = 4): void {
  const v = st.vfx;
  v.emit({ f: 'flare', x, y, h, life: 0.14, s0: 42, s1: 16, c0: 0xffffff, c1: color, a: 0.7, rot: rand(0, 1.5) });
  if (dx || dy) spray(st, x, y, h, dx, dy, color, n, 380, 0.8, 6.5);
  else sparks(st, x, y, h, color, n, 320, 6.5, 0.4);
}

/** Wind: streaks hurrying along a heading. */
export function gust(st: Stage, x: number, y: number, h: number, angle: number, n: number, color = 0xdff2ff, speed = 520, spread = 40): void {
  const v = st.vfx;
  const cx = Math.cos(angle);
  const cy = Math.sin(angle);
  for (let i = v.count(n); i > 0; i--) {
    const off = rand(-spread, spread);
    const s = speed * rand(0.6, 1.2);
    v.emit({
      f: 'streak',
      mode: STREAK,
      x: x - cy * off,
      y: y + cx * off,
      h: h + rand(-20, 26),
      vx: cx * s,
      vy: cy * s,
      vh: rand(-10, 30),
      drag: 1.5,
      life: rand(0.25, 0.5),
      s0: rand(3, 6),
      s1: 1.5,
      c0: color,
      a: 0.6,
      in: 0.2,
      hold: 0.5,
      stretch: 0.14,
    });
  }
}

export function glow(st: Stage, x: number, y: number, h: number, size: number, color: number, alpha = 1): void {
  const v = st.vfx;
  v.sprite('dot', x, y, h, size, size, 0, color, alpha * 0.32, BOARD, 1);
  v.sprite('core', x, y, h, size * 0.28, size * 0.28, 0, mix(color, 0xffffff, 0.75), alpha, BOARD, 1);
}

export function wave(st: Stage, x: number, y: number, radius: number, time: number, t: Tone = FIRE, n = 40, size = 46): void {
  const v = st.vfx;
  // Thrown hard and slowed hard, so it reaches the rim as the blow does and hangs there.
  const drag = 6;
  const speed = (radius * 0.92 * drag) / (1 - Math.exp(-drag * time));
  const c0 = mix(t.hot, t.mid, 0.5);
  for (let i = v.count(n); i > 0; i--) {
    const a = rand(0, TAU);
    const s = speed * rand(0.82, 1.05);
    v.emit({
      f: FLAME[(Math.random() * 4) | 0],
      x: x + Math.cos(a) * 16,
      y: y + Math.sin(a) * 16,
      h: rand(4, 18),
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      vh: rand(40, 120),
      drag,
      life: time + rand(0.18, 0.42),
      s0: size * rand(0.7, 1.1),
      s1: size * rand(1.2, 1.7),
      rot: rand(-0.3, 0.3),
      c0,
      c1: t.deep,
      a: 0.85,
      in: 0.1,
      hold: 0.45,
      add: 0.7,
    });
  }
  ring(st, x, y, 20, radius * 1.04, time + 0.12, t.mid, 0.95, true);
  ring(st, x, y, 10, radius * 0.8, time + 0.3, t.hot, 0.5, false, 2);
  pool(st, x, y, radius * 0.9, t.deep, time + 0.3, 0.55);
  sparks(st, x, y, 12, t.mid, Math.min(30, n * 0.5), radius * 3.2, 5, 0.6);
  st.flash(x, y, t.mid, Math.min(2.4, 0.9 + radius / 300), 0.45, 300 + radius * 1.8);
}

/** A fire burning in place for one moment: call it every step, with `dt`, for as long as it burns. */
export function burn(st: Stage, x: number, y: number, r: number, dt: number, t: Tone = FIRE, rate = 26, size = 30): void {
  const v = st.vfx;
  for (let i = v.count(dt * rate); i > 0; i--) {
    const a = rand(0, TAU);
    const d = r * Math.sqrt(Math.random());
    v.emit({
      f: FLAME[(Math.random() * 4) | 0],
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d,
      h: size * 0.35,
      vx: rand(-14, 14),
      vy: rand(-14, 14),
      vh: rand(50, 130),
      life: rand(0.3, 0.55),
      s0: size * rand(0.7, 1.15),
      s1: size * 0.3,
      rot: rand(-0.25, 0.25),
      c0: mix(t.hot, t.mid, 0.5),
      c1: t.deep,
      a: 0.8,
      in: 0.15,
      hold: 0.4,
      add: 0.7,
    });
  }
  if (Math.random() < dt * rate * 0.12) {
    const a = rand(0, TAU);
    const d = r * Math.sqrt(Math.random());
    v.emit({ f: 'core', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, h: size * 0.6, vx: rand(-20, 20), vy: rand(-20, 20), vh: rand(90, 200), life: rand(0.5, 0.9), s0: 6, s1: 1, c0: t.hot, c1: t.mid, a: 0.9, hold: 0.5 });
  }
}
