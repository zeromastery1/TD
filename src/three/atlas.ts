import * as THREE from 'three';
import { Rng } from '../core/rng';

// One sheet of soft shapes that every spell effect is built from: glows,
// smoke, licks of flame, rings, shards and the profiles ribbons are drawn
// with. Everything is white or grey, and is coloured when it is drawn.

type Ctx = CanvasRenderingContext2D;

const W = 2048;
const H = 1024;
const PAD = 4;

const NAMES = [
  'dot',
  'core',
  'streak',
  'smoke0',
  'smoke1',
  'smoke2',
  'smoke3',
  'flame0',
  'flame1',
  'flame2',
  'flame3',
  'ring',
  'shock',
  'flare',
  'shard',
  'leaf',
  'drop',
  'bubble',
  'crack',
  'rune',
  'mark',
  'swirl',
  'beam',
  'edge',
  'wisps',
  'blob',
  'sigil',
  'pool',
  'scorch',
  'aura',
  'frost',
  'feather',
] as const;

export type Frame = (typeof NAMES)[number];

/** Where each frame sits in the sheet: u, v, width and height as fractions of it. */
export const RECT: Record<Frame, [number, number, number, number]> = {} as Record<Frame, [number, number, number, number]>;
/** The same, by number, for the particle arrays. */
export const FRAME_ID: Record<Frame, number> = {} as Record<Frame, number>;
export const RECTS: [number, number, number, number][] = [];

export const SMOKE: Frame[] = ['smoke0', 'smoke1', 'smoke2', 'smoke3'];
export const FLAME: Frame[] = ['flame0', 'flame1', 'flame2', 'flame3'];

function disc(ctx: Ctx, cx: number, cy: number, r: number, stops: [number, number][]): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [at, a] of stops) g.addColorStop(at, `rgba(255,255,255,${a})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

const DRAW: Record<Frame, { w: number; h: number; from?: string; draw?: (ctx: Ctx, w: number, h: number, rng: Rng) => void }> = {
  // A soft glow.
  dot: {
    w: 128,
    h: 128,
    draw: (ctx, w) =>
      disc(ctx, w / 2, w / 2, w / 2, [
        [0, 1],
        [0.2, 0.62],
        [0.5, 0.2],
        [0.8, 0.04],
        [1, 0],
      ]),
  },
  // A hot point with a tight halo.
  core: {
    w: 64,
    h: 64,
    draw: (ctx, w) =>
      disc(ctx, w / 2, w / 2, w / 2, [
        [0, 1],
        [0.35, 0.95],
        [0.6, 0.3],
        [1, 0],
      ]),
  },
  // A spark in flight: bright at the head, thinning to a tail.
  streak: {
    w: 128,
    h: 32,
    draw: (ctx, w, h) => {
      for (let x = 0; x < w; x++) {
        const k = x / (w - 1);
        const a = Math.pow(k, 1.6);
        const half = (h / 2 - 2) * (0.25 + 0.75 * k);
        const g = ctx.createLinearGradient(0, h / 2 - half, 0, h / 2 + half);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, `rgba(255,255,255,${a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, 1, h);
      }
      // Round the head off. One fill over the whole frame: 'destination-in' wipes whatever a fill leaves uncovered.
      ctx.globalCompositeOperation = 'destination-in';
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop((w - 14) / w, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    },
  },
  smoke0: { w: 128, h: 128, draw: smoke },
  smoke1: { w: 128, h: 128, draw: smoke },
  smoke2: { w: 128, h: 128, draw: smoke },
  smoke3: { w: 128, h: 128, draw: smoke },
  flame0: { w: 128, h: 128, draw: flame },
  flame1: { w: 128, h: 128, draw: flame },
  flame2: { w: 128, h: 128, draw: flame },
  flame3: { w: 128, h: 128, draw: flame },
  // A thin bright ring.
  ring: {
    w: 256,
    h: 256,
    draw: (ctx, w) =>
      disc(ctx, w / 2, w / 2, w / 2, [
        [0, 0],
        [0.78, 0],
        [0.9, 0.35],
        [0.945, 1],
        [0.975, 0.35],
        [1, 0],
      ]),
  },
  // A shock front: hard at the rim, trailing off inward.
  shock: {
    w: 256,
    h: 256,
    draw: (ctx, w) =>
      disc(ctx, w / 2, w / 2, w / 2, [
        [0, 0],
        [0.35, 0.02],
        [0.7, 0.2],
        [0.9, 0.7],
        [0.955, 1],
        [0.985, 0.25],
        [1, 0],
      ]),
  },
  // A four-pointed glint.
  flare: {
    w: 128,
    h: 128,
    draw: (ctx, w) => {
      const c = w / 2;
      for (let i = 0; i < 2; i++) {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate((i * Math.PI) / 2);
        ctx.scale(1, 0.085);
        disc(ctx, 0, 0, c, [
          [0, 1],
          [0.3, 0.5],
          [1, 0],
        ]);
        ctx.restore();
      }
      disc(ctx, c, c, c * 0.42, [
        [0, 1],
        [0.4, 0.5],
        [1, 0],
      ]);
    },
  },
  // A chip of ice, glass or stone.
  shard: {
    w: 64,
    h: 64,
    draw: (ctx, w) => {
      const g = ctx.createLinearGradient(10, 6, 54, 58);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.72)');
      g.addColorStop(1, 'rgba(255,255,255,0.45)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, 4);
      ctx.lineTo(w * 0.86, w * 0.58);
      ctx.lineTo(w * 0.58, w - 5);
      ctx.lineTo(w * 0.16, w * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, 4);
      ctx.lineTo(w * 0.5, w * 0.6);
      ctx.lineTo(w * 0.58, w - 5);
      ctx.stroke();
    },
  },
  leaf: {
    w: 64,
    h: 64,
    draw: (ctx, w) => {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.moveTo(w * 0.5, 4);
      ctx.quadraticCurveTo(w * 0.95, w * 0.5, w * 0.5, w - 4);
      ctx.quadraticCurveTo(w * 0.05, w * 0.5, w * 0.5, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, 8);
      ctx.lineTo(w * 0.5, w - 8);
      ctx.stroke();
    },
  },
  // A falling drop, round at the bottom.
  drop: {
    w: 32,
    h: 64,
    draw: (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.75, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,1)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(w / 2, 2);
      ctx.quadraticCurveTo(w * 0.9, h * 0.7, w / 2, h - 3);
      ctx.quadraticCurveTo(w * 0.1, h * 0.7, w / 2, 2);
      ctx.fill();
    },
  },
  bubble: {
    w: 64,
    h: 64,
    draw: (ctx, w) => {
      disc(ctx, w / 2, w / 2, w / 2 - 2, [
        [0, 0.12],
        [0.7, 0.2],
        [0.88, 0.85],
        [0.96, 0.5],
        [1, 0],
      ]);
      disc(ctx, w * 0.36, w * 0.34, w * 0.14, [
        [0, 0.9],
        [1, 0],
      ]);
    },
  },
  // Cracks spreading from a blow to the ground.
  crack: {
    w: 256,
    h: 256,
    draw: (ctx, w, _h, rng) => {
      const c = w / 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const arms = 9;
      for (let i = 0; i < arms; i++) {
        let a = (i / arms) * Math.PI * 2 + rng.range(-0.25, 0.25);
        let x = c;
        let y = c;
        const reach = c * rng.range(0.6, 0.94);
        const steps = 6;
        const pts: [number, number][] = [[x, y]];
        for (let s = 1; s <= steps; s++) {
          a += rng.range(-0.5, 0.5);
          x += (Math.cos(a) * reach) / steps;
          y += (Math.sin(a) * reach) / steps;
          pts.push([x, y]);
          if (s === 3 && rng.chance(0.7)) {
            // A side crack.
            const b = a + rng.pick([-1, 1]) * rng.range(0.6, 1);
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(b) * reach * 0.26, y + Math.sin(b) * reach * 0.26);
            ctx.stroke();
          }
        }
        for (let s = 1; s < pts.length; s++) {
          const k = 1 - s / pts.length;
          ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.65 * k})`;
          ctx.lineWidth = 1.5 + 6 * k;
          ctx.beginPath();
          ctx.moveTo(pts[s - 1][0], pts[s - 1][1]);
          ctx.lineTo(pts[s][0], pts[s][1]);
          ctx.stroke();
        }
      }
      disc(ctx, c, c, c * 0.3, [
        [0, 0.9],
        [1, 0],
      ]);
      // Fade the whole thing out toward the rim.
      ctx.globalCompositeOperation = 'destination-in';
      disc(ctx, c, c, c, [
        [0, 1],
        [0.7, 1],
        [1, 0],
      ]);
      ctx.globalCompositeOperation = 'source-over';
    },
  },
  // A circle of power drawn on the ground.
  rune: {
    w: 256,
    h: 256,
    draw: (ctx, w) => {
      const c = w / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineCap = 'round';
      const circle = (r: number, lw: number) => {
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(c, c, r, 0, Math.PI * 2);
        ctx.stroke();
      };
      circle(c * 0.93, 4);
      circle(c * 0.8, 1.5);
      circle(c * 0.44, 2.5);
      // Two triangles make the star inside.
      ctx.lineWidth = 2.5;
      for (let t = 0; t < 2; t++) {
        ctx.beginPath();
        for (let i = 0; i <= 3; i++) {
          const a = (i / 3) * Math.PI * 2 + t * Math.PI + Math.PI / 2;
          const x = c + Math.cos(a) * c * 0.8;
          const y = c + Math.sin(a) * c * 0.8;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Tick marks between the rings.
      ctx.lineWidth = 3;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const r0 = c * (i % 2 ? 0.83 : 0.82);
        const r1 = c * (i % 2 ? 0.87 : 0.9);
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
        ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
        ctx.stroke();
      }
      disc(ctx, c, c, c, [
        [0, 0.16],
        [0.8, 0.1],
        [0.93, 0.2],
        [1, 0],
      ]);
    },
  },
  // Where something is about to land.
  mark: {
    w: 256,
    h: 256,
    draw: (ctx, w) => {
      const c = w / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineCap = 'round';
      ctx.lineWidth = 5;
      // A broken ring.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.22;
        ctx.beginPath();
        ctx.arc(c, c, c * 0.9, a, a + Math.PI / 2 - 0.44);
        ctx.stroke();
      }
      // Four darts pointing in.
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        ctx.save();
        ctx.translate(c + Math.cos(a) * c * 0.9, c + Math.sin(a) * c * 0.9);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(-34, 0);
        ctx.lineTo(-4, -11);
        ctx.lineTo(-4, 11);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      disc(ctx, c, c, c * 0.9, [
        [0, 0.05],
        [0.75, 0.14],
        [1, 0.3],
      ]);
    },
  },
  // Arms of wind turning about a centre.
  swirl: {
    w: 256,
    h: 256,
    draw: (ctx, w) => {
      const c = w / 2;
      ctx.lineCap = 'round';
      for (let arm = 0; arm < 5; arm++) {
        const start = (arm / 5) * Math.PI * 2;
        const steps = 40;
        for (let i = 0; i < steps; i++) {
          const k = i / steps;
          const a0 = start + k * 2.6;
          const a1 = start + (k + 1 / steps) * 2.6;
          const r0 = c * (0.12 + 0.8 * k);
          const r1 = c * (0.12 + 0.8 * (k + 1 / steps));
          ctx.strokeStyle = `rgba(255,255,255,${Math.sin(k * Math.PI) * 0.85})`;
          ctx.lineWidth = 2 + 9 * Math.sin(k * Math.PI);
          ctx.beginPath();
          ctx.moveTo(c + Math.cos(a0) * r0, c + Math.sin(a0) * r0);
          ctx.lineTo(c + Math.cos(a1) * r1, c + Math.sin(a1) * r1);
          ctx.stroke();
        }
      }
    },
  },
  // The cross-section of a ribbon of light: bright along the middle.
  beam: {
    w: 16,
    h: 64,
    draw: (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.3)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.3)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  // The cross-section of a blade's trail: hard at the outer edge, fading in.
  edge: {
    w: 16,
    h: 64,
    draw: (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.1, 'rgba(255,255,255,1)');
      g.addColorStop(0.22, 'rgba(255,255,255,0.75)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  // Streaks, for wind and anything moving fast.
  wisps: {
    w: 256,
    h: 64,
    draw: (ctx, w, h, rng) => {
      ctx.lineCap = 'round';
      for (let i = 0; i < 14; i++) {
        const y = rng.range(8, h - 8);
        const x0 = rng.range(0, w * 0.5);
        const len = rng.range(w * 0.3, w * 0.7);
        const g = ctx.createLinearGradient(x0, 0, Math.min(w, x0 + len), 0);
        const a = rng.range(0.35, 0.95);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.6, `rgba(255,255,255,${a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = rng.range(1.5, 5);
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(Math.min(w - 2, x0 + len), y + rng.range(-3, 3));
        ctx.stroke();
      }
      // Fade toward both long edges so a ribbon of it has soft sides.
      ctx.globalCompositeOperation = 'destination-in';
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.3, 'rgba(255,255,255,1)');
      g.addColorStop(0.7, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    },
  },
  // The shadow under something in the air.
  blob: {
    w: 64,
    h: 64,
    draw: (ctx, w) =>
      disc(ctx, w / 2, w / 2, w / 2, [
        [0, 0.9],
        [0.5, 0.6],
        [1, 0],
      ]),
  },
  // Rime spreading over the ground.
  frost: {
    w: 256,
    h: 256,
    draw: (ctx, w, _h, rng) => {
      const c = w / 2;
      disc(ctx, c, c, c, [
        [0, 0.42],
        [0.6, 0.3],
        [0.9, 0.12],
        [1, 0],
      ]);
      ctx.lineCap = 'round';
      // Feathered spikes of ice.
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + rng.range(-0.15, 0.15);
        const reach = c * rng.range(0.6, 0.96);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * c * 0.1, c + Math.sin(a) * c * 0.1);
        ctx.lineTo(c + Math.cos(a) * reach, c + Math.sin(a) * reach);
        ctx.stroke();
        ctx.lineWidth = 1.5;
        for (let s = 1; s <= 4; s++) {
          const k = s / 5;
          const bx = c + Math.cos(a) * reach * k;
          const by = c + Math.sin(a) * reach * k;
          for (const side of [-1, 1]) {
            const b = a + side * 0.75;
            const len = reach * 0.16 * (1 - k * 0.5);
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(b) * len, by + Math.sin(b) * len);
            ctx.stroke();
          }
        }
      }
    },
  },
  feather: {
    w: 32,
    h: 64,
    draw: (ctx, w, h) => {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.moveTo(w / 2, 2);
      ctx.quadraticCurveTo(w - 2, h * 0.35, w * 0.62, h - 10);
      ctx.lineTo(w / 2, h - 2);
      ctx.lineTo(w * 0.38, h - 10);
      ctx.quadraticCurveTo(2, h * 0.35, w / 2, 2);
      ctx.fill();
    },
  },
  // Pictures the drawn game already has, borrowed for the ground.
  sigil: { w: 256, h: 256, from: 'sigil' },
  pool: { w: 256, h: 256, from: 'pool' },
  scorch: { w: 256, h: 256, from: 'scorch' },
  aura: { w: 256, h: 256, from: 'aura' },
};

/** A lumpy cloud made of many soft discs. */
function smoke(ctx: Ctx, w: number, _h: number, rng: Rng): void {
  const c = w / 2;
  for (let i = 0; i < 16; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0, c * 0.42);
    const r = rng.range(c * 0.26, c * 0.5);
    disc(ctx, c + Math.cos(a) * d, c + Math.sin(a) * d, r, [
      [0, 0.34],
      [0.55, 0.2],
      [1, 0],
    ]);
  }
}

/** A lick of flame: fat at the foot, drawn up to a wavering tip. */
function flame(ctx: Ctx, w: number, h: number, rng: Rng): void {
  const lean = rng.range(-0.2, 0.2);
  const wave = rng.range(0.5, 1.6);
  const phase = rng.range(0, 6);
  for (let i = 0; i < 22; i++) {
    const k = i / 21;
    const y = h * (0.78 - 0.66 * k);
    const x = w / 2 + (lean * k + Math.sin(k * 5 * wave + phase) * 0.07 * k) * w;
    const r = w * (0.3 * Math.pow(1 - k, 0.8) + 0.035);
    disc(ctx, x, y, r, [
      [0, 0.34],
      [0.5, 0.2],
      [1, 0],
    ]);
  }
  // A hotter heart low down.
  disc(ctx, w / 2, h * 0.7, w * 0.2, [
    [0, 0.5],
    [1, 0],
  ]);
}

/**
 * Draw the sheet. `borrow` hands over a picture the drawn game already made,
 * by name, or null when it has none.
 */
export function buildAtlas(borrow: (key: string) => CanvasImageSource | null): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(9241);
  let x = PAD;
  let y = PAD;
  let row = 0;
  NAMES.forEach((name, id) => {
    const d = DRAW[name];
    if (x + d.w + PAD > W) {
      x = PAD;
      y += row + PAD;
      row = 0;
    }
    if (y + d.h + PAD > H) throw new Error('the effect sheet is full');
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.rect(0, 0, d.w, d.h);
    ctx.clip();
    if (d.from) {
      const src = borrow(d.from);
      if (src) ctx.drawImage(src, 0, 0, d.w, d.h);
    } else d.draw!(ctx, d.w, d.h, rng);
    ctx.restore();
    const rect: [number, number, number, number] = [x / W, y / H, d.w / W, d.h / H];
    RECT[name] = rect;
    FRAME_ID[name] = id;
    RECTS[id] = rect;
    x += d.w + PAD;
    row = Math.max(row, d.h);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
